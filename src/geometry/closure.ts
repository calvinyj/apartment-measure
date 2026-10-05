import type { Vec2 } from '../types'
import { cross, dot, len } from './vec'

export interface ClosureEdge {
  /** unit direction of the wall, taken from the traced plan */
  dir: Vec2
  /** measured length, or the plan estimate when not measured (mm) */
  length: number
  measured: boolean
}

export interface ClosureResult {
  lengths: number[]
  adjustments: number[]
  /** gap left when walking the room with the raw lengths (mm) */
  misclosure: Vec2
  /** part of the misclosure that had to be absorbed by measured walls (mm) */
  measuredError: number
  /**
   * full: every wall measured, both axes are checked
   * partial: unmeasured walls absorb error along one axis only
   * none: unmeasured walls can absorb any error, so nothing is checked
   */
  checkable: 'full' | 'partial' | 'none'
  /** false when some lengths could only come from the plan's scale */
  determined: boolean
}

/** Expected measurement noise; a tape over a longer wall is less precise. */
export const measuredSigma = (length: number) => 2 + 0.001 * length
/** Unmeasured walls are loose priors around their plan estimate. */
const UNMEASURED_SIGMA = 1000

/**
 * Least-squares closure: walls keep their plan directions; lengths are adjusted
 * minimally (weighted by their uncertainty) so the outline closes exactly.
 */
export function closeRoom(edges: ClosureEdge[]): ClosureResult {
  const sig2 = edges.map((e) => (e.measured ? measuredSigma(e.length) : UNMEASURED_SIGMA) ** 2)

  const e = { x: 0, y: 0 }
  let a = 0
  let b = 0
  let c = 0
  edges.forEach((ed, i) => {
    e.x += ed.length * ed.dir.x
    e.y += ed.length * ed.dir.y
    a += sig2[i] * ed.dir.x * ed.dir.x
    b += sig2[i] * ed.dir.x * ed.dir.y
    c += sig2[i] * ed.dir.y * ed.dir.y
  })
  const det = a * c - b * b
  const lambda = det > 1e-12 ? { x: (c * e.x - b * e.y) / det, y: (a * e.y - b * e.x) / det } : { x: 0, y: 0 }

  const adjustments = edges.map((ed, i) => -sig2[i] * dot(ed.dir, lambda))
  const lengths = edges.map((ed, i) => ed.length + adjustments[i])

  const absorbed = { x: 0, y: 0 }
  edges.forEach((ed, i) => {
    if (!ed.measured) return
    absorbed.x += adjustments[i] * ed.dir.x
    absorbed.y += adjustments[i] * ed.dir.y
  })

  const free = edges.filter((ed) => !ed.measured).map((ed) => ed.dir)
  const spansTwoAxes = free.some((d1, i) => free.some((d2, j) => j > i && Math.abs(cross(d1, d2)) > 0.1))
  const checkable = free.length === 0 ? 'full' : spansTwoAxes ? 'none' : 'partial'
  const determined = free.length <= 1 || (free.length === 2 && spansTwoAxes)

  return { lengths, adjustments, misclosure: e, measuredError: len(absorbed), checkable, determined }
}
