import type { Vec2 } from '../types'
import { dist, dot, lineIntersect, norm, scale, sub, add } from './vec'

/** What a measuring tap can snap to on the plan, in mm: corners, and lines such as wall faces. */
export interface MeasureTargets {
  corners: Vec2[]
  lines: [Vec2, Vec2][]
}

export interface MeasureSnap {
  p: Vec2
  to: 'corner' | 'line' | 'free'
  /** made exactly straight across or along the plan from the first point */
  straight: boolean
}

/** Within this (about 4°) of square with the plan, a measurement is made square. */
const STRAIGHT = Math.tan((4 * Math.PI) / 180)

function nearestOn(q: Vec2, a: Vec2, b: Vec2): Vec2 {
  const ab = sub(b, a)
  const l2 = dot(ab, ab)
  const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, dot(sub(q, a), ab) / l2))
  return add(a, scale(ab, t))
}

/**
 * Where a measuring tap at q lands: on a corner within `tol`; else on a line within `tol`; else where it
 * was. From a first point, a second one nearly straight across or along the plan is made straight, meeting
 * the line it's on if there is one (so wall to wall is measured square).
 */
export function snapMeasure(q: Vec2, from: Vec2 | null, t: MeasureTargets, tol: number): MeasureSnap {
  let corner: Vec2 | null = null
  let best = tol
  for (const c of t.corners) {
    const d = dist(q, c)
    if (d < best) {
      corner = c
      best = d
    }
  }
  if (corner) return { p: corner, to: 'corner', straight: false }

  let axis: Vec2 | null = null
  if (from) {
    const dx = Math.abs(q.x - from.x)
    const dy = Math.abs(q.y - from.y)
    if (dx > 0 && dy <= dx * STRAIGHT) axis = { x: 1, y: 0 }
    else if (dy > 0 && dx <= dy * STRAIGHT) axis = { x: 0, y: 1 }
  }
  const square = (p: Vec2): Vec2 => (axis!.x ? { x: p.x, y: from!.y } : { x: from!.x, y: p.y })

  let line: [Vec2, Vec2] | null = null
  let on: Vec2 | null = null
  best = tol
  for (const [a, b] of t.lines) {
    const p = nearestOn(q, a, b)
    const d = dist(q, p)
    if (d < best) {
      line = [a, b]
      on = p
      best = d
    }
  }
  if (line && on) {
    if (axis) {
      const [a, b] = line
      const hit = lineIntersect(from!, axis, a, norm(sub(b, a)))
      if (hit && dist(hit, q) < tol && dist(nearestOn(hit, a, b), hit) < 1) return { p: hit, to: 'line', straight: true }
    }
    return { p: on, to: 'line', straight: false }
  }
  if (axis) return { p: square(q), to: 'free', straight: true }
  return { p: q, to: 'free', straight: false }
}
