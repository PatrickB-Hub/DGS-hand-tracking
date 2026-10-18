import { buildTemplates, classify, fingerCheck, LETTERS, type Sample } from './classifier.ts'
import { FINGER_NAMES, fromHandShape, handDistance, handFrame, normalize } from './features.ts'
import { createHandView } from './hand3d.ts'
import { COLOR, drawGhost, drawHand } from './render.ts'
import { createDetector, startCamera, type Hand } from './tracking.ts'

const HOLD_FRAMES = 12 // so viele Kamerabilder muss eine Handform stabil sein (~0,4 s bei 30 FPS)
const RECORD_FRAMES = 60
const COUNTDOWN_MS = 3000 // Kamera: Zeit, um die Hand nach dem Klick in Position zu bringen
// Bewegung von Bild zu Bild (handDistance). Gemessen an echten Aufnahmen: gehaltene Handform ~0,08, Übergänge ~0,6.
const MOTION_MAX = 0.25
const MOVING_FRAMES_END = 5 // so viele bewegte Bilder in Folge beenden einen Durchgang

const $ = <T extends HTMLElement>(sel: string) => document.querySelector<T>(sel)!
const video = $<HTMLVideoElement>('video')
const canvas = $<HTMLCanvasElement>('canvas')
const ctx = canvas.getContext('2d')!
const stage = $('.stage')

// --- Persistenz ---
function load<T>(key: string, fallback: T): T {
  try {
    return JSON.parse(localStorage.getItem(key) ?? '') as T
  } catch {
    return fallback
  }
}
function save(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    alert('Speicher voll. Bitte Aufnahmen als JSON exportieren.')
  }
}

// Aufnahmen liegen in IndexedDB: Mit Rohdaten pro Frame sind sie zu groß für localStorage (~5 MB).
const db = new Promise<IDBDatabase>((resolve, reject) => {
  const req = indexedDB.open('dgs', 1)
  req.onupgradeneeded = () => req.result.createObjectStore('data')
  req.onsuccess = () => resolve(req.result)
  req.onerror = () => reject(req.error)
})
async function dbRequest<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const req = run((await db).transaction('data', mode).objectStore('data'))
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

let samples: Sample[] = []
let samplesLoaded = false // erst nach dem Laden speichern, sonst überschreibt ein Fehler beim Laden den Bestand
let templates = buildTemplates(samples)
const progress = load<Record<string, number>>('dgs.progress', {})

// --- Zustand ---
type Mode = 'erkennen' | 'ueben' | 'aufnehmen'
let mode: Mode = 'erkennen'
let stable = { letter: '', frames: 0 }
let lastAppended = ''
let word: string[] = []
let wordPos = 0
let recording: { letter: string; person: string; left: number; start: number; moving: number; take: number } | null =
  null
let prevFeatures: number[] | null = null

// --- UI ---
document.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach((btn) =>
  btn.addEventListener('click', () => {
    mode = btn.dataset.mode as Mode
    document.querySelectorAll('[data-mode]').forEach((b) => b.setAttribute('aria-pressed', String(b === btn)))
    document.querySelectorAll<HTMLElement>('[data-panel]').forEach((p) => (p.hidden = p.dataset.panel !== mode))
    $('#finger-feedback').hidden = hud.hidden = mode === 'aufnehmen' // beim Aufnehmen keine Schablone zum Vergleich
    hudLabel.textContent = mode === 'ueben' ? 'Zeige' : 'Erkannt'
    setHudLetter(mode === 'ueben' ? word[wordPos] : '')
    stable = { letter: '', frames: 0 }
  }),
)

const fingerList = $('#fingers')
fingerList.innerHTML = FINGER_NAMES.map((n) => `<li>${n}</li>`).join('')
// Kompakte Anzeige über dem Video (nur auf schmalen Bildschirmen sichtbar, siehe CSS)
const hud = $('.hud')
const hudLabel = $('#hud-label')
const hudLetter = $('#hud-letter')
const hudFingers = $('#hud-fingers')
hudFingers.innerHTML = '<span></span>'.repeat(5)
function setHudLetter(letter: string | undefined) {
  hudLetter.textContent = letter || '–'
  hudLetter.classList.toggle('empty', !letter)
}
function showFingers(ok: boolean[] | null) {
  const cls = (f: number) => (ok ? (ok[f] ? 'ok' : 'wrong') : '')
  ;[...fingerList.children].forEach((li, f) => (li.className = cls(f)))
  ;[...hudFingers.children].forEach((dot, f) => (dot.className = cls(f)))
}

const letterGrid = (counts: Record<string, number>, goal: number) =>
  LETTERS.map(
    (l) => `<span class="${(counts[l] ?? 0) >= goal ? 'done' : ''}">${l}<small>${counts[l] ?? 0}</small></span>`,
  ).join('')

// Quelle: Kamera oder Videodatei
let camera: MediaStream | null = null
const fromFile = () => !video.srcObject
const cameraBtn = $<HTMLButtonElement>('#use-camera')
function useCamera() {
  if (!camera) return
  URL.revokeObjectURL(video.src)
  video.removeAttribute('src')
  video.srcObject = camera
  video.controls = false
  stage.classList.remove('file')
  cameraBtn.hidden = true
  video.play()
}
$<HTMLInputElement>('#video-file').addEventListener('change', (e) => {
  const file = (e.target as HTMLInputElement).files?.[0]
  if (!file) return
  URL.revokeObjectURL(video.src)
  video.srcObject = null
  video.src = URL.createObjectURL(file)
  video.controls = true
  stage.classList.add('file')
  cameraBtn.hidden = !camera
  ;(e.target as HTMLInputElement).value = '' // dieselbe Datei erneut wählbar
})
cameraBtn.addEventListener('click', useCamera)
video.addEventListener('resize', () => {
  canvas.width = video.videoWidth
  canvas.height = video.videoHeight
})
// Videodatei: Pausieren oder Videoende beendet eine laufende Aufnahme vorzeitig.
video.addEventListener('pause', () => fromFile() && finishRecording())

// Erkennen
$('#clear-spelled').addEventListener('click', () => ($('#spelled').textContent = lastAppended = ''))

// Üben
const hand3d = $<HTMLCanvasElement>('#hand3d')
const handView = (() => {
  try {
    return createHandView(hand3d)
  } catch {
    return null // ohne WebGL bleibt es beim Bild
  }
})()
const wordInput = $<HTMLInputElement>('#word')
function setWord(text: string) {
  word = [...text.toUpperCase()].filter((c) => LETTERS.includes(c))
  wordPos = 0
  renderWord()
}
function renderWord() {
  $('#word-view').innerHTML = word.length
    ? word.map((c, i) => `<span class="${i < wordPos ? 'done' : i === wordPos ? 'current' : ''}">${c}</span>`).join('')
    : 'Bitte Buchstaben A–Y eingeben (ohne J).'
  const sign = $<HTMLImageElement>('#sign')
  const target = word[wordPos]
  sign.hidden = !target
  if (target) {
    sign.src = `${import.meta.env.BASE_URL}fingeralphabet/${target}.webp`
    sign.alt = `Handform für ${target} im DGS-Fingeralphabet`
  }
  const t = target && templates.get(target)
  hand3d.hidden = !t || !handView
  if (t && handView) {
    handView.show(fromHandShape(t.mean, t.frame))
    hand3d.ariaLabel = `Schablone für ${target} als drehbare 3D-Hand`
  }
  if (mode === 'ueben') setHudLetter(word[wordPos])
  $('#progress').innerHTML = letterGrid(progress, 3)
}
wordInput.addEventListener('input', () => setWord(wordInput.value))
$('#random').addEventListener('click', () => {
  const pool = templates.size ? [...templates.keys()] : LETTERS
  setWord((wordInput.value = pool[Math.floor(Math.random() * pool.length)]))
})
setWord(wordInput.value)

// Aufnehmen
const person = $<HTMLInputElement>('#person')
person.value = localStorage.getItem('dgs.person') ?? ''
const recLetter = $<HTMLSelectElement>('#rec-letter')
recLetter.innerHTML = LETTERS.map((l) => `<option>${l}</option>`).join('')
const deleteLetterBtn = $('#delete-letter')
const syncDeleteLabel = () => (deleteLetterBtn.textContent = `Aufnahmen für „${recLetter.value}“ löschen`)
recLetter.addEventListener('change', syncDeleteLabel)
syncDeleteLabel()
function setSamples(next: Sample[]) {
  samples = next
  templates = buildTemplates(samples)
  renderCounts()
  renderWord() // die 3D-Hand hängt an den Schablonen
  if (!samplesLoaded) return
  dbRequest('readwrite', (store) => store.put(samples, 'samples'))
    .then(() => localStorage.removeItem('dgs.samples')) // Altbestand erst nach erfolgreichem Speichern entfernen
    .catch(() => alert('Aufnahmen konnten nicht gespeichert werden. Bitte als JSON exportieren.'))
}
// Frühere Versionen speicherten in localStorage; deren Aufnahmen werden einmalig übernommen.
async function loadSamples() {
  const stored = await dbRequest<Sample[] | undefined>('readonly', (store) => store.get('samples'))
  samplesLoaded = true
  setSamples(stored ?? load<Sample[]>('dgs.samples', []))
}
function renderCounts() {
  const counts: Record<string, number> = {}
  for (const s of samples) counts[s.letter] = (counts[s.letter] ?? 0) + 1
  $('#counts').innerHTML = letterGrid(counts, RECORD_FRAMES)
}
renderCounts()
const recordBtn = $<HTMLButtonElement>('#record')
recordBtn.addEventListener('click', () => {
  if (recording) return finishRecording()
  const name = person.value.trim().toLowerCase()
  if (!name) return person.focus()
  localStorage.setItem('dgs.person', name)
  recording = {
    letter: recLetter.value,
    person: name,
    left: RECORD_FRAMES,
    start: performance.now() + (fromFile() ? 0 : COUNTDOWN_MS),
    moving: 0,
    take: Date.now(),
  }
  recordBtn.textContent = 'Aufnahme beenden'
  if (fromFile()) video.play()
  else startVideoCapture(recording.letter, name)
})
$('#export').addEventListener('click', () => {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([JSON.stringify(samples)], { type: 'application/json' }))
  a.download = `dgs-${person.value.trim().toLowerCase() || 'unbekannt'}-${new Date().toISOString().slice(0, 10)}.json`
  a.click()
  URL.revokeObjectURL(a.href)
})
$('#delete').addEventListener('click', () => {
  if (confirm('Alle lokalen Aufnahmen löschen? Vorher exportieren!')) setSamples([])
})
deleteLetterBtn.addEventListener('click', () => {
  const letter = recLetter.value
  if (confirm(`Alle Aufnahmen für „${letter}“ löschen?`)) setSamples(samples.filter((s) => s.letter !== letter))
})

// Nur für die Entwicklung (npm run dev): Kamerabild jedes Durchgangs als Video nach data/videos/ speichern.
// Im Production-Build ist import.meta.env.DEV false, der Code fällt beim Bundling heraus.
let videoCapture: MediaRecorder | null = null
function startVideoCapture(letter: string, who: string) {
  if (!import.meta.env.DEV || !camera) return
  const type = ['video/mp4', 'video/webm'].find((t) => MediaRecorder.isTypeSupported(t))
  if (!type) return
  const stamp = new Date().toLocaleString('sv').replace(' ', '_').replaceAll(':', '-') // 2026-10-12_14-03-22
  const name = `${letter}_${who
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\w-]/g, '_')}_${stamp}.${type === 'video/mp4' ? 'mp4' : 'webm'}`
  const chunks: Blob[] = []
  const rec = new MediaRecorder(camera, { mimeType: type })
  rec.ondataavailable = (e) => chunks.push(e.data)
  rec.onstop = async () => {
    const res = await fetch(`/__save-video?name=${name}`, { method: 'POST', body: new Blob(chunks) }).catch(() => null)
    const info = $('#rec-info')
    info.hidden = false
    info.textContent = res?.ok ? `Video gespeichert: data/videos/${name}` : 'Video konnte nicht gespeichert werden.'
  }
  rec.start()
  videoCapture = rec
}

// --- Pro Frame ---
function holdStable(letter: string) {
  stable = stable.letter === letter ? { letter, frames: stable.frames + 1 } : { letter, frames: 1 }
  return stable.frames === HOLD_FRAMES // genau einmal pro gehaltener Handform
}

function recognize(hand: Hand, features: number[]) {
  const letter = classify(features, templates)
  const ok = letter ? fingerCheck(features, templates.get(letter)!) : null
  const match = letter && ok!.every(Boolean) ? letter : ''
  drawHand(ctx, hand, ok ? ok.map((o) => (o ? COLOR.ok : COLOR.wrong)) : Array(5).fill(COLOR.neutral))
  showFingers(ok)
  $('#recognized').textContent = match || '–'
  $('#recognized').classList.toggle('empty', !match)
  setHudLetter(match)
  if (holdStable(match)) {
    if (match && match !== lastAppended) $('#spelled').textContent += match
    lastAppended = match // erst nach stabil gelöster Handform darf derselbe Buchstabe erneut kommen („LL“)
  }
}

function practice(hand: Hand, features: number[]) {
  const target = word[wordPos]
  const t = target && templates.get(target)
  if (!t) {
    drawHand(ctx, hand, Array(5).fill(COLOR.neutral))
    showFingers(null)
    setStatus(target ? `Für „${target}“ gibt es noch keine Schablone. Bitte erst aufnehmen.` : '')
    return
  }
  const ok = fingerCheck(features, t)
  const hit = ok.every(Boolean) && classify(features, templates) === target
  drawGhost(ctx, hand, fromHandShape(t.mean, handFrame(features))) // Schablone in der Ausrichtung der Nutzerhand
  drawHand(
    ctx,
    hand,
    ok.map((o) => (o ? COLOR.ok : COLOR.wrong)),
  )
  showFingers(ok)
  if (holdStable(hit ? target : '') && hit) {
    progress[target] = (progress[target] ?? 0) + 1
    save('dgs.progress', progress)
    wordPos = wordPos + 1 < word.length ? wordPos + 1 : 0
    stable = { letter: '', frames: 0 }
    renderWord()
  }
}

function record(hand: Hand, features: number[]) {
  drawHand(ctx, hand, Array(5).fill(COLOR.neutral))
  const moved = prevFeatures ? handDistance(features, prevFeatures) : Infinity
  prevFeatures = features
  if (!recording) return
  const wait = recording.start - performance.now()
  if (wait > 0) return setStatus(`Aufnahme „${recording.letter}“ startet in ${Math.ceil(wait / 1000)} …`)
  // Nur ruhige Frames: Bewegung vor dem Halten wird übersprungen, Bewegung danach beendet den Durchgang.
  const started = recording.left < RECORD_FRAMES
  if (moved > MOTION_MAX) {
    if (started && ++recording.moving >= MOVING_FRAMES_END) return finishRecording()
    return setStatus(started ? 'Hand bewegt sich …' : `Aufnahme „${recording.letter}“: Handform ruhig halten`)
  }
  recording.moving = 0
  const round = (v: number) => +v.toFixed(4)
  samples.push({
    letter: recording.letter,
    person: recording.person,
    features: features.map(round),
    take: recording.take,
    t: Math.round(-wait),
    image: hand.image.flatMap((p) => [p.x, p.y, p.z].map(round)),
    aspect: round(video.videoWidth / video.videoHeight),
    isLeft: hand.isLeft,
  })
  if (--recording.left > 0) return setStatus(`Aufnahme „${recording.letter}“: noch ${recording.left} Frames`)
  finishRecording()
}

function finishRecording() {
  if (!recording) return
  recording = null
  recordBtn.textContent = 'Aufnehmen'
  videoCapture?.stop()
  videoCapture = null
  setSamples(samples)
}

const statusEl = $('#status')
function setStatus(text: string) {
  statusEl.textContent = text
  statusEl.hidden = !text
}

let frames = 0
let fpsStart = performance.now()
function loop(detect: () => Hand | null) {
  if (++frames === 30) {
    const now = performance.now()
    $('#fps').textContent = `${Math.round(30_000 / (now - fpsStart))} FPS`
    ;[frames, fpsStart] = [0, now]
  }
  ctx.clearRect(0, 0, canvas.width, canvas.height)
  const hand = detect()
  if (!hand) {
    showFingers(null)
    stable = { letter: '', frames: 0 }
    lastAppended = ''
    setStatus(recording ? 'Aufnahme pausiert: keine Hand im Bild' : 'Keine Hand erkannt')
  } else {
    setStatus(
      templates.size || mode === 'aufnehmen' ? '' : 'Noch keine Schablonen. Bitte im Modus „Aufnehmen“ starten.',
    )
    const features = normalize(hand.world, hand.isLeft)
    ;({ erkennen: recognize, ueben: practice, aufnehmen: record })[mode](hand, features)
  }
  video.requestVideoFrameCallback(() => loop(detect))
}

// Ohne Berührung würde das Smartphone nach ~30 s dimmen. Die Sperre endet, wenn der Tab in den Hintergrund geht,
// daher beim Zurückkehren neu anfordern. Fehlt die API oder wird abgelehnt, läuft die App normal weiter.
function keepScreenAwake() {
  const request = () => navigator.wakeLock?.request('screen').catch(() => {})
  request()
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && request())
}

const cameraReady = startCamera()
  .then((stream) => (camera = stream))
  .catch((err: Error) =>
    setStatus(
      err.name === 'NotAllowedError'
        ? 'Kein Kamerazugriff. Du kannst trotzdem eine Videodatei laden.'
        : `Kamera nicht verfügbar (${err.message}). Du kannst eine Videodatei laden.`,
    ),
  )
const samplesReady = loadSamples().catch((err: Error) =>
  alert(`Aufnahmen konnten nicht geladen werden (${err.message}). Neue Aufnahmen werden nicht gespeichert.`),
)
createDetector(video)
  .then(async (detect) => {
    await Promise.all([cameraReady, samplesReady])
    if (camera && !video.src) {
      useCamera()
      setStatus('')
    }
    keepScreenAwake()
    video.requestVideoFrameCallback(() => loop(detect)) // erst beim ersten echten Bild, nie auf ein leeres Video
  })
  .catch((err: Error) => setStatus(`Handerkennung konnte nicht geladen werden: ${err.message}`))
