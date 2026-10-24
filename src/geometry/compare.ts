import { closeRoom } from './closure'
import { groupMeasured } from './runs'
import type { Solved, SolvedRoom } from './solve'
import type { Vec2 } from '../types'
import { add, cross, len, sub } from './vec'

/** Within this of the plan, a wall is as planned: a plan isn't drawn any closer than this. */
export const matchesPlan = (length: number, plan: number) => Math.abs(length - plan) <= Math.max(50, plan * 0.02)

/**
 * What a measured wall says against the plan, and against the room's other walls:
 * - ok: as planned (or the room's other walls are the odd ones out, and they're flagged themselves)
 * - recheck: off the plan, while the room's other walls make it about as planned: probably a misread
 * - conflict: the room's other walls don't agree with it, and it can't be told which is off
 * - step: they'd agree if each open side were flush with the wall beside it on the same line, rather than on the
 *   traced line with the wall's face set in from it
 * - differs: off the plan, and the room's other walls agree: the room isn't built as drawn
 * - unchecked: off the plan, and no other measured wall checks it
 */
export type WallVerdict = 'ok' | 'recheck' | 'conflict' | 'step' | 'differs' | 'unchecked'

export interface WallComparison {
  roomId: string
  /** its edges: a straight wall traced in parts is measured as one */
  group: number[]
  /** its number on the Measure tab */
  n: number
  plan: number
  measured: number
  /** what the room's other measured walls make it, closing the room without it; null = they don't pin it down */
  others: number | null
  /** the same with each open side flush with the wall beside it; null = the room has no such step */
  flush: number | null
  verdict: WallVerdict
}

/** Every measured wall of a room, against the plan and against the room's other walls. */
export function compareRoom(s: SolvedRoom, tolerance: number): WallComparison[] {
  const n = s.room.edges.length
  // The small steps where two faces on one traced line meet, as the room was closed with them. Where an open side
  // meets a wall, the open side keeps the traced line and the wall's face is set in from it.
  let steps: Vec2 = { x: 0, y: 0 }
  let flushSteps: Vec2 = { x: 0, y: 0 }
  s.planEnds.forEach((e, i) => {
    const step = sub(s.planStarts[(i + 1) % n], e)
    steps = add(steps, step)
    if (s.room.edges[i].kind === 'wall' && s.room.edges[(i + 1) % n].kind === 'wall') flushSteps = add(flushSteps, step)
  })
  const hasStep = len(sub(steps, flushSteps)) > 1
  return s.groups.flatMap((group, k) => {
    const measured = groupMeasured(s.room, group)
    if (measured == null) return []
    const plan = group.reduce((sum, i) => sum + s.estimates[i], 0)
    const others = otherWallsSay(s, group, steps)
    const flush = hasStep ? otherWallsSay(s, group, flushSteps) : null
    return [{ roomId: s.room.id, group, n: k + 1, plan, measured, others, flush, verdict: verdictOf(measured, plan, others, flush, tolerance) }]
  })
}

export function compareWalls(solved: Solved, tolerance: number): WallComparison[] {
  return solved.rooms.flatMap((s) => compareRoom(s, tolerance))
}

/**
 * The wall's length from closing the room with it left unmeasured. The other unmeasured walls can take up any
 * change in a direction they span, so it's only pinned down when they don't span its own.
 */
function otherWallsSay(s: SolvedRoom, group: number[], steps: Vec2): number | null {
  const free = s.room.edges.flatMap((e, i) => (e.measured == null && !group.includes(i) ? [s.dirs[i]] : []))
  const d = s.dirs[group[0]]
  if (free.some((a) => Math.abs(cross(a, d)) <= 0.1)) return null
  if (free.some((a, i) => free.some((b, j) => j > i && Math.abs(cross(a, b)) > 0.1))) return null
  const c = closeRoom(
    s.room.edges.map((e, i) => {
      const measured = e.measured != null && !group.includes(i)
      return { dir: s.dirs[i], length: measured ? (e.measured as number) : s.estimates[i], measured }
    }),
    steps,
  )
  return group.reduce((sum, i) => sum + c.lengths[i], 0)
}

function verdictOf(measured: number, plan: number, others: number | null, flush: number | null, tolerance: number): WallVerdict {
  const asPlanned = matchesPlan(measured, plan)
  if (others == null) return asPlanned ? 'ok' : 'unchecked'
  if (Math.abs(measured - others) <= tolerance) return asPlanned ? 'ok' : 'differs'
  if (flush != null && Math.abs(measured - flush) <= tolerance) return asPlanned ? 'ok' : 'step'
  const othersAsPlanned = matchesPlan(others, plan)
  if (othersAsPlanned && !asPlanned) return 'recheck'
  if (asPlanned && !othersAsPlanned) return 'ok'
  return 'conflict'
}
