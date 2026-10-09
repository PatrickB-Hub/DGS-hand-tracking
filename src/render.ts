import { FINGERS, type Point } from './features.ts'
import type { Hand } from './tracking.ts'

export const COLOR = { neutral: '#e8e6e1', ok: '#3ecf8e', wrong: '#ff5d5d', ghost: 'rgba(255,255,255,0.55)' }

function drawSkeleton(
  ctx: CanvasRenderingContext2D,
  pts: { x: number; y: number }[],
  colors: string[],
  dashed = false,
) {
  ctx.lineWidth = dashed ? 3 : 5
  ctx.lineCap = 'round'
  ctx.setLineDash(dashed ? [8, 8] : [])
  FINGERS.forEach((chain, f) => {
    ctx.strokeStyle = ctx.fillStyle = colors[f]
    ctx.beginPath()
    ctx.moveTo(pts[0].x, pts[0].y)
    for (const i of chain) ctx.lineTo(pts[i].x, pts[i].y)
    ctx.stroke()
    if (!dashed)
      for (const i of chain) {
        ctx.beginPath()
        ctx.arc(pts[i].x, pts[i].y, 6, 0, Math.PI * 2)
        ctx.fill()
      }
  })
  ctx.setLineDash([])
}

/** Erkannte Hand, jeder Finger in seiner Farbe (z. B. grün = passt, rot = weicht ab). */
export function drawHand(ctx: CanvasRenderingContext2D, hand: Hand, colors: string[]) {
  const { width: w, height: h } = ctx.canvas
  drawSkeleton(
    ctx,
    hand.image.map((p) => ({ x: p.x * w, y: p.y * h })),
    colors,
  )
}

/**
 * Schablone als gestrichelte Geisterhand, am Handgelenk und an der Handgröße des Nutzers ausgerichtet.
 * Näherung: projiziert die normalisierten 3D-Features einfach auf x/y.
 */
export function drawGhost(ctx: CanvasRenderingContext2D, hand: Hand, template: number[]) {
  const { width: w, height: h } = ctx.canvas
  const px = (p: Point) => ({ x: p.x * w, y: p.y * h })
  const wrist = px(hand.image[0])
  const mcp = px(hand.image[9])
  const sx = hand.isLeft ? -1 : 1 // zurück in die Händigkeit des Nutzers
  const scale = Math.hypot(mcp.x - wrist.x, mcp.y - wrist.y) / (Math.hypot(template[27], template[28]) || 1)
  const pts = Array.from({ length: 21 }, (_, i) => ({
    x: wrist.x + sx * template[i * 3] * scale,
    y: wrist.y + template[i * 3 + 1] * scale,
  }))
  drawSkeleton(ctx, pts, Array(5).fill(COLOR.ghost), true)
}
