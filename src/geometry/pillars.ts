import polygonClipping from 'polygon-clipping'
import type { Pillar, Room, Vec2 } from '../types'
import { multiPolygonArea, pointInPolygon, signedArea } from './polygon'
import type { SolvedRoom } from './solve'
import { add, dist, dot, lerp, norm, outward, scale, sub } from './vec'

/** A pillar on the plan. */
export interface PlacedPillar {
  pillar: Pillar
  /** the room edge it's entered on */
  edge: number
  /**
   * In plan mm: its near and far corners on the wall's face, then out into the room. Wound like a
   * room's outline (positive signed area).
   */
  footprint: Vec2[]
}

/** A pillar `offset` along a wall face that starts at `start` and runs along `dir`. */
export function pillarFootprint(start: Vec2, dir: Vec2, offset: number, p: Pick<Pillar, 'width' | 'depth'>): Vec2[] {
  const inward = scale(outward(dir), -1)
  const a = add(start, scale(dir, offset))
  const b = add(start, scale(dir, offset + p.width))
  return [a, b, add(b, scale(inward, p.depth)), add(a, scale(inward, p.depth))]
}

/**
 * The room's pillars against the inside faces of its walls, given where each edge's face starts and
 * ends (as solved, or as on the plan). One in a corner goes in the corner of its whole straight wall;
 * otherwise it's `offset` from the start of the part it's entered on, as openings are.
 */
export function placePillars(room: Room, groups: number[][], starts: Vec2[], ends: Vec2[], dirs: Vec2[]): PlacedPillar[] {
  return room.edges.flatMap((e, i) => {
    if (e.kind !== 'wall') return []
    const g = groups.find((x) => x.includes(i)) ?? [i]
    const last = g[g.length - 1]
    return (e.pillars ?? [])
      .filter((p) => p.width > 0 && p.depth > 0)
      .map((pillar) => ({
        pillar,
        edge: i,
        footprint:
          pillar.at === 'a'
            ? pillarFootprint(starts[g[0]], dirs[g[0]], 0, pillar)
            : pillar.at === 'b'
              ? pillarFootprint(ends[last], dirs[last], -pillar.width, pillar)
              : pillarFootprint(starts[i], dirs[i], pillar.offset, pillar),
      }))
  })
}

const ring = (pts: Vec2[]) => pts.map((p) => [p.x, p.y] as [number, number])

/** How much of the outline's floor the pillars stand on, mm² (where they overlap, once). */
export function pillarArea(outline: Vec2[], pillars: PlacedPillar[]): number {
  if (!pillars.length || outline.length < 3) return 0
  try {
    const all = polygonClipping.union([ring(pillars[0].footprint)], ...pillars.slice(1).map((p) => [ring(p.footprint)]))
    return multiPolygonArea(polygonClipping.intersection([ring(outline)], all))
  } catch {
    // The clipper can trip over near-degenerate shapes; pillars side by side are near enough.
    return pillars.reduce((sum, p) => sum + Math.abs(signedArea(p.footprint)), 0)
  }
}

/** Whether a shape on the plan (mm) takes up more than a sliver of a pillar's floor. */
export function overlapsPillar(shape: Vec2[], p: PlacedPillar): boolean {
  if (shape.length < 3) return false
  try {
    return multiPolygonArea(polygonClipping.intersection([ring(shape)], [ring(p.footprint)])) > 100
  } catch {
    return false
  }
}

/** How near a wall's face can be to a pillar and still be hidden by it, mm: traced corners aren't always square. */
const TOUCH = 20

/** The part of segment a→b inside a convex polygon grown by `tol`, as [t0, t1] along it; null if none. */
function clipToConvex(a: Vec2, b: Vec2, poly: Vec2[], tol: number): [number, number] | null {
  const s = signedArea(poly) >= 0 ? 1 : -1
  const ab = sub(b, a)
  let t0 = 0
  let t1 = 1
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i]
    // The polygon's outward normal along this side: inside is dot(x - p, n) <= tol.
    const n = scale(outward(norm(sub(poly[(i + 1) % poly.length], p))), s)
    const f = dot(sub(a, p), n) - tol
    const df = dot(ab, n)
    if (Math.abs(df) < 1e-9) {
      if (f > 0) return null
      continue
    }
    const t = -f / df
    if (df > 0) t1 = Math.min(t1, t)
    else t0 = Math.max(t0, t)
    if (t0 >= t1) return null
  }
  return [t0, t1]
}

/** [lo, hi] less the given intervals. */
function clearOf(lo: number, hi: number, taken: [number, number][]): [number, number][] {
  const out: [number, number][] = []
  let at = lo
  for (const [a, b] of [...taken].sort((x, y) => x[0] - y[0])) {
    if (a > at) out.push([at, Math.min(a, hi)])
    at = Math.max(at, b)
    if (at >= hi) break
  }
  if (at < hi) out.push([at, hi])
  return out.filter(([a, b]) => b - a >= 1)
}

/** A stretch of wall face you can stand at and fix things to: a wall's inside face clear of pillars, or a pillar's face. */
export interface WallFace {
  /** its ends; it runs the way the room's walls do, with the room on its right on screen */
  a: Vec2
  b: Vec2
  dir: Vec2
  /** the room edge it's on; for a pillar's face, the edge the pillar is entered on */
  edge: number
  /** the clear stretch it's part of, end to end: from corner to corner, or to the side of a pillar */
  from: Vec2
  to: Vec2
  /** the pillar it's a face of */
  pillar?: string
}

/**
 * The room's wall faces as you'd find them on site: its walls (open sides don't count) less where pillars
 * stand against them, and the pillars' faces that are out in the room.
 */
export function wallFaces(r: SolvedRoom): WallFace[] {
  const out: WallFace[] = []
  for (const g of r.groups) {
    if (r.room.edges[g[0]].kind !== 'wall') continue
    const A = r.starts[g[0]]
    const B = r.ends[g[g.length - 1]]
    const d = r.dirs[g[0]]
    const u = (p: Vec2) => dot(sub(p, A), d)
    const L = u(B)
    // Where pillars stand against it, along it from corner A.
    const taken: [number, number][] = []
    for (const i of g)
      for (const p of r.pillars) {
        const t = clipToConvex(r.starts[i], r.ends[i], p.footprint, TOUCH)
        if (!t) continue
        // No wider along the wall than the pillar is, though it's grown to reach the wall.
        const us = p.footprint.map(u)
        const lo = Math.max(u(lerp(r.starts[i], r.ends[i], t[0])), Math.min(...us))
        const hi = Math.min(u(lerp(r.starts[i], r.ends[i], t[1])), Math.max(...us))
        if (hi > lo) taken.push([lo, hi])
      }
    const clear = clearOf(0, L, taken)
    for (const i of g) {
      const u0 = u(r.starts[i])
      const u1 = u(r.ends[i])
      if (u1 - u0 < 1) continue
      const at = (x: number) => lerp(r.starts[i], r.ends[i], (x - u0) / (u1 - u0))
      for (const [c0, c1] of clear) {
        const lo = Math.max(u0, c0)
        const hi = Math.min(u1, c1)
        if (hi - lo < 1) continue
        out.push({
          a: at(lo),
          b: at(hi),
          dir: r.dirs[i],
          edge: i,
          from: c0 <= 0.5 ? A : add(A, scale(d, c0)),
          to: c1 >= L - 0.5 ? B : add(A, scale(d, c1)),
        })
      }
    }
  }
  for (const p of r.pillars) {
    const [a, b, c, e] = p.footprint
    // Round it the way the walls run: out along its near side, across its front, back along its far side.
    for (const [from, to] of [
      [a, e],
      [e, c],
      [c, b],
    ]) {
      if (dist(from, to) < 1) continue
      const dir = norm(sub(to, from))
      // Out in the room, not against a wall (a pillar in a corner) or another pillar.
      const probe = add(lerp(from, to, 0.5), scale(outward(dir), -1))
      if (!pointInPolygon(probe, r.outline) || r.pillars.some((o) => o !== p && pointInPolygon(probe, o.footprint))) continue
      out.push({ a: from, b: to, dir, edge: p.edge, from, to, pillar: p.pillar.id })
    }
  }
  return out
}

/** Length of the room's wall faces, pillars' included: what gets painted, along the floor. */
export const wallFaceLength = (r: SolvedRoom) => wallFaces(r).reduce((sum, f) => sum + dist(f.a, f.b), 0)
