import type { Vec2 } from '../types'
import type { Solved, SolvedRoom } from './solve'
import { add, dist, dot, lineIntersect, outward, scale, sub } from './vec'

export interface WallPiece {
  /** convex footprint in plan mm */
  footprint: Vec2[]
  y0: number
  y1: number
  /** the room edge this piece is part of */
  edge: number
  /** per side (footprint[i] → footprint[i + 1]): lies on the wall's outer face, away from the room */
  outer: boolean[]
  /** the top is the wall's full (or cut-away) height, not the sill under an opening */
  fullHeight: boolean
}

interface Cut {
  from: number
  to: number
  sill: number
  head: number
}

/** Keep the part of a convex polygon where dot(p - o, d) is between lo and hi. */
function clipSlab(poly: Vec2[], o: Vec2, d: Vec2, lo: number, hi: number): Vec2[] {
  const clip = (pts: Vec2[], f: (p: Vec2) => number) => {
    const out: Vec2[] = []
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i]
      const b = pts[(i + 1) % pts.length]
      const fa = f(a)
      const fb = f(b)
      if (fa >= 0) out.push(a)
      if (fa >= 0 !== fb >= 0) out.push(add(a, scale(sub(b, a), fa / (fa - fb))))
    }
    return out
  }
  const u = (p: Vec2) => dot(sub(p, o), d)
  return clip(clip(poly, (p) => u(p) - lo), (p) => hi - u(p))
}

function polyArea(pts: Vec2[]) {
  let s = 0
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i]
    const b = pts[(i + 1) % pts.length]
    s += a.x * b.y - b.x * a.y
  }
  return Math.abs(s / 2)
}

/**
 * Openings that cut through edge k: its own, those entered on another part of the
 * same straight wall (positioned from that part's start), and those drawn on the
 * neighbouring room's side of the wall. All are placed in world space, then
 * projected onto this edge.
 */
function cutsFor(solved: Solved, r: SolvedRoom, k: number): Cut[] {
  const p = r.starts[k]
  const d = r.dirs[k]
  const cuts: Cut[] = []
  const add_ = (start: Vec2, dir: Vec2, o: { offset: number; width: number; sill: number; height: number }) => {
    const u1 = dot(sub(add(start, scale(dir, o.offset)), p), d)
    const u2 = dot(sub(add(start, scale(dir, o.offset + o.width)), p), d)
    cuts.push({ from: Math.min(u1, u2), to: Math.max(u1, u2), sill: o.sill, head: o.sill + o.height })
  }
  const group = r.groups.find((g) => g.includes(k)) ?? [k]
  for (const j of group) for (const o of r.room.edges[j].openings) add_(r.starts[j], r.dirs[j], o)

  for (const nb of r.edgeInfo[k].neighbors) {
    const other = solved.byId.get(nb.roomId)
    if (!other) continue
    const otherGroup = other.groups.find((g) => g.includes(nb.edge)) ?? [nb.edge]
    for (const j of otherGroup) for (const o of other.room.edges[j].openings) add_(other.starts[j], other.dirs[j], o)
  }
  return cuts
}

/** Solid vertical ranges within [0, top] once the given cuts are removed. */
function solidRanges(active: Cut[], top: number): [number, number][] {
  const holes = active
    .map((c) => [Math.max(0, c.sill), Math.min(top, c.head)] as [number, number])
    .filter(([a, b]) => b > a)
    .sort((a, b) => a[0] - b[0])
  const out: [number, number][] = []
  let y = 0
  for (const [a, b] of holes) {
    if (a > y) out.push([y, a])
    y = Math.max(y, b)
  }
  if (y < top) out.push([y, top])
  return out
}

/**
 * Walls of a room as prisms. Each room builds the thickness it owns (half of an
 * internal wall, all of an external one) outward from its inner face, with
 * mitred corners so neighbouring segments meet cleanly.
 */
export function roomWallPieces(solved: Solved, r: SolvedRoom, displayHeight: number): WallPiece[] {
  const n = r.starts.length
  const w = r.edgeInfo.map((info) => info.ownThickness)
  const top = Math.min(r.height, displayHeight)
  const pieces: WallPiece[] = []

  const outerLine = (i: number) => ({ p: add(r.starts[i], scale(outward(r.dirs[i]), w[i])), d: r.dirs[i] })
  // Mitre only where two edges actually meet; across a step, ends are square.
  const meets = (i: number, j: number) => dist(r.ends[i], r.starts[j]) < 0.5

  for (let k = 0; k < n; k++) {
    if (r.room.edges[k].kind !== 'wall' || w[k] <= 0) continue
    const p0 = r.starts[k]
    const p1 = r.ends[k]
    const d = r.dirs[k]
    const kPrev = (k - 1 + n) % n
    const kNext = (k + 1) % n
    const cur = outerLine(k)
    const prev = outerLine(kPrev)
    const next = outerLine(kNext)
    const square0 = cur.p
    const square1 = add(p1, scale(outward(d), w[k]))
    const o0 = meets(kPrev, k) ? (lineIntersect(prev.p, prev.d, cur.p, cur.d) ?? square0) : square0
    const o1 = meets(k, kNext) ? (lineIntersect(cur.p, cur.d, next.p, next.d) ?? square1) : square1
    const quad = [p0, p1, o1, o0]
    const onOuter = (q: Vec2) => Math.abs(dot(sub(q, p0), outward(d)) - w[k]) < 0.5

    const L = dot(sub(p1, p0), d)
    const us = quad.map((q) => dot(sub(q, p0), d))
    const uMin = Math.min(...us)
    const uMax = Math.max(...us)
    const cuts = cutsFor(solved, r, k)
      .map((c) => ({ ...c, from: Math.max(0, c.from), to: Math.min(L, c.to) }))
      .filter((c) => c.to > c.from)

    const bounds = [...new Set([uMin, uMax, ...cuts.flatMap((c) => [c.from, c.to])])].sort((a, b) => a - b)
    for (let i = 0; i < bounds.length - 1; i++) {
      const lo = bounds[i]
      const hi = bounds[i + 1]
      if (hi - lo < 0.5) continue
      const mid = (lo + hi) / 2
      const footprint = clipSlab(quad, p0, d, lo, hi)
      if (footprint.length < 3 || polyArea(footprint) < 1) continue
      const active = cuts.filter((c) => c.from <= mid && c.to >= mid)
      const outer = footprint.map((q, j) => onOuter(q) && onOuter(footprint[(j + 1) % footprint.length]))
      for (const [y0, y1] of solidRanges(active, top)) pieces.push({ footprint, y0, y1, edge: k, outer, fullHeight: y1 >= top })
    }
  }
  return pieces
}
