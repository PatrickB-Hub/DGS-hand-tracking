import { buildTemplates, classify, fingerCheck, LETTERS, type Sample } from './classifier.ts'
import { FINGER_NAMES, normalize } from './features.ts'
import { COLOR, drawGhost, drawHand } from './render.ts'
import { startTracking, type Hand } from './tracking.ts'

const HOLD_FRAMES = 12 // so viele Kamerabilder muss eine Handform stabil sein (~0,4 s bei 30 FPS)
const RECORD_FRAMES = 60
const COUNTDOWN_MS = 3000 // Zeit, um die Hand nach dem Klick in Position zu bringen

const $ = <T extends HTMLElement>(sel: string) => document.querySelector<T>(sel)!
const video = $<HTMLVideoElement>('video')
const canvas = $<HTMLCanvasElement>('canvas')
const ctx = canvas.getContext('2d')!

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

let samples = load<Sample[]>('dgs.samples', [])
let templates = buildTemplates(samples)
const progress = load<Record<string, number>>('dgs.progress', {})

// --- Zustand ---
type Mode = 'erkennen' | 'ueben' | 'aufnehmen'
let mode: Mode = 'erkennen'
let stable = { letter: '', frames: 0 }
let lastAppended = ''
let word: string[] = []
let wordPos = 0
let recording: { letter: string; person: string; left: number; start: number } | null = null

// --- UI ---
document.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach((btn) =>
  btn.addEventListener('click', () => {
    mode = btn.dataset.mode as Mode
    document.querySelectorAll('[data-mode]').forEach((b) => b.setAttribute('aria-pressed', String(b === btn)))
    document.querySelectorAll<HTMLElement>('[data-panel]').forEach((p) => (p.hidden = p.dataset.panel !== mode))
    stable = { letter: '', frames: 0 }
  }),
)

const fingerList = $('#fingers')
fingerList.innerHTML = FINGER_NAMES.map((n) => `<li>${n}</li>`).join('')
function showFingers(ok: boolean[] | null) {
  ;[...fingerList.children].forEach((li, f) => (li.className = ok ? (ok[f] ? 'ok' : 'wrong') : ''))
}

const letterGrid = (counts: Record<string, number>, goal: number) =>
  LETTERS.map(
    (l) => `<span class="${(counts[l] ?? 0) >= goal ? 'done' : ''}">${l}<small>${counts[l] ?? 0}</small></span>`,
  ).join('')

// Erkennen
$('#clear-spelled').addEventListener('click', () => ($('#spelled').textContent = lastAppended = ''))

// Üben
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
$('#rec-letter').innerHTML = LETTERS.map((l) => `<option>${l}</option>`).join('')
function renderCounts() {
  const counts: Record<string, number> = {}
  for (const s of samples) counts[s.letter] = (counts[s.letter] ?? 0) + 1
  $('#counts').innerHTML = letterGrid(counts, RECORD_FRAMES)
}
renderCounts()
$('#record').addEventListener('click', () => {
  const name = person.value.trim().toLowerCase()
  if (!name) return person.focus()
  localStorage.setItem('dgs.person', name)
  recording = {
    letter: $<HTMLSelectElement>('#rec-letter').value,
    person: name,
    left: RECORD_FRAMES,
    start: performance.now() + COUNTDOWN_MS,
  }
})
$('#export').addEventListener('click', () => {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([JSON.stringify(samples)], { type: 'application/json' }))
  a.download = `dgs-${person.value.trim().toLowerCase() || 'unbekannt'}-${new Date().toISOString().slice(0, 10)}.json`
  a.click()
  URL.revokeObjectURL(a.href)
})
$('#delete').addEventListener('click', () => {
  if (!confirm('Alle lokalen Aufnahmen löschen? Vorher exportieren!')) return
  samples = []
  templates = buildTemplates(samples)
  save('dgs.samples', samples)
  renderCounts()
})

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
  drawGhost(ctx, hand, t.mean)
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
  if (!recording) return
  const wait = recording.start - performance.now()
  if (wait > 0) return setStatus(`Aufnahme „${recording.letter}“ startet in ${Math.ceil(wait / 1000)} …`)
  samples.push({ letter: recording.letter, person: recording.person, features: features.map((v) => +v.toFixed(4)) })
  if (--recording.left > 0) return setStatus(`Aufnahme „${recording.letter}“: noch ${recording.left} Frames`)
  recording = null
  templates = buildTemplates(samples)
  save('dgs.samples', samples)
  renderCounts()
  setStatus('Aufnahme gespeichert.')
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

startTracking(video)
  .then((detect) => {
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    setStatus('')
    loop(detect)
  })
  .catch((err: Error) =>
    setStatus(
      err.name === 'NotAllowedError'
        ? 'Kein Kamerazugriff. Bitte im Browser erlauben und neu laden.'
        : `Start fehlgeschlagen: ${err.message}`,
    ),
  )
