import type { Vec2 } from '../types'
import { dist } from './vec'

export interface Snapped {
  p: Vec2
  /** alignment guides to draw, in plan px */
  guideX?: number
  guideY?: number
  onVertex: boolean
}

const ORTHO_TOLERANCE = Math.tan((10 * Math.PI) / 180)

/**
 * Snap a tap to, in order: an existing corner; a horizontal/vertical line from the
 * previous corner; the x/y of other corners (so shared walls line up).
 */
export function snapPoint(raw: Vec2, prev: Vec2 | null, vertices: Vec2[], threshold: number): Snapped {
  let best: Vec2 | null = null
  let bestD = threshold
  for (const v of vertices) {
    const d = dist(raw, v)
    if (d < bestD) {
      best = v
      bestD = d
    }
  }
  if (best) return { p: { ...best }, onVertex: true }

  let { x, y } = raw
  let lockX = false
  let lockY = false
  if (prev) {
    const dx = Math.abs(raw.x - prev.x)
    const dy = Math.abs(raw.y - prev.y)
    if (dy <= dx * ORTHO_TOLERANCE) {
      y = prev.y
      lockY = true
    } else if (dx <= dy * ORTHO_TOLERANCE) {
      x = prev.x
      lockX = true
    }
  }

  const out: Snapped = { p: { x, y }, onVertex: false }
  if (!lockX) {
    const c = closestAxis(vertices.map((v) => v.x), x, threshold)
    if (c != null) {
      out.p.x = c
      out.guideX = c
    }
  }
  if (!lockY) {
    const c = closestAxis(vertices.map((v) => v.y), y, threshold)
    if (c != null) {
      out.p.y = c
      out.guideY = c
    }
  }
  return out
}

function closestAxis(values: number[], target: number, threshold: number): number | null {
  let best: number | null = null
  let bestD = threshold
  for (const v of values) {
    const d = Math.abs(v - target)
    if (d < bestD) {
      best = v
      bestD = d
    }
  }
  return best
}
