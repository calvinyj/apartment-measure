import type { PlugPoint, Room, Vec2 } from '../types'
import type { Solved, SolvedRoom } from './solve'
import { add, dist, dot, scale, sub } from './vec'
import { cutsFor } from './walls'

/** Where a plug point sits: on the inside face of one of its room's walls. */
export interface WallSpot {
  /** on the wall's inside face, mm */
  at: Vec2
  /** the room edge it's on */
  edge: number
  /** which way the wall runs, corner A to B; the room is on its right on screen */
  dir: Vec2
  /** the ends of the straight wall it's on (all of its parts) */
  a: Vec2
  b: Vec2
}

/** The point on the room's walls nearest p (open sides don't count); null for a room with no walls. */
export function wallSpot(r: SolvedRoom, p: Vec2): WallSpot | null {
  let best: WallSpot | null = null
  let gap = Infinity
  for (const g of r.groups) {
    if (r.room.edges[g[0]].kind !== 'wall') continue
    for (const i of g) {
      const ab = sub(r.ends[i], r.starts[i])
      const l2 = dot(ab, ab)
      const t = l2 > 0 ? Math.max(0, Math.min(1, dot(sub(p, r.starts[i]), ab) / l2)) : 0
      const at = add(r.starts[i], scale(ab, t))
      if (dist(p, at) < gap) {
        gap = dist(p, at)
        best = { at, edge: i, dir: r.dirs[i], a: r.starts[g[0]], b: r.ends[g[g.length - 1]] }
      }
    }
  }
  return best
}

/** A plug point's spot on its room's walls; null once its room is gone. */
export function plugSpot(solved: Solved, anchors: Map<string, Vec2>, plug: PlugPoint): WallSpot | null {
  const r = solved.byId.get(plug.roomId)
  const anchor = anchors.get(plug.roomId)
  return r && anchor ? wallSpot(r, add(anchor, { x: plug.x, y: plug.y })) : null
}

/** Plug points sit low on the wall, so a door or opening reaching below this is in the way. */
const PLUG_HEIGHT = 300

/** Whether the spot is in a doorway or another opening down to near the floor, entered from either side of the wall. */
export function inDoorway(solved: Solved, r: SolvedRoom, s: WallSpot): boolean {
  const u = dot(sub(s.at, r.starts[s.edge]), r.dirs[s.edge])
  return cutsFor(solved, r, s.edge).some((c) => c.sill < PLUG_HEIGHT && c.from < u && u < c.to)
}

export interface PlugTally {
  /** places on the wall */
  points: number
  /** sockets at them in all */
  sockets: number
}

export interface PlugRow {
  room: Room
  existing: PlugTally
  toAdd: PlugTally
  /** the sockets at each point, in the order placed */
  existingCounts: number[]
  toAddCounts: number[]
}

const tally = (counts: number[]): PlugTally => ({ points: counts.length, sockets: counts.reduce((a, b) => a + b, 0) })

/** Plug points counted room by room (rooms with none are left out), in the rooms' order. */
export function plugSchedule(rooms: Room[], plugs: PlugPoint[]): PlugRow[] {
  return rooms.flatMap((room) => {
    const mine = plugs.filter((p) => p.roomId === room.id)
    if (!mine.length) return []
    const existingCounts = mine.filter((p) => p.existing).map((p) => p.count)
    const toAddCounts = mine.filter((p) => !p.existing).map((p) => p.count)
    return [{ room, existing: tally(existingCounts), toAdd: tally(toAddCounts), existingCounts, toAddCounts }]
  })
}

/** How many points have each number of sockets, fewest sockets first: [[1, 3], [2, 5]] is 3 single and 5 twin. */
export function bySize(counts: number[]): [number, number][] {
  const m = new Map<number, number>()
  for (const c of counts) m.set(c, (m.get(c) ?? 0) + 1)
  return [...m.entries()].sort((a, b) => a[0] - b[0])
}
