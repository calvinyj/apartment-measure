import type { Calibration, Project } from '../types'
import { groupMeasured } from './runs'
import { mmPerPx, solveProject } from './solve'
import { dist } from './vec'

/** A reading this far off the plan is probably a typo, the wrong wall, or a spot where the plan is wrong. */
export const deviates = (measured: number, estimate: number) => Math.abs(measured - estimate) > Math.max(150, estimate * 0.08)

export interface ScaleFit {
  /** mm per plan pixel that best fits the measured walls */
  mmPerPx: number
  /** fitted ÷ current scale: 1.03 means the walls are 3% longer than the plan shows */
  factor: number
  /** measured walls the fit is based on */
  used: number
  /** measured walls left out because they're far off the plan even at the fitted scale */
  outliers: number
}

/** The same scale line, given the real length that makes it `k` mm per pixel. */
export function withScale(c: Calibration, k: number): Calibration {
  return { ...c, mm: k * dist(c.a, c.b) }
}

interface MeasuredWall {
  /** tape length, mm */
  m: number
  /** traced length, plan px */
  px: number
  /** how much shorter the inside face is than the traced line (wall thickness), mm; it doesn't scale with the plan */
  inset: number
}

function measuredWalls(project: Project): MeasuredWall[] {
  const solved = solveProject(project)
  const k = solved.mmPerPx ?? 1
  return solved.rooms.flatMap((r) => {
    const pts = r.room.points
    return r.groups.flatMap((g) => {
      const m = groupMeasured(r.room, g)
      const px = g.reduce((sum, i) => sum + dist(pts[i], pts[(i + 1) % pts.length]), 0)
      if (m == null || m <= 0 || px < 1) return []
      const estimate = g.reduce((sum, i) => sum + r.estimates[i], 0)
      return [{ m, px, inset: k * px - estimate }]
    })
  })
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b)
  const mid = s.length >> 1
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}

/**
 * The plan scale that best fits the walls measured on site. Each wall says
 * measured ≈ k × traced px − inset. Walls far off the median are left out (a
 * typo, or a spot where the plan is wrong), then k is fitted to the rest by
 * least squares, so long walls count most. Insets shift a little with the
 * scale (the gap between rooms is read off the plan), so this repeats until
 * k settles.
 */
export function fitScale(project: Project): ScaleFit | null {
  const c = project.calibration
  const k0 = mmPerPx(project)
  if (!c || !k0) return null
  let k = k0
  let used = 0
  let outliers = 0
  for (let iter = 0; iter < 5; iter++) {
    const walls = measuredWalls({ ...project, calibration: withScale(c, k) })
    if (!walls.length) return null
    const mid = median(walls.map((w) => (w.m + w.inset) / w.px))
    const inliers = walls.filter((w) => !deviates(w.m, mid * w.px - w.inset))
    const fit = inliers.length ? inliers : walls
    const next = fit.reduce((s, w) => s + (w.m + w.inset) * w.px, 0) / fit.reduce((s, w) => s + w.px * w.px, 0)
    used = fit.length
    outliers = walls.length - fit.length
    const settled = Math.abs(next - k) < 1e-6 * k
    k = next
    if (settled) break
  }
  return { mmPerPx: k, factor: k / k0, used, outliers }
}
