import type { MultiPolygon } from 'polygon-clipping'
import type { Vec2 } from '../types'
import { add, cross, lineIntersect, norm, outward, scale, sub } from './vec'

/** Shoelace signed area. Positive = clockwise on a y-down screen. */
export function signedArea(pts: Vec2[]): number {
  let s = 0
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i]
    const b = pts[(i + 1) % pts.length]
    s += a.x * b.y - b.x * a.y
  }
  return s / 2
}

export const area = (pts: Vec2[]) => Math.abs(signedArea(pts))

export function centroid(pts: Vec2[]): Vec2 {
  const a = signedArea(pts)
  if (Math.abs(a) < 1e-9) {
    const s = pts.reduce((acc, p) => add(acc, p), { x: 0, y: 0 })
    return scale(s, 1 / Math.max(1, pts.length))
  }
  let cx = 0
  let cy = 0
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i]
    const q = pts[(i + 1) % pts.length]
    const f = p.x * q.y - q.x * p.y
    cx += (p.x + q.x) * f
    cy += (p.y + q.y) * f
  }
  return { x: cx / (6 * a), y: cy / (6 * a) }
}

export function bbox(pts: Vec2[]) {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const p of pts) {
    minX = Math.min(minX, p.x)
    minY = Math.min(minY, p.y)
    maxX = Math.max(maxX, p.x)
    maxY = Math.max(maxY, p.y)
  }
  return { minX, minY, maxX, maxY, w: maxX - minX, h: maxY - minY }
}

function segmentsIntersect(a: Vec2, b: Vec2, c: Vec2, d: Vec2): boolean {
  const d1 = cross(sub(b, a), sub(c, a))
  const d2 = cross(sub(b, a), sub(d, a))
  const d3 = cross(sub(d, c), sub(a, c))
  const d4 = cross(sub(d, c), sub(b, c))
  return d1 * d2 < 0 && d3 * d4 < 0
}

export function isSelfIntersecting(pts: Vec2[]): boolean {
  const n = pts.length
  for (let i = 0; i < n; i++) {
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue
      if (segmentsIntersect(pts[i], pts[(i + 1) % n], pts[j], pts[(j + 1) % n])) return true
    }
  }
  return false
}

export function pointInPolygon(p: Vec2, pts: Vec2[]): boolean {
  let inside = false
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i]
    const b = pts[j]
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside
  }
  return inside
}

/**
 * Offset each edge outward by its own distance, joining neighbours with mitres.
 * Requires positive signed area. Collinear neighbours fall back to a plain offset.
 */
export function offsetPolygon(pts: Vec2[], offsets: number[]): Vec2[] {
  const n = pts.length
  const dirs = pts.map((p, i) => norm(sub(pts[(i + 1) % n], p)))
  return pts.map((p, k) => {
    const iPrev = (k - 1 + n) % n
    const dPrev = dirs[iPrev]
    const dCur = dirs[k]
    const pPrev = add(p, scale(outward(dPrev), offsets[iPrev]))
    const pCur = add(p, scale(outward(dCur), offsets[k]))
    // Collinear neighbours can't both keep their offset; favour the larger (a wall over an open edge).
    return lineIntersect(pPrev, dPrev, pCur, dCur) ?? (Math.abs(offsets[iPrev]) > Math.abs(offsets[k]) ? pPrev : pCur)
  })
}

function ringArea(ring: [number, number][]): number {
  let a = 0
  for (let i = 0; i < ring.length; i++) {
    const [x1, y1] = ring[i]
    const [x2, y2] = ring[(i + 1) % ring.length]
    a += x1 * y2 - x2 * y1
  }
  return Math.abs(a / 2)
}

export function multiPolygonArea(mp: MultiPolygon): number {
  return mp.reduce((sum, poly) => sum + ringArea(poly[0]) - poly.slice(1).reduce((h, r) => h + ringArea(r), 0), 0)
}
