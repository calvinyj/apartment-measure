import { roomTypeInfo, type Vec2 } from '../types'
import type { Solved, SolvedRoom } from './solve'
import { dist, outward } from './vec'

export const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'] as const
export type CompassPoint = (typeof COMPASS)[number]

export const normDeg = (d: number) => ((d % 360) + 360) % 360

/** Compass bearing (0 = north, 90 = east) of a direction on the plan (x right, y down). */
export function bearing(v: Vec2, north: number): number {
  return normDeg((Math.atan2(v.x, -v.y) * 180) / Math.PI - north)
}

export const compassPoint = (deg: number): CompassPoint => COMPASS[Math.round(normDeg(deg) / 45) % 8]

/**
 * Sides of a room that look outdoors going by the plan: outside walls, walls onto a
 * balcony, and open sides with nothing beyond (a balcony's railing). The plan can't
 * tell an outside wall from one against the next unit or a corridor; see `outdoorEdges`.
 */
export function outdoorCandidates(solved: Solved, r: SolvedRoom): number[] {
  const outdoor = (id: string) => {
    const o = solved.byId.get(id)
    return !!o && !!roomTypeInfo(o.room.type).outdoor
  }
  return r.edgeInfo.flatMap((info, i) => {
    if (info.side === 'external') return [i]
    if (!info.neighbors.length) return info.side === 'open' ? [i] : []
    return info.neighbors.every((nb) => outdoor(nb.roomId)) ? [i] : []
  })
}

/** Outdoor sides, minus outside walls the user has marked as not open air. */
export const outdoorEdges = (solved: Solved, r: SolvedRoom) =>
  outdoorCandidates(solved, r).filter((i) => r.room.edges[i].openAir !== false)

/** The compass point an edge looks out to. */
export const edgeFacing = (r: SolvedRoom, i: number, north: number) => compassPoint(bearing(outward(r.dirs[i]), north))

export interface Facing {
  point: CompassPoint
  /** total length of outdoor sides facing this way, mm */
  length: number
}

/** Shorter than this is a column or a wall return, not a side of the room. */
const MIN_FACING = 600

/** Which ways a room looks outdoors, longest first; empty until north is set. */
export function roomFacing(solved: Solved, r: SolvedRoom): Facing[] {
  if (solved.north == null) return []
  const totals = new Map<CompassPoint, number>()
  for (const i of outdoorEdges(solved, r)) {
    const point = edgeFacing(r, i, solved.north)
    totals.set(point, (totals.get(point) ?? 0) + dist(r.starts[i], r.ends[i]))
  }
  return [...totals]
    .filter(([, length]) => length >= MIN_FACING)
    .map(([point, length]) => ({ point, length }))
    .sort((a, b) => b.length - a.length)
}

/** Facades that take the hot afternoon sun near the equator. */
const AFTERNOON: CompassPoint[] = ['SW', 'W', 'NW']

export const isAfternoon = (p: CompassPoint) => AFTERNOON.includes(p)

export const facesAfternoonSun = (f: Facing[]) => f.some((x) => isAfternoon(x.point))

/** The room's own setting wins; otherwise any outdoor side facing roughly west. */
export const isSunny = (solved: Solved, r: SolvedRoom) => r.room.sunny ?? facesAfternoonSun(roomFacing(solved, r))

export const formatFacing = (f: Facing[]) => f.map((x) => x.point).join(', ')
