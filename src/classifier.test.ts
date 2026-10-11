import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildTemplates, classify, fingerCheck } from './classifier.ts'

const flat = Array.from({ length: 63 }, (_, i) => i / 63)
// "B" weicht nur am Zeigefinger (Landmarks 5-8) deutlich ab.
const shifted = flat.map((v, i) => (i >= 15 && i < 27 ? v + 1 : v))
const jitter = (f: number[], k: number) => f.map((v, i) => v + Math.sin(i * k) * 0.01)
const templates = buildTemplates([
  ...[1, 2, 3].map((k) => ({ letter: 'A', person: 'p', features: jitter(flat, k) })),
  ...[1, 2, 3].map((k) => ({ letter: 'B', person: 'p', features: jitter(shifted, k) })),
])

test('erkennt die nächste Schablone', () => {
  assert.equal(classify(jitter(flat, 7), templates), 'A')
  assert.equal(classify(jitter(shifted, 7), templates), 'B')
})

test('Fingerprüfung markiert genau den abweichenden Finger', () => {
  assert.deepEqual(fingerCheck(flat, templates.get('A')!), [true, true, true, true, true])
  assert.deepEqual(fingerCheck(flat, templates.get('B')!), [true, false, true, true, true])
})

test('Übergangs-Frames verschieben die Schablone nicht', () => {
  const far = flat.map((v) => v + 3)
  const t = buildTemplates([
    ...[1, 2, 3, 4, 5, 6, 7, 8, 9].map((k) => ({ letter: 'A', person: 'p', features: jitter(flat, k) })),
    ...[1, 2].map((k) => ({ letter: 'A', person: 'p', features: jitter(far, k) })),
  ]).get('A')!
  assert.deepEqual(fingerCheck(flat, t), [true, true, true, true, true])
  assert.ok(
    t.tol.every((v) => v < 0.5),
    `Toleranz zu groß: ${t.tol}`,
  )
})
