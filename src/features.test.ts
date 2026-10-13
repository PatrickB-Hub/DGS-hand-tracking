import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fromHandShape, handFrame, normalize, toHandShape, type Point } from './features.ts'

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

// Beliebige 3D-Drehung (um x, dann um z), wie ein anderer Kamerawinkel oder eine geneigte Hand.
const rotate = (p: Point, a: number, b: number): Point => {
  const y = p.y * Math.cos(a) - p.z * Math.sin(a)
  const z = p.y * Math.sin(a) + p.z * Math.cos(a)
  return { x: p.x * Math.cos(b) - y * Math.sin(b), y: p.x * Math.sin(b) + y * Math.cos(b), z }
}

test('Handform ist unabhängig von der Ausrichtung zur Kamera', () => {
  const tilted = normalize(
    hand.map((p) => rotate(p, 0.8, -0.5)),
    false,
  )
  close(toHandShape(tilted), toHandShape(base))
})

test('Handform lässt sich verlustfrei in die Ausrichtung der Hand zurückdrehen', () => {
  close(fromHandShape(toHandShape(base), handFrame(base)), base)
})
