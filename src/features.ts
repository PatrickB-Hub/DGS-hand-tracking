// Landmark -> Feature-Vektor. Keine Abhängigkeit zu MediaPipe oder DOM, damit testbar (features.test.ts).

export type Point = { x: number; y: number; z: number }

// MediaPipe-Indizes: 0 = Handgelenk, danach je 4 Punkte pro Finger von der Basis zur Spitze.
export const FINGERS = [
  [1, 2, 3, 4], // Daumen
  [5, 6, 7, 8], // Zeigefinger
  [9, 10, 11, 12], // Mittelfinger
  [13, 14, 15, 16], // Ringfinger
  [17, 18, 19, 20], // kleiner Finger
] as const
export const FINGER_NAMES = ['Daumen', 'Zeigefinger', 'Mittelfinger', 'Ringfinger', 'kleiner Finger']

/**
 * 21 Weltkoordinaten-Landmarks -> 63 Zahlen.
 * - Verschiebung: Handgelenk liegt im Ursprung.
 * - Skalierung: Abstand Handgelenk -> Mittelfinger-Grundgelenk ist 1.
 * - Spiegelung: linke Hände werden auf rechte abgebildet (x negiert), Linkshänder nutzen dieselben Schablonen.
 * Die Rotation bleibt absichtlich erhalten: manche Buchstaben unterscheiden sich nur in der Handausrichtung.
 */
export function normalize(landmarks: Point[], mirror: boolean): number[] {
  const o = landmarks[0]
  const m = landmarks[9]
  const scale = Math.hypot(m.x - o.x, m.y - o.y, m.z - o.z) || 1
  const sx = mirror ? -1 : 1
  return landmarks.flatMap((p) => [(sx * (p.x - o.x)) / scale, (p.y - o.y) / scale, (p.z - o.z) / scale])
}

/** Mittlerer Abstand der 4 Punkte eines Fingers zwischen zwei Feature-Vektoren. */
export function fingerDistance(a: number[], b: number[], finger: number): number {
  let sum = 0
  for (const i of FINGERS[finger])
    sum += Math.hypot(a[i * 3] - b[i * 3], a[i * 3 + 1] - b[i * 3 + 1], a[i * 3 + 2] - b[i * 3 + 2])
  return sum / 4
}

/** Abstand zweier Handformen: Summe der Fingerabstände. */
export const handDistance = (a: number[], b: number[]) =>
  FINGERS.reduce((sum, _, f) => sum + fingerDistance(a, b, f), 0)

// --- Handeigenes Koordinatensystem ---
// Kamerawinkel und Handneigung unterscheiden sich stark zwischen Personen (gemessen: bis 60°). In Koordinaten
// relativ zur Hand bleibt nur die Handform übrig: y zeigt vom Handgelenk zum Mittelfinger-Grundgelenk,
// z ist die Handflächennormale, x zeigt quer über die Hand.
type Vec = [number, number, number]
const at = (f: number[], i: number): Vec => [f[i * 3], f[i * 3 + 1], f[i * 3 + 2]]
const dot = (a: Vec, b: Vec) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const cross = (a: Vec, b: Vec): Vec => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
const unit = (a: Vec): Vec => {
  const l = Math.hypot(...a) || 1
  return [a[0] / l, a[1] / l, a[2] / l]
}

/** Achsen [x, y, z] der Hand, ausgedrückt in normalisierten Kamera-Koordinaten (Ausgabe von normalize). */
export function handFrame(features: number[]): [Vec, Vec, Vec] {
  const y = unit(at(features, 9))
  const across = at(features, 5).map((v, k) => v - at(features, 17)[k]) as Vec // Zeige- minus Kleinfinger-MCP
  const z = unit(cross(across, y))
  return [cross(y, z), y, z]
}

/** Normalisierte Features -> Handform in Hand-Koordinaten (unabhängig von der Ausrichtung zur Kamera). */
export function toHandShape(features: number[]): number[] {
  const axes = handFrame(features)
  return Array.from({ length: 21 }, (_, i) => axes.map((a) => dot(at(features, i), a))).flat()
}

/** Umkehrung: Handform in die Ausrichtung einer gegebenen Hand drehen (z. B. Schablone auf die Nutzerhand). */
export function fromHandShape(shape: number[], axes: [Vec, Vec, Vec]): number[] {
  return Array.from({ length: 21 }, (_, i) =>
    [0, 1, 2].map((k) => axes.reduce((sum, a, j) => sum + shape[i * 3 + j] * a[k], 0)),
  ).flat()
}
