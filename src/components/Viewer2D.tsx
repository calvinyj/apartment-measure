import polygonClipping, { type MultiPolygon, type Polygon } from 'polygon-clipping'
import { useMemo, useState } from 'react'
import { normDeg } from '../geometry/facing'
import { bbox, centroid } from '../geometry/polygon'
import { groupMeasured } from '../geometry/runs'
import type { Solved, SolvedRoom } from '../geometry/solve'
import { add, dist, dot, lerp, norm, outward, scale, sub } from '../geometry/vec'
import { roomWallPieces, type WallPiece } from '../geometry/walls'
import { useStore } from '../store'
import { roomTypeInfo, type LengthUnit, type Vec2 } from '../types'
import { formatArea, formatLength } from '../units'
import { PlanImageToggle, useSolved } from './common'
import { CompassBadge } from './Compass'
import { PlanView } from './PlanView'

/** The plan is cut through the walls at this height, as in the 3D cutaway. */
const CUT = 1200
const WALL = '#3f4652'
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
    .flatMap((poly) => poly.map((ring) => ring.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join('') + 'Z'))
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

/**
 * One length per wall, just inside the room: as measured, or the worked-out length (≈) for a
 * wall that wasn't. `avoid` is the room's label (with its size), which lengths make way for.
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
  avoid: (RoomLabel & { hw: number; hh: number }) | null
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
          measured != null ? formatLength(measured, unit) : `≈ ${formatLength(g.reduce((sum, i) => sum + r.closure.lengths[i], 0), unit)}`
        // Only once the wall is long enough on screen to hold it.
        const L = dist(a, b)
        const tw = text.length * fs * 0.6
        if (L < tw + fs) return null
        const d = norm(sub(b, a))
        const p = add(lerp(a, b, 0.5), scale(outward(d), -fs))
        const angle = Math.atan2(d.y, d.x) / RAD
        const onScreen = normDeg(angle + rot)
        if (avoid) {
          // The label stays upright on screen, so measure its extent along and across this wall.
          const cos = Math.abs(Math.cos(onScreen * RAD))
          const sin = Math.abs(Math.sin(onScreen * RAD))
          const off = sub(avoid.c, p)
          const along = Math.abs(dot(off, d)) < tw / 2 + avoid.hw * cos + avoid.hh * sin
          const across = Math.abs(dot(off, outward(d))) < fs / 2 + avoid.hw * sin + avoid.hh * cos
          if (along && across) return null
        }
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

export function Viewer2D() {
  const project = useStore((s) => s.project)
  const { north } = project
  const solved = useSolved()
  const [labels, setLabels] = useState(true)
  const [dims, setDims] = useState(true)
  const [rotation, setRotation] = useState(0)
  const [resetKey, setResetKey] = useState(0)
  const walls = useMemo(() => wallPlan(solved), [solved])
  const roomLabels = useMemo(
    () =>
      new Map<string, RoomLabel>(
        solved.rooms.map((r) => [
          r.room.id,
          { c: centroid(r.outline), name: r.room.name, area: `${formatArea(r.area)}${r.status !== 'complete' ? ' (est.)' : ''}` },
        ]),
      ),
    [solved],
  )
  const mmPerPx = solved.mmPerPx

  // An open boundary is shared by two rooms; draw it once.
  const openEdges = useMemo(() => {
    const index = new Map(solved.rooms.map((r, i) => [r.room.id, i]))
    return solved.rooms.flatMap((r, ri) =>
      r.room.edges.flatMap((e, i) =>
        e.kind === 'open' && r.edgeInfo[i].neighbors.every((nb) => (index.get(nb.roomId) ?? -1) > ri)
          ? [{ id: e.id, a: r.starts[i], b: r.ends[i] }]
          : [],
      ),
    )
  }, [solved])

  if (!solved.rooms.length || !mmPerPx) {
    return (
      <div className="empty">
        <h2>Nothing to show yet</h2>
        <p>Set the plan’s scale and trace at least one room on the Plan tab.</p>
      </div>
    )
  }

  // The view works in plan image pixels (so the plan image lines up); the drawing is in mm.
  const { box } = walls
  const fit = { minX: box.minX / mmPerPx, minY: box.minY / mmPerPx, w: box.w / mmPerPx, h: box.h / mmPerPx }

  return (
    <div className="viewer2d">
      <div className="viewer-toolbar">
        <label className="check small">
          <input type="checkbox" checked={labels} onChange={(e) => setLabels(e.target.checked)} /> Labels
        </label>
        <label className="check small">
          <input type="checkbox" checked={dims} onChange={(e) => setDims(e.target.checked)} /> Dimensions
        </label>
        <PlanImageToggle />
        <button
          className="btn small"
          title="Turn left 90° (or drag with the right mouse button, or twist with two fingers)"
          aria-label="Turn left 90°"
          onClick={() => setRotation((a) => normDeg(a - 90))}
        >
          ↺
        </button>
        <button
          className="btn small"
          title="Turn right 90° (or drag with the right mouse button, or twist with two fingers)"
          aria-label="Turn right 90°"
          onClick={() => setRotation((a) => normDeg(a + 90))}
        >
          ↻
        </button>
        {north != null && (
          <button className="btn small" onClick={() => setRotation(normDeg(-north))}>
            North up
          </button>
        )}
        <button
          className="btn small"
          onClick={() => {
            setRotation(0)
            setResetKey((k) => k + 1)
          }}
        >
          Reset view
        </button>
        {north != null && <CompassBadge north={north} turn={rotation} />}
      </div>
      <div className="viewer2d-canvas">
        <PlanView
          image={project.image}
          showImage={project.settings.showPlanImage}
          fit={fit}
          fitKey={String(resetKey)}
          rotation={rotation}
          onRotate={setRotation}
        >
          {(k, rot) => {
            const ke = k / mmPerPx // screen px per mm
            const fs = 13 / ke
            return (
              <g transform={`scale(${1 / mmPerPx})`} pointerEvents="none">
                {solved.rooms.map((r) => (
                  <polygon
                    key={r.room.id}
                    points={r.outline.map((p) => `${p.x},${p.y}`).join(' ')}
                    fill={roomTypeInfo(r.room.type).color}
                    fillOpacity={0.5}
                  />
                ))}
                {openEdges.map((e) => (
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
                  <line key={i} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={WALL} strokeWidth={1} vectorEffect="non-scaling-stroke" />
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
                    const l = roomLabels.get(r.room.id)!
                    return (
                      <WallDims
                        key={r.room.id}
                        r={r}
                        ke={ke}
                        rot={rot}
                        unit={project.settings.inputUnit}
                        avoid={labels ? { ...l, ...labelSize(l, fs) } : null}
                      />
                    )
                  })}
                {labels &&
                  solved.rooms.map((r) => {
                    const { c, name, area } = roomLabels.get(r.room.id)!
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
          }}
        </PlanView>
      </div>
    </div>
  )
}
