import { test } from 'node:test'
import assert from 'node:assert/strict'
import { normalize, type Point } from './features.ts'

// Pseudo-zufällige, aber reproduzierbare Hand.
const hand: Point[] = Array.from({ length: 21 }, (_, i) => ({
  x: Math.sin(i * 1.7),
  y: Math.cos(i * 2.3),
  z: Math.sin(i * 0.9) / 3,
}))
const close = (a: number[], b: number[]) =>
  a.forEach((v, i) => assert.ok(Math.abs(v - b[i]) < 1e-9, `Index ${i}: ${v} != ${b[i]}`))
const base = normalize(hand, false)

test('Handgelenk im Ursprung, Referenzlänge 1', () => {
  assert.deepEqual(base.slice(0, 3).map(Math.abs), [0, 0, 0])
  assert.ok(Math.abs(Math.hypot(base[27], base[28], base[29]) - 1) < 1e-9)
})

test('unabhängig von Verschiebung', () => {
  close(
    normalize(
      hand.map((p) => ({ x: p.x + 5, y: p.y - 2, z: p.z + 1 })),
      false,
    ),
    base,
  )
})

test('unabhängig von Skalierung', () => {
  close(
    normalize(
      hand.map((p) => ({ x: p.x * 3, y: p.y * 3, z: p.z * 3 })),
      false,
    ),
    base,
  )
})

test('gespiegelte linke Hand ergibt dieselben Features wie die rechte', () => {
  close(
    normalize(
      hand.map((p) => ({ ...p, x: -p.x })),
      true,
    ),
    base,
  )
})

test('Rotation bleibt erhalten', () => {
  const rotated = normalize(
    hand.map((p) => ({ x: -p.y, y: p.x, z: p.z })),
    false,
  )
  assert.ok(rotated.some((v, i) => Math.abs(v - base[i]) > 0.1))
})
