import polygonClipping, { type MultiPolygon, type Polygon } from 'polygon-clipping'
import { useMemo } from 'react'
import { normDeg } from '../geometry/facing'
import { bbox, centroid } from '../geometry/polygon'
import { groupMeasured } from '../geometry/runs'
import type { Solved, SolvedRoom } from '../geometry/solve'
import { add, dist, dot, lerp, norm, outward, scale, sub } from '../geometry/vec'
import { roomWallPieces, type WallPiece } from '../geometry/walls'
import { roomTypeInfo, type LengthUnit, type Vec2 } from '../types'
import { formatArea, formatLength } from '../units'
import type { FitBox } from './PlanView'

/** The plan is cut through the walls at this height, as in the 3D cutaway. */
const CUT = 1200
const WALL = '#3f4652'
/** room labels' font size, screen px */
const LABEL_PX = 13
const RAD = Math.PI / 180

interface WallPlan {
  /** wall standing at the cut */
  solid: MultiPolygon
  /** wall below the cut but not at it: a window over its sill */
  windows: MultiPolygon
  /** a line along the middle of each window */
  glass: [Vec2, Vec2][]
  /** everything drawn, in mm */
  box: ReturnType<typeof bbox>
}

/** The clipper can trip over near-degenerate slivers; the pieces unmerged still draw the same. */
function union(polys: Polygon[]): MultiPolygon {
  if (!polys.length) return []
  try {
    return polygonClipping.union(polys[0], ...polys.slice(1))
  } catch {
    return polys
  }
}

function glassLine(r: SolvedRoom, piece: WallPiece): [Vec2, Vec2] {
  const k = piece.edge
  const p0 = r.starts[k]
  const d = r.dirs[k]
  const us = piece.footprint.map((q) => dot(sub(q, p0), d))
  const lo = Math.max(0, Math.min(...us))
  const hi = Math.min(dot(sub(r.ends[k], p0), d), Math.max(...us))
  const mid = add(p0, scale(outward(d), r.edgeInfo[k].ownThickness / 2))
  return [add(mid, scale(d, lo)), add(mid, scale(d, hi))]
}

/** Walls seen from above, cut at CUT. Doors and openings reach above the cut, so they leave a gap. */
function wallPlan(solved: Solved): WallPlan {
  const solid: Polygon[] = []
  const windows: Polygon[] = []
  const glass: [Vec2, Vec2][] = []
  const pts = solved.rooms.flatMap((r) => r.outline)
  for (const r of solved.rooms) {
    for (const piece of roomWallPieces(solved, r, Infinity)) {
      const ring = [piece.footprint.map((p) => [p.x, p.y] as [number, number])]
      pts.push(...piece.footprint)
      if (piece.y0 <= CUT && piece.y1 > CUT) solid.push(ring)
      else if (piece.y0 === 0 && piece.y1 <= CUT) {
        windows.push(ring)
        glass.push(glassLine(r, piece))
      }
    }
  }
  return { solid: union(solid), windows: union(windows), glass, box: bbox(pts) }
}

const pathOf = (mp: MultiPolygon) =>
  mp
    .flatMap((poly) =>
      poly.map((ring) => ring.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join('') + 'Z'),
    )
    .join('')

interface RoomLabel {
  c: Vec2
  name: string
  area: string
}

/** A room label's half width and height on screen, in mm at the current zoom. */
const labelSize = (l: RoomLabel, fs: number) => ({
  hw: (Math.max(l.name.length * 0.62, l.area.length * 0.55) * fs) / 2,
  hh: 1.2 * fs,
})

/** Something on the plan for wall lengths to keep off: centred on c, half sizes upright on screen, in mm. */
interface Obstacle {
  c: Vec2
  hw: number
  hh: number
}

/**
 * One length per wall, just inside the room: as measured, or the worked-out length (≈) for a
 * wall that wasn't. It slides along the wall off anything in `avoid` (the room's label, plug
 * points), or is left out where there's no room for it.
 */
function WallDims({
  r,
  ke,
  rot,
  unit,
  avoid,
}: {
  r: SolvedRoom
  ke: number
  rot: number
  unit: LengthUnit
  avoid: Obstacle[]
}) {
  const fs = 11 / ke
  return (
    <g>
      {r.groups.map((g) => {
        const first = r.room.edges[g[0]]
        if (first.kind !== 'wall') return null
        const a = r.starts[g[0]]
        const b = r.ends[g[g.length - 1]]
        const measured = groupMeasured(r.room, g)
        const text =
          measured != null
            ? formatLength(measured, unit)
            : `≈ ${formatLength(
                g.reduce((sum, i) => sum + r.closure.lengths[i], 0),
                unit,
              )}`
        // Only once the wall is long enough on screen to hold it.
        const L = dist(a, b)
        const tw = text.length * fs * 0.6
        if (L < tw + fs) return null
        const d = norm(sub(b, a))
        const angle = Math.atan2(d.y, d.x) / RAD
        const onScreen = normDeg(angle + rot)
        // What it keeps off stays upright on screen, so measure its extent along and across this wall.
        const cos = Math.abs(Math.cos(onScreen * RAD))
        const sin = Math.abs(Math.sin(onScreen * RAD))
        const covers = (q: Vec2) =>
          avoid.some((o) => {
            const off = sub(o.c, q)
            const along = Math.abs(dot(off, d)) < tw / 2 + o.hw * cos + o.hh * sin
            const across = Math.abs(dot(off, outward(d))) < fs / 2 + o.hw * sin + o.hh * cos
            return along && across
          })
        // The middle of the wall, or as near it as is clear while the length still fits on the wall.
        const mid = add(lerp(a, b, 0.5), scale(outward(d), -fs))
        let p: Vec2 | null = null
        for (let s = 0; s <= (L - tw - fs) / 2 && !p; s += fs / 2) {
          p = (s ? [add(mid, scale(d, s)), add(mid, scale(d, -s))] : [mid]).find((q) => !covers(q)) ?? null
        }
        if (!p) return null
        // Read from the bottom or the right of the screen, however the view is turned.
        const upright = onScreen >= 90 && onScreen < 270 ? angle + 180 : angle
        return (
          <text
            key={first.id}
            x={p.x}
            y={p.y}
            fontSize={fs}
            textAnchor="middle"
            dominantBaseline="middle"
            transform={`rotate(${upright} ${p.x} ${p.y})`}
            className={`plan-label${measured == null ? ' estimate' : ''}`}
          >
            {text}
          </text>
        )
      })}
    </g>
  )
}

/** Where each room's label is, with its size at this zoom (`ke` = screen px per mm), for other labels to keep off. */
export const roomLabelBoxes = (plan: FloorPlanData, ke: number) =>
  [...plan.labels.values()].map((l) => ({ c: l.c, ...labelSize(l, LABEL_PX / ke) }))

export interface FloorPlanData {
  walls: WallPlan
  labels: Map<string, RoomLabel>
  /** open boundaries, each once though two rooms share it */
  openEdges: { id: string; a: Vec2; b: Vec2 }[]
  /** what to frame, in plan image pixels */
  fit: FitBox
}

/** The measured layout as a floor plan (in mm), worked out once per solve; null until there's a scale. */
export function useFloorPlan(solved: Solved): FloorPlanData | null {
  return useMemo(() => {
    const mmPerPx = solved.mmPerPx
    if (!mmPerPx || !solved.rooms.length) return null
    const walls = wallPlan(solved)
    const labels = new Map<string, RoomLabel>(
      solved.rooms.map((r) => [
        r.room.id,
        {
          c: centroid(r.outline),
          name: r.room.name,
          area: `${formatArea(r.area)}${r.status !== 'complete' ? ' (est.)' : ''}`,
        },
      ]),
    )
    const index = new Map(solved.rooms.map((r, i) => [r.room.id, i]))
    const openEdges = solved.rooms.flatMap((r, ri) =>
      r.room.edges.flatMap((e, i) =>
        e.kind === 'open' && r.edgeInfo[i].neighbors.every((nb) => (index.get(nb.roomId) ?? -1) > ri)
          ? [{ id: e.id, a: r.starts[i], b: r.ends[i] }]
          : [],
      ),
    )
    const { box } = walls
    const fit = { minX: box.minX / mmPerPx, minY: box.minY / mmPerPx, w: box.w / mmPerPx, h: box.h / mmPerPx }
    return { walls, labels, openEdges, fit }
  }, [solved])
}

/**
 * Floors, walls cut at CUT (windows framed, doors left open), and optionally room labels and
 * wall lengths, which keep off `avoid` (e.g. plug points). Drawn in mm; `ke` is screen px per mm
 * and `rot` the view's rotation.
 */
export function FloorPlan({
  plan,
  solved,
  ke,
  rot = 0,
  labels,
  dims,
  unit,
  avoid = [],
}: {
  plan: FloorPlanData
  solved: Solved
  ke: number
  rot?: number
  labels: boolean
  dims: boolean
  unit: LengthUnit
  avoid?: Obstacle[]
}) {
  const fs = LABEL_PX / ke
  const { walls } = plan
  return (
    <g pointerEvents="none">
      {solved.rooms.map((r) => (
        <polygon
          key={r.room.id}
          points={r.outline.map((p) => `${p.x},${p.y}`).join(' ')}
          fill={roomTypeInfo(r.room.type).color}
          fillOpacity={0.5}
        />
      ))}
      {plan.openEdges.map((e) => (
        <line
          key={e.id}
          x1={e.a.x}
          y1={e.a.y}
          x2={e.b.x}
          y2={e.b.y}
          stroke="#6b7280"
          strokeWidth={1}
          strokeDasharray="4 4"
          vectorEffect="non-scaling-stroke"
        />
      ))}
      <path d={pathOf(walls.windows)} fill="#fff" stroke={WALL} strokeWidth={1} vectorEffect="non-scaling-stroke" />
      {walls.glass.map(([a, b], i) => (
        <line
          key={i}
          x1={a.x}
          y1={a.y}
          x2={b.x}
          y2={b.y}
          stroke={WALL}
          strokeWidth={1}
          vectorEffect="non-scaling-stroke"
        />
      ))}
      {/* A hairline of the same colour hides seams if the pieces couldn't be merged. */}
      <path
        d={pathOf(walls.solid)}
        fill={WALL}
        fillRule="evenodd"
        stroke={WALL}
        strokeWidth={0.75}
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
      {dims &&
        solved.rooms.map((r) => {
          const l = plan.labels.get(r.room.id)!
          return (
            <WallDims
              key={r.room.id}
              r={r}
              ke={ke}
              rot={rot}
              unit={unit}
              avoid={labels ? [{ c: l.c, ...labelSize(l, fs) }, ...avoid] : avoid}
            />
          )
        })}
      {labels &&
        solved.rooms.map((r) => {
          const { c, name, area } = plan.labels.get(r.room.id)!
          return (
            // Turned back against the view so it stays upright.
            <text
              key={r.room.id}
              x={c.x}
              y={c.y}
              fontSize={fs}
              textAnchor="middle"
              transform={`rotate(${-rot} ${c.x} ${c.y})`}
              className="plan-label"
            >
              <tspan x={c.x} dy={-fs * 0.2} fontWeight={600}>
                {name}
              </tspan>
              <tspan x={c.x} dy={fs * 1.2}>
                {area}
              </tspan>
            </text>
          )
        })}
    </g>
  )
}
