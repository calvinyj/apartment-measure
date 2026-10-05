import type { Vec2 } from '../types'
import type { Solved, SolvedRoom } from './solve'
import { add, dot, lineIntersect, outward, scale, sub } from './vec'

export interface WallPiece {
  /** convex footprint in plan mm */
  footprint: Vec2[]
  y0: number
  y1: number
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

/** Openings on this wall plus any drawn on the neighbouring room's side of it. */
function cutsFor(solved: Solved, r: SolvedRoom, k: number): Cut[] {
  const p = r.outline[k]
  const d = r.dirs[k]
  const cuts: Cut[] = r.room.edges[k].openings.map((o) => ({
    from: o.offset,
    to: o.offset + o.width,
    sill: o.sill,
    head: o.sill + o.height,
  }))
  for (const nb of r.edgeInfo[k].neighbors) {
    const other = solved.byId.get(nb.roomId)
    if (!other) continue
    const q = other.outline[nb.edge]
    const e = other.dirs[nb.edge]
    for (const o of other.room.edges[nb.edge].openings) {
      const u1 = dot(sub(add(q, scale(e, o.offset)), p), d)
      const u2 = dot(sub(add(q, scale(e, o.offset + o.width)), p), d)
      cuts.push({ from: Math.min(u1, u2), to: Math.max(u1, u2), sill: o.sill, head: o.sill + o.height })
    }
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
  const pts = r.outline
  const n = pts.length
  const w = r.edgeInfo.map((info) => info.ownThickness)
  const top = Math.min(r.height, displayHeight)
  const pieces: WallPiece[] = []

  const outerLine = (i: number) => ({ p: add(pts[i], scale(outward(r.dirs[i]), w[i])), d: r.dirs[i] })

  for (let k = 0; k < n; k++) {
    if (r.room.edges[k].kind !== 'wall' || w[k] <= 0) continue
    const p0 = pts[k]
    const p1 = pts[(k + 1) % n]
    const d = r.dirs[k]
    const cur = outerLine(k)
    const prev = outerLine((k - 1 + n) % n)
    const next = outerLine((k + 1) % n)
    const o0 = lineIntersect(prev.p, prev.d, cur.p, cur.d) ?? cur.p
    const o1 = lineIntersect(cur.p, cur.d, next.p, next.d) ?? add(p1, scale(outward(d), w[k]))
    const quad = [p0, p1, o1, o0]

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
      for (const [y0, y1] of solidRanges(active, top)) pieces.push({ footprint, y0, y1 })
    }
  }
  return pieces
}
