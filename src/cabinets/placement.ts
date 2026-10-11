import { groupOf } from '../geometry/runs'
import type { Solved, SolvedRoom } from '../geometry/solve'
import { add, cross, dot, lineIntersect, scale, sub } from '../geometry/vec'
import type { Cabinet, CabinetWalls, Vec2 } from '../types'

/** One straight run of a cabinet, along one wall. */
export interface CabinetLeg {
  /** the wall: its edges in the room */
  group: number[]
  /** the wall's number in its room (1, 2, …), as on the Measure tab */
  wallNo: number
  wallLength: number
  /** along the wall from its left corner, mm: where the cabinet's back starts and ends */
  from: number
  to: number
  /** how much of each end is lost to a corner, where the next leg's front meets this one's */
  cornerLeft: number
  cornerRight: number
  /** width of the front, between the corners */
  width: number
  /** the wall's left corner, its direction left to right, and the way into the room, in plan mm */
  origin: Vec2
  dir: Vec2
  inward: Vec2
}

export interface Placement {
  room: SolvedRoom
  legs: CabinetLeg[]
}

export type Placed = { ok: true; placement: Placement } | { ok: false; error: string }

/** Index of each wall (a straight run of edges) in a room, by the room's edges. */
export const wallNumber = (r: SolvedRoom, edge: number) => r.groups.findIndex((g) => g.includes(edge)) + 1

/** Length of a wall along its inside face, left corner to right. */
export function wallLength(r: SolvedRoom, group: number[]) {
  return dot(sub(r.ends[group[group.length - 1]], r.starts[group[0]]), r.dirs[group[0]])
}

/**
 * How far along each wall an inside corner takes up, for a cabinet `depth` deep: where the fronts along
 * the two walls meet. At a square corner it's the depth itself.
 */
function cornerTake(r: SolvedRoom, left: number[], right: number[], depth: number) {
  const d1 = r.dirs[left[left.length - 1]]
  const d2 = r.dirs[right[0]]
  const turn = Math.atan2(cross(d1, d2), dot(d1, d2))
  // The inside angle is π - turn; fronts `depth` out meet depth / tan(angle / 2) from the corner.
  return depth / Math.tan((Math.PI - turn) / 2)
}

/** The walls a cabinet runs along, or why it can't. */
export function resolveWalls(solved: Solved, w: CabinetWalls): { ok: true; room: SolvedRoom; groups: number[][] } | { ok: false; error: string } {
  const r = solved.byId.get(w.roomId)
  if (!r) return { ok: false, error: 'Its room is gone. Pick its walls again.' }
  const groups: number[][] = []
  for (const id of w.edgeIds) {
    const i = r.room.edges.findIndex((e) => e.id === id)
    if (i < 0) return { ok: false, error: 'One of its walls is gone. Pick its walls again.' }
    const g = groupOf(r.groups, i)
    if (r.room.edges[g[0]].kind !== 'wall') return { ok: false, error: `Wall ${wallNumber(r, i)} is open (no wall).` }
    groups.push(g)
  }
  if (!groups.length) return { ok: false, error: 'It isn’t on a wall yet.' }
  const n = r.room.edges.length
  for (let k = 0; k + 1 < groups.length; k++) {
    const last = groups[k][groups[k].length - 1]
    if ((last + 1) % n !== groups[k + 1][0]) return { ok: false, error: 'Its walls aren’t next to each other.' }
    if (cross(r.dirs[last], r.dirs[groups[k + 1][0]]) <= 0)
      return { ok: false, error: `It turns round an outside corner after wall ${wallNumber(r, last)}.` }
  }
  return { ok: true, room: r, groups }
}

/**
 * Lay a cabinet along its walls. Its first leg starts `start` from the first wall's left corner; each leg but
 * the last runs into the corner, and the last runs `length` (or to its wall's right corner).
 */
export function placeCabinet(solved: Solved, c: Pick<Cabinet, 'walls' | 'depth'>): Placed {
  const res = resolveWalls(solved, c.walls)
  if (!res.ok) return res
  const { room: r, groups } = res
  const n = groups.length
  const takes = groups.slice(1).map((g, k) => cornerTake(r, groups[k], g, c.depth))
  const legs = groups.map((group, k): CabinetLeg => {
    const wallLen = wallLength(r, group)
    const from = k === 0 ? c.walls.start : 0
    const to = k < n - 1 ? wallLen : c.walls.length == null ? wallLen : from + c.walls.length
    const cornerLeft = k > 0 ? takes[k - 1] : 0
    const cornerRight = k < n - 1 ? takes[k] : 0
    const dir = r.dirs[group[0]]
    return {
      group,
      wallNo: wallNumber(r, group[0]),
      wallLength: wallLen,
      from,
      to,
      cornerLeft,
      cornerRight,
      width: to - from - cornerLeft - cornerRight,
      origin: r.starts[group[0]],
      dir,
      inward: { x: -dir.y, y: dir.x },
    }
  })
  return { ok: true, placement: { room: r, legs } }
}

/** A point on a leg's wall, `u` from its left corner and `v` out into the room. */
export const legPoint = (leg: CabinetLeg, u: number, v = 0) => add(add(leg.origin, scale(leg.dir, u)), scale(leg.inward, v))

/**
 * The cabinet seen from above, `depth` deep: along the walls from its left end to its right, then back
 * along its front. For the stone top, pass the depth with the overhang.
 */
export function outline(p: Placement, depth: number): Vec2[] {
  const { legs } = p
  const back: Vec2[] = [legPoint(legs[0], legs[0].from)]
  const front: Vec2[] = [legPoint(legs[0], legs[0].from, depth)]
  for (let k = 0; k + 1 < legs.length; k++) {
    const a = legs[k]
    const b = legs[k + 1]
    back.push(legPoint(a, a.to))
    const fa = legPoint(a, 0, depth)
    const fb = legPoint(b, 0, depth)
    front.push(lineIntersect(fa, a.dir, fb, b.dir) ?? legPoint(a, a.to - depth, depth))
  }
  const last = legs[legs.length - 1]
  back.push(legPoint(last, last.to))
  front.push(legPoint(last, last.to, depth))
  return [...back, ...front.reverse()]
}

/** The carcass of each leg as built: the leg before a corner runs into it, the one after starts at its front. */
export const carcassLength = (leg: CabinetLeg) => leg.to - leg.from - leg.cornerLeft

/** Total front width, all legs. */
export const frontWidth = (p: Placement) => p.legs.reduce((s, l) => s + l.width, 0)

export function shapeLabel(legs: number) {
  return legs === 1 ? 'Straight' : legs === 2 ? 'L-shape' : 'U-shape'
}
