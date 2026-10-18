import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { FINGERS } from './features.ts'

const SIZE = 160 // CSS-Pixel; fest, damit die Ansicht auch im versteckten Panel richtig aufgebaut wird
const UP = new THREE.Vector3(0, 1, 0)
// Knochen: Handgelenk -> Finger, plus Querverbindungen der Grundgelenke
const BONES = [
  ...FINGERS.flatMap((chain) => [0, ...chain].slice(0, -1).map((from, k) => [from, chain[k]])),
  [5, 9],
  [9, 13],
  [13, 17],
]
const PALM = [0, 1, 5, 9, 13, 17] // Umriss der Handfläche, als Fächer vom Handgelenk aus gefüllt
const PALM_OFFSET = 0.06 // Innen- und Außenseite liegen knapp vor bzw. hinter den Mittelhandknochen

/**
 * Drehbare 3D-Hand aus den 21 Schablonenpunkten: Kugeln für Gelenke, Zylinder für Knochen.
 * Ohne geriggtes Modell zeigt sie genau die Punkte der Schablone, ohne Umrechnung in Knochenwinkel.
 */
// ponytail: Skeletthand statt Haut; ein geriggtes glTF-Modell, falls es realistischer aussehen soll.
export function createHandView(canvas: HTMLCanvasElement) {
  // preserveDrawingBuffer: Es wird nur bei Änderungen gezeichnet, das Bild muss auch nach dem Ein-/Ausblenden bleiben.
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true })
  renderer.setPixelRatio(devicePixelRatio)
  renderer.setSize(SIZE, SIZE)
  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 100)
  camera.position.set(0, 0, 4.2) // Hand wird auf Radius 1 skaliert und füllt so das Bild
  const light = new THREE.DirectionalLight(0xffffff, 2.2)
  light.position.set(1, 2, 3) // hängt an der Kamera: Die gerade sichtbare Seite ist immer beleuchtet
  camera.add(light)
  scene.add(camera, new THREE.AmbientLight(0xffffff, 0.9))
  const render = () => renderer.render(scene, camera)
  const controls = new OrbitControls(camera, canvas)
  controls.enablePan = controls.enableZoom = false
  controls.addEventListener('change', render)
  controls.saveState()

  const skin = new THREE.MeshStandardMaterial({ color: 0xe8e6e1, roughness: 0.7 })
  const palmSide = new THREE.MeshStandardMaterial({ color: 0xf2b84b, roughness: 0.7 })
  const backSide = new THREE.MeshStandardMaterial({ color: 0xa6a39b, roughness: 0.7 })
  const joint = new THREE.SphereGeometry(0.1, 20, 14)
  const bone = new THREE.CylinderGeometry(0.09, 0.09, 1, 16) // Länge 1 entlang y, wird pro Knochen skaliert
  const hand = new THREE.Group()
  scene.add(hand)

  return {
    /** 63 Zahlen in normalisierten Kamera-Koordinaten (Ausgabe von normalize bzw. fromHandShape). */
    show(points: number[]) {
      // Kamera-Koordinaten (x rechts, y unten, z von der Kamera weg) -> three.js (y oben, z zur Kamera).
      // x gespiegelt: Die gespeicherten Features zeigen eine gespiegelte Hand (gekrümmte Fingerspitzen liegen auf der
      // Gegenseite der handFrame-z-Achse). Gespiegelt entspricht die Ansicht der Kamerasicht auf die Hand, also der Sicht
      // des Gegenübers wie in den Zeichnungen. Geprüft an Videobildern aus data/videos (A, G, L).
      const p = Array.from(
        { length: 21 },
        (_, i) => new THREE.Vector3(-points[i * 3], -points[i * 3 + 1], -points[i * 3 + 2]),
      )
      const center = p.reduce((sum, v) => sum.add(v), new THREE.Vector3()).divideScalar(p.length)
      p.forEach((v) => v.sub(center))
      hand.scale.setScalar(1 / Math.max(...p.map((v) => v.length())))

      hand.clear()
      for (const v of p) {
        const m = new THREE.Mesh(joint, skin)
        m.position.copy(v)
        hand.add(m)
      }
      for (const [a, b] of BONES) {
        const dir = p[b].clone().sub(p[a])
        const m = new THREE.Mesh(bone, skin)
        m.position.copy(p[a]).addScaledVector(dir, 0.5)
        m.scale.y = dir.length()
        m.quaternion.setFromUnitVectors(UP, dir.normalize())
        hand.add(m)
      }
      // Handfläche als dünne Platte: Innenseite gelb, Außenseite grau. In den gespiegelten Punkten zeigt
      // (Zeige- minus Kleinfinger-Grundgelenk) × (Handgelenk -> Mittelfinger-Grundgelenk) aus der Innenfläche heraus.
      const normal = p[5].clone().sub(p[17]).cross(p[9].clone().sub(p[0])).normalize()
      const fan = PALM.slice(1, -1).flatMap((_, k) => [PALM[0], PALM[k + 1], PALM[k + 2]])
      const [a, b, c] = fan.slice(0, 3).map((i) => p[i])
      const fanFacesPalm = b.clone().sub(a).cross(c.clone().sub(a)).dot(normal) > 0 // Drehrichtung = sichtbare Seite
      for (const [side, material] of [
        [1, palmSide],
        [-1, backSide],
      ] as const) {
        const order = fanFacesPalm === side > 0 ? fan : fan.toReversed() // umgekehrt = andere Drehrichtung
        const plate = new THREE.BufferGeometry().setFromPoints(
          order.map((i) => p[i].clone().addScaledVector(normal, side * PALM_OFFSET)),
        )
        plate.computeVertexNormals()
        hand.add(new THREE.Mesh(plate, material))
      }

      controls.reset() // jeder neue Buchstabe startet in der Ansicht von vorne; löst render() aus
      render()
    },
  }
}
