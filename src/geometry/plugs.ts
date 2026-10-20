import type { PlugPoint, Room, Vec2 } from '../types'
import type { Solved, SolvedRoom } from './solve'
import { add, dist, dot, scale, sub } from './vec'
import { wallFaces } from './pillars'
import { cutsFor } from './walls'

/** Where a plug point sits: on the inside face of one of its room's walls, or on a pillar's face. */
export interface WallSpot {
  /** on the wall's inside face, mm */
  at: Vec2
  /** the room edge it's on (for a pillar, the edge the pillar is entered on) */
  edge: number
  /** which way the wall runs, corner A to B; the room is on its right on screen */
  dir: Vec2
  /** the ends of the stretch of wall it's on (all of its parts): its corners, or the side of a pillar in the way */
  a: Vec2
  b: Vec2
  /** the pillar whose face it's on */
  pillar?: string
}

/** The point on the room's walls nearest p (open sides don't count; pillars' faces do); null for a room with no walls. */
export function wallSpot(r: SolvedRoom, p: Vec2): WallSpot | null {
  let best: WallSpot | null = null
  let gap = Infinity
  for (const f of wallFaces(r)) {
    const ab = sub(f.b, f.a)
    const l2 = dot(ab, ab)
    const t = l2 > 0 ? Math.max(0, Math.min(1, dot(sub(p, f.a), ab) / l2)) : 0
    const at = add(f.a, scale(ab, t))
    if (dist(p, at) < gap) {
      gap = dist(p, at)
      best = { at, edge: f.edge, dir: f.dir, a: f.from, b: f.to, pillar: f.pillar }
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
  if (s.pillar) return false
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
  /** the points themselves, in the order placed */
  existingPlugs: PlugPoint[]
  toAddPlugs: PlugPoint[]
}

const tally = (plugs: PlugPoint[]): PlugTally => ({
  points: plugs.length,
  sockets: plugs.reduce((sum, p) => sum + p.count, 0),
})

/** Plug points counted room by room (rooms with none are left out), in the rooms' order. */
export function plugSchedule(rooms: Room[], plugs: PlugPoint[]): PlugRow[] {
  return rooms.flatMap((room) => {
    const mine = plugs.filter((p) => p.roomId === room.id)
    if (!mine.length) return []
    const existingPlugs = mine.filter((p) => p.existing)
    const toAddPlugs = mine.filter((p) => !p.existing)
    return [{ room, existing: tally(existingPlugs), toAdd: tally(toAddPlugs), existingPlugs, toAddPlugs }]
  })
}

/** How many points have each number of sockets, fewest sockets first: [[1, 3], [2, 5]] is 3 single and 5 twin. */
export function bySize(counts: number[]): [number, number][] {
  const m = new Map<number, number>()
  for (const c of counts) m.set(c, (m.get(c) ?? 0) + 1)
  return [...m.entries()].sort((a, b) => a[0] - b[0])
}
