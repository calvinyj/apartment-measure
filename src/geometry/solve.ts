import polygonClipping, { type MultiPolygon, type Polygon } from 'polygon-clipping'
import type { Project, Room, Settings, TraceMode, Vec2 } from '../types'
import { closeRoom, type ClosureResult } from './closure'
import { add, dist, dot, lineIntersect, norm, outward, scale, sub } from './vec'
import { layoutRooms, type LayoutLink } from './layout'
import { groupMeasured, measureGroups } from './runs'
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
  /** outline as traced, in mm */
  traced: Vec2[]
  /** inside-face outline according to the plan, in mm (may include small steps) */
  planMm: Vec2[]
  /** where each edge starts and ends on its inside face, per the plan */
  planStarts: Vec2[]
  planEnds: Vec2[]
  dirs: Vec2[]
  estimates: number[]
  closure: ClosureResult
  /** final inside-face outline in mm, anchored on the plan (may include small steps) */
  outline: Vec2[]
  /** for each outline segment, the edge it belongs to, or -1 for a step between two edges */
  outlineEdge: number[]
  /** final start and end of each edge */
  starts: Vec2[]
  ends: Vec2[]
  area: number
  height: number
  wallLength: number
  /** edges grouped as they're measured on site (a straight wall split in parts is one group) */
  groups: number[][]
  /** walls to measure, counting a split straight wall once */
  wallCount: number
  measuredCount: number
  status: 'empty' | 'partial' | 'complete'
  closureOk: boolean
  edgeInfo: EdgeInfo[]
}

export interface Solved {
  mmPerPx: number | null
  /** how outer walls were traced (resolved when the setting is auto) */
  traceMode: Exclude<TraceMode, 'auto'>
  rooms: SolvedRoom[]
  byId: Map<string, SolvedRoom>
  netArea: number
  netIndoorArea: number
  grossArea: number
  grossOutline: MultiPolygon
  /** where north points on the plan (degrees clockwise from up), if set */
  north: number | null
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

/** How far off one straight line two traced walls can be and still count as one wall. */
const FLUSH_TOL = 30
/** A straight wall is a given while wall thicknesses are often guesses, so thickness gives way first. */
const FLUSH_WEIGHT = 10

/**
 * Walls of different rooms that continue one straight line on the plan, end to end
 * or with just a cross wall between them (an outside wall running past living and
 * dining, say). Nothing else ties those rooms along the line.
 */
function findFlush(rooms: { room: Room; planMm: Vec2[] }[]) {
  const out: { a: number; edgeA: number; b: number; edgeB: number; weight: number }[] = []
  rooms.forEach((A, ai) => {
    const n = A.planMm.length
    for (let i = 0; i < n; i++) {
      if (A.room.edges[i].kind !== 'wall') continue
      const p = A.planMm[i]
      const L = dist(p, A.planMm[(i + 1) % n])
      if (L < 1) continue
      const d = norm(sub(A.planMm[(i + 1) % n], p))
      const nrm = outward(d)
      rooms.forEach((B, bi) => {
        if (bi <= ai) return
        const m = B.planMm.length
        for (let j = 0; j < m; j++) {
          if (B.room.edges[j].kind !== 'wall') continue
          const r = B.planMm[j]
          const s = B.planMm[(j + 1) % m]
          const M = dist(r, s)
          if (M < 1 || dot(d, norm(sub(s, r))) < PARALLEL) continue
          if (Math.abs(dot(sub(r, p), nrm)) > FLUSH_TOL || Math.abs(dot(sub(s, p), nrm)) > FLUSH_TOL) continue
          const tr = dot(sub(r, p), d)
          const ts = dot(sub(s, p), d)
          const apart = Math.max(Math.min(tr, ts) - L, -Math.max(tr, ts))
          if (apart > MAX_GAP) continue
          out.push({ a: ai, edgeA: i, b: bi, edgeB: j, weight: (FLUSH_WEIGHT * Math.min(L, M)) / 1000 })
        }
      })
    }
  })
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
  const traced = project.rooms.map((room) => ({
    room,
    planMm: room.points.map((p) => scale(p, k ?? 1)),
  }))
  const neighborMap = findNeighbors(traced)

  // Walls and their thickness are decided on the traced lines.
  const classified = traced.map(({ room, planMm }) => {
    const n = planMm.length
    const lengths = planMm.map((p, i) => dist(p, planMm[(i + 1) % n]))
    const lists = neighborMap.get(room.id) ?? []
    const edgeInfo: EdgeInfo[] = room.edges.map((e, i) => {
      const neighbors = lists[i] ?? []
      const gaps = neighbors.map((nb) => nb.gap).sort((a, b) => a - b)
      const planGap = gaps.length ? gaps[Math.floor(gaps.length / 2)] : null
      if (e.kind === 'open') return { side: 'open', thickness: 0, ownThickness: 0, neighbors, planGap }
      const side = e.side !== 'auto' ? e.side : coverage(neighbors, lengths[i]) >= 0.5 ? 'internal' : 'external'
      const thickness = e.thickness ?? (side === 'internal' ? s.internalThickness : s.externalThickness)
      return { side, thickness, ownThickness: side === 'internal' ? thickness / 2 : thickness, neighbors, planGap }
    })
    // A straight wall traced in parts is one wall: give every part the longest part's thickness.
    for (const g of measureGroups(room)) {
      if (g.length < 2 || room.edges[g[0]].kind !== 'wall') continue
      const longest = g.reduce((a, b) => (lengths[b] > lengths[a] ? b : a))
      for (const i of g) {
        if (room.edges[i].thickness != null) continue
        const t = edgeInfo[longest].thickness
        edgeInfo[i] = { ...edgeInfo[i], thickness: t, ownThickness: edgeInfo[i].side === 'internal' ? t / 2 : t }
      }
    }
    return { room, traced: planMm, edgeInfo }
  })

  const traceMode = resolveTraceMode(classified.flatMap((r) => r.edgeInfo), s)

  // Move each traced line to the wall face you actually measure from.
  const partial = classified.map(({ room, traced: tracedMm, edgeInfo }) => {
    const insets = edgeInfo.map((info) => {
      if (info.side === 'open') return 0
      // Whatever part of a shared wall isn't already a gap between the traced lines is split evenly.
      if (info.side === 'internal') return Math.max(0, (info.thickness - (info.planGap ?? 0)) / 2)
      return traceMode === 'centre' ? info.thickness / 2 : traceMode === 'outside' ? info.thickness : 0
    })
    const { starts: planStarts, ends: planEnds, dirs } = insideFaces(tracedMm, insets)
    const n = tracedMm.length
    const estimates = planStarts.map((p, i) => Math.max(0, dot(sub(planEnds[i], p), dirs[i])))
    const steps = planEnds.map((e, i) => sub(planStarts[(i + 1) % n], e))
    const closure = closeRoom(
      room.edges.map((e, i) => ({
        dir: dirs[i],
        length: e.measured ?? estimates[i],
        measured: e.measured != null,
      })),
      steps.reduce((a, b) => add(a, b), { x: 0, y: 0 }),
    )
    // Walk round with the adjusted lengths (origin is arbitrary; layout places it).
    const walkStarts: Vec2[] = []
    const walkEnds: Vec2[] = []
    let v: Vec2 = { x: 0, y: 0 }
    for (let i = 0; i < n; i++) {
      walkStarts.push(v)
      walkEnds.push(add(v, scale(dirs[i], closure.lengths[i])))
      v = add(walkEnds[i], steps[i])
    }
    const planPoly = outlineOf(planStarts, planEnds)
    return {
      room,
      traced: tracedMm,
      planMm: planPoly.points,
      planStarts,
      planEnds,
      dirs,
      estimates,
      closure,
      walkStarts,
      walkEnds,
      edgeInfo,
    }
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
  // A straight wall shared along its length by several rooms stays straight (faces as offset as on the plan).
  for (const f of findFlush(traced)) {
    const A = partial[f.a]
    const normal = outward(A.dirs[f.edgeA])
    links.push({ ...f, normal, gap: dot(sub(partial[f.b].planStarts[f.edgeB], A.planStarts[f.edgeA]), normal) })
  }
  const shifts = layoutRooms(
    partial.map((r) => ({
      walk: r.walkStarts,
      prior: sub(centroid(r.planMm), centroid(outlineOf(r.walkStarts, r.walkEnds).points)),
    })),
    links,
  )

  const rooms: SolvedRoom[] = partial.map((r, ri) => {
    const starts = r.walkStarts.map((p) => add(p, shifts[ri]))
    const ends = r.walkEnds.map((p) => add(p, shifts[ri]))
    const { points: outline, edgeOf: outlineEdge } = outlineOf(starts, ends)
    const groups = measureGroups(r.room)
    const walls = groups.filter((g) => r.room.edges[g[0]].kind === 'wall')
    const measuredCount = walls.filter((g) => groupMeasured(r.room, g) != null).length
    return {
      ...r,
      outline,
      outlineEdge,
      starts,
      ends,
      area: area(outline),
      height: r.room.height ?? s.defaultHeight,
      wallLength: r.room.edges.reduce((sum, e, i) => sum + (e.kind === 'wall' ? r.closure.lengths[i] : 0), 0),
      groups,
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
    traceMode,
    rooms,
    byId,
    netArea: rooms.reduce((a, r) => a + r.area, 0),
    netIndoorArea: rooms.filter((r) => r.room.type !== 'balcony').reduce((a, r) => a + r.area, 0),
    grossArea: multiPolygonArea(grossOutline),
    grossOutline,
    north: project.north,
  }
}

/**
 * Each edge's inside face: its traced line moved in by `insets[i]`. Neighbouring
 * faces meet where their lines cross; when two edges lie on one straight line at
 * different depths (a wall next to an open stretch, say) each keeps its own line
 * and the outline gets a small step between them instead of a slanted edge.
 */
function insideFaces(traced: Vec2[], insets: number[]) {
  const n = traced.length
  const dirs = traced.map((p, i) => norm(sub(traced[(i + 1) % n], p)))
  const inward = (i: number) => scale(outward(dirs[i]), -insets[i])
  const lineP = traced.map((p, i) => add(p, inward(i)))
  const starts = traced.map((p, i) => {
    const j = (i - 1 + n) % n
    return lineIntersect(lineP[j], dirs[j], lineP[i], dirs[i]) ?? add(p, inward(i))
  })
  const ends = traced.map((_, i) => {
    const j = (i + 1) % n
    return lineIntersect(lineP[i], dirs[i], lineP[j], dirs[j]) ?? add(traced[j], inward(i))
  })
  return { starts, ends, dirs }
}

/** Polygon through each edge's start and end, with a step segment wherever they don't meet. */
function outlineOf(starts: Vec2[], ends: Vec2[]): { points: Vec2[]; edgeOf: number[] } {
  const points: Vec2[] = []
  const edgeOf: number[] = []
  const n = starts.length
  for (let i = 0; i < n; i++) {
    points.push(starts[i])
    edgeOf.push(i)
    if (dist(ends[i], starts[(i + 1) % n]) > 0.5) {
      points.push(ends[i])
      edgeOf.push(-1)
    }
  }
  return { points, edgeOf }
}

/**
 * Rooms traced on a shared line mean the lines are wall centres; rooms traced a wall's
 * width apart mean inside faces. Outer walls have no neighbour to tell, so follow suit.
 */
function resolveTraceMode(infos: EdgeInfo[], s: Settings): Exclude<TraceMode, 'auto'> {
  if (s.traceMode !== 'auto') return s.traceMode
  const shared = infos
    .filter((i) => i.side === 'internal' && i.planGap != null)
    .map((i) => (i.planGap as number) / i.thickness)
    .sort((a, b) => a - b)
  if (!shared.length) return 'inside'
  return shared[Math.floor(shared.length / 2)] < 0.5 ? 'centre' : 'inside'
}

/** Each room grown by the wall thickness it owns, then unioned: the built-up footprint. */
function grossFootprint(rooms: SolvedRoom[], s: Settings): MultiPolygon {
  const polys: Polygon[] = rooms
    .filter((r) => r.outline.length >= 3 && signedArea(r.outline) > 0)
    .map((r) => {
      const offsets = r.outlineEdge.map((k) => {
        if (k < 0) return 0
        const info = r.edgeInfo[k]
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
