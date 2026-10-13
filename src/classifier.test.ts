import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildTemplates, classify, fingerCheck } from './classifier.ts'
import { normalize, type Point } from './features.ts'

// Reproduzierbare Pseudo-Hand; seed ergibt eine andere Handform.
const hand = (seed: number): Point[] =>
  Array.from({ length: 21 }, (_, i) => ({
    x: Math.sin(i * 1.7 + seed),
    y: Math.cos(i * 2.3 + seed),
    z: Math.sin(i * 0.9 + seed) / 3,
  }))
const A = normalize(hand(0), false)
// "B" weicht nur am Zeigefinger jenseits des Grundgelenks ab (Landmarks 6-8). Landmarks 5, 9 und 17 bleiben gleich,
// weil sie das Hand-Koordinatensystem festlegen.
const B = A.map((v, i) => (i >= 18 && i < 27 ? v + 1 : v))
const jitter = (f: number[], k: number) => f.map((v, i) => v + Math.sin(i * k) * 0.01)
const templates = buildTemplates([
  ...[1, 2, 3].map((k) => ({ letter: 'A', person: 'p', features: jitter(A, k) })),
  ...[1, 2, 3].map((k) => ({ letter: 'B', person: 'p', features: jitter(B, k) })),
])

test('erkennt die nächste Schablone', () => {
  assert.equal(classify(jitter(A, 7), templates), 'A')
  assert.equal(classify(jitter(B, 7), templates), 'B')
})

test('erkennt die Handform auch bei anderem Kamerawinkel', () => {
  const tilt = (p: Point): Point => ({
    x: p.x,
    y: p.y * Math.cos(0.9) - p.z * Math.sin(0.9),
    z: p.y * Math.sin(0.9) + p.z * Math.cos(0.9),
  })
  const tilted = normalize(hand(0).map(tilt), false)
  assert.equal(classify(tilted, templates), 'A')
  // In Kamera-Koordinaten läge die gekippte Hand weit außerhalb der Toleranz (Abstand ~3,4).
  assert.deepEqual(fingerCheck(tilted, templates.get('A')!), [true, true, true, true, true])
})

test('Fingerprüfung markiert genau den abweichenden Finger', () => {
  assert.deepEqual(fingerCheck(A, templates.get('A')!), [true, true, true, true, true])
  assert.deepEqual(fingerCheck(A, templates.get('B')!), [true, false, true, true, true])
})

test('Übergangs-Frames verschieben die Schablone nicht', () => {
  const far = normalize(hand(5), false) // ganz andere Handform
  const t = buildTemplates([
    ...[1, 2, 3, 4, 5, 6, 7, 8, 9].map((k) => ({ letter: 'A', person: 'p', features: jitter(A, k) })),
    ...[1, 2].map((k) => ({ letter: 'A', person: 'p', features: jitter(far, k) })),
  ]).get('A')!
  assert.deepEqual(fingerCheck(A, t), [true, true, true, true, true])
  assert.ok(
    t.tol.every((v) => v < 0.5),
    `Toleranz zu groß: ${t.tol}`,
  )
})
