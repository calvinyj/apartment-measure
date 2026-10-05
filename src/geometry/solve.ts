import polygonClipping, { type MultiPolygon, type Polygon } from 'polygon-clipping'
import type { Project, Room, Settings, Vec2 } from '../types'
import { closeRoom, type ClosureResult } from './closure'
import { add, dist, dot, norm, outward, scale, sub } from './vec'
import { layoutRooms, type LayoutLink } from './layout'
import { area, centroid, offsetPolygon, signedArea } from './polygon'

export interface Neighbor {
  roomId: string
  edge: number
  /** plan distance between the two inner faces, mm (≈ wall thickness) */
  gap: number
  /** overlap along this edge, mm from its start corner */
  from: number
  to: number
}

export interface EdgeInfo {
  side: 'internal' | 'external' | 'open'
  /** full wall thickness in mm (0 for open edges) */
  thickness: number
  /** thickness this room "owns": half of an internal wall, all of an external one */
  ownThickness: number
  neighbors: Neighbor[]
  /** median plan gap to neighbours, a hint for the real wall thickness */
  planGap: number | null
}

export interface SolvedRoom {
  room: Room
  planMm: Vec2[]
  dirs: Vec2[]
  estimates: number[]
  closure: ClosureResult
  /** final inner-face outline in mm, anchored on the plan */
  outline: Vec2[]
  area: number
  height: number
  wallLength: number
  wallCount: number
  measuredCount: number
  status: 'empty' | 'partial' | 'complete'
  closureOk: boolean
  edgeInfo: EdgeInfo[]
}

export interface Solved {
  mmPerPx: number | null
  rooms: SolvedRoom[]
  byId: Map<string, SolvedRoom>
  netArea: number
  netIndoorArea: number
  grossArea: number
  grossOutline: MultiPolygon
}

export function mmPerPx(p: Project): number | null {
  const c = p.calibration
  if (!c) return null
  const d = dist(c.a, c.b)
  return d > 0 ? c.mm / d : null
}

const PARALLEL = 0.995
const MAX_GAP = 600
const MIN_OVERLAP = 50

function findNeighbors(rooms: { room: Room; planMm: Vec2[] }[]): Map<string, Neighbor[][]> {
  const out = new Map<string, Neighbor[][]>()
  for (const A of rooms) {
    const n = A.planMm.length
    const lists: Neighbor[][] = A.planMm.map(() => [])
    for (let i = 0; i < n; i++) {
      const p = A.planMm[i]
      const q = A.planMm[(i + 1) % n]
      const L = dist(p, q)
      if (L < 1) continue
      const d = norm(sub(q, p))
      const nrm = outward(d)
      for (const B of rooms) {
        if (B === A) continue
        const m = B.planMm.length
        for (let j = 0; j < m; j++) {
          const r = B.planMm[j]
          const s = B.planMm[(j + 1) % m]
          const e = norm(sub(s, r))
          if (dot(d, e) > -PARALLEL) continue
          const gap = (dot(sub(r, p), nrm) + dot(sub(s, p), nrm)) / 2
          if (gap < -50 || gap > MAX_GAP) continue
          const tr = dot(sub(r, p), d)
          const ts = dot(sub(s, p), d)
          const from = Math.max(0, Math.min(tr, ts))
          const to = Math.min(L, Math.max(tr, ts))
          if (to - from < MIN_OVERLAP) continue
          lists[i].push({ roomId: B.room.id, edge: j, gap: Math.max(0, gap), from, to })
        }
      }
    }
    out.set(A.room.id, lists)
  }
  return out
}

function coverage(neighbors: Neighbor[], L: number): number {
  const iv = neighbors.map((nb) => [nb.from, nb.to]).sort((a, b) => a[0] - b[0])
  let covered = 0
  let end = -Infinity
  for (const [a, b] of iv) {
    if (b <= end) continue
    covered += b - Math.max(a, end)
    end = b
  }
  return L > 0 ? covered / L : 0
}

export function solveProject(project: Project): Solved {
  const k = mmPerPx(project)
  const s = project.settings
  const base = project.rooms.map((room) => ({
    room,
    planMm: room.points.map((p) => scale(p, k ?? 1)),
  }))
  const neighborMap = findNeighbors(base)

  const partial = base.map(({ room, planMm }) => {
    const n = planMm.length
    const dirs = planMm.map((p, i) => norm(sub(planMm[(i + 1) % n], p)))
    const estimates = planMm.map((p, i) => dist(p, planMm[(i + 1) % n]))
    const closure = closeRoom(
      room.edges.map((e, i) => ({
        dir: dirs[i],
        length: e.measured ?? estimates[i],
        measured: e.measured != null,
      })),
    )
    const walk: Vec2[] = [{ x: 0, y: 0 }]
    for (let i = 0; i < n - 1; i++) walk.push(add(walk[i], scale(dirs[i], closure.lengths[i])))

    const lists = neighborMap.get(room.id) ?? []
    const edgeInfo: EdgeInfo[] = room.edges.map((e, i) => {
      const neighbors = lists[i] ?? []
      const gaps = neighbors.map((nb) => nb.gap).sort((a, b) => a - b)
      const planGap = gaps.length ? gaps[Math.floor(gaps.length / 2)] : null
      if (e.kind === 'open') return { side: 'open', thickness: 0, ownThickness: 0, neighbors, planGap }
      const side =
        e.side !== 'auto' ? e.side : coverage(neighbors, estimates[i]) >= 0.5 ? 'internal' : 'external'
      const thickness = e.thickness ?? (side === 'internal' ? s.internalThickness : s.externalThickness)
      return {
        side,
        thickness,
        ownThickness: side === 'internal' ? thickness / 2 : thickness,
        neighbors,
        planGap,
      }
    })
    return { room, planMm, dirs, estimates, closure, walk, edgeInfo }
  })

  const index = new Map(partial.map((r, i) => [r.room.id, i]))
  const links: LayoutLink[] = []
  partial.forEach((A, ai) => {
    A.edgeInfo.forEach((info, i) => {
      for (const nb of info.neighbors) {
        const bi = index.get(nb.roomId)
        if (bi == null || bi <= ai) continue
        const other = partial[bi].edgeInfo[nb.edge]
        const walls = [info, other].filter((x) => x.side !== 'open')
        const gap = walls.length ? walls.reduce((sum, x) => sum + x.thickness, 0) / walls.length : 0
        links.push({ a: ai, edgeA: i, b: bi, edgeB: nb.edge, normal: outward(A.dirs[i]), gap, weight: (nb.to - nb.from) / 1000 })
      }
    })
  })
  const shifts = layoutRooms(
    partial.map((r) => ({ walk: r.walk, prior: sub(centroid(r.planMm), centroid(r.walk)) })),
    links,
  )

  const rooms: SolvedRoom[] = partial.map((r, ri) => {
    const outline = r.walk.map((p) => add(p, shifts[ri]))
    const walls = r.room.edges.filter((e) => e.kind === 'wall')
    const measuredCount = walls.filter((e) => e.measured != null).length
    return {
      ...r,
      outline,
      area: area(outline),
      height: r.room.height ?? s.defaultHeight,
      wallLength: r.room.edges.reduce((sum, e, i) => sum + (e.kind === 'wall' ? r.closure.lengths[i] : 0), 0),
      wallCount: walls.length,
      measuredCount,
      // Complete = every length is pinned down by measurements (a skipped wall can be derived).
      status: measuredCount === 0 ? 'empty' : r.closure.determined ? 'complete' : 'partial',
      closureOk: r.closure.measuredError <= s.closureTolerance,
    }
  })

  const byId = new Map(rooms.map((r) => [r.room.id, r]))
  const grossOutline = grossFootprint(rooms, s)
  return {
    mmPerPx: k,
    rooms,
    byId,
    netArea: rooms.reduce((a, r) => a + r.area, 0),
    netIndoorArea: rooms.filter((r) => r.room.type !== 'balcony').reduce((a, r) => a + r.area, 0),
    grossArea: multiPolygonArea(grossOutline),
    grossOutline,
  }
}

/** Each room grown by the wall thickness it owns, then unioned: the built-up footprint. */
function grossFootprint(rooms: SolvedRoom[], s: Settings): MultiPolygon {
  const polys: Polygon[] = rooms
    .filter((r) => r.outline.length >= 3 && signedArea(r.outline) > 0)
    .map((r) => {
      const offsets = r.edgeInfo.map((info) => {
        if (info.side === 'open') return 0
        if (info.side === 'external') return info.thickness * s.externalShare
        return info.ownThickness
      })
      const ring = offsetPolygon(r.outline, offsets).map((p) => [p.x, p.y] as [number, number])
      return [ring]
    })
  if (polys.length === 0) return []
  return polygonClipping.union(polys[0], ...polys.slice(1))
}

function ringArea(ring: [number, number][]): number {
  let a = 0
  for (let i = 0; i < ring.length; i++) {
    const [x1, y1] = ring[i]
    const [x2, y2] = ring[(i + 1) % ring.length]
    a += x1 * y2 - x2 * y1
  }
  return Math.abs(a / 2)
}

export function multiPolygonArea(mp: MultiPolygon): number {
  return mp.reduce((sum, poly) => sum + ringArea(poly[0]) - poly.slice(1).reduce((h, r) => h + ringArea(r), 0), 0)
}
