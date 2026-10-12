import type { Solved } from '../geometry/solve'
import type { MeasureSnap, MeasureTargets } from '../geometry/measure'
import { add, dist, norm, outward, scale, sub } from '../geometry/vec'
import type { LengthUnit, Vec2 } from '../types'
import { formatLength } from '../units'
import { planOutline, type PlacedCabinet } from './CabinetLayer'
import type { FloorPlanData } from './FloorPlan'

const ACCENT = '#2563eb'

/** Where a measurement can snap to, in mm: room corners and inside faces, wall ends and outside faces, cabinets. */
export function measureTargets(solved: Solved, plan: FloorPlanData | null, cabinets: PlacedCabinet[]): MeasureTargets {
  const rings: Vec2[][] = [
    ...solved.rooms.map((r) => r.outline),
    ...(plan ? [...plan.walls.solid, ...plan.walls.windows].flatMap((poly) => poly.map((ring) => ring.map(([x, y]) => ({ x, y })))) : []),
    ...cabinets.map(planOutline),
  ]
  return {
    corners: rings.flat(),
    lines: rings.flatMap((ring) => ring.map((p, i): [Vec2, Vec2] => [p, ring[(i + 1) % ring.length]])),
  }
}

/** A measurement on the plan (in mm): its ends, the line between and its length; and where the next tap would land. */
export function MeasureMarks({
  ends,
  hover,
  ke,
  rot,
  unit,
}: {
  ends: MeasureSnap[]
  hover: MeasureSnap | null
  ke: number
  rot: number
  unit: LengthUnit
}) {
  const [a, b] = ends
  const end = a ? (b ?? hover) : null
  const px = 1 / ke
  const stroke = { stroke: ACCENT, vectorEffect: 'non-scaling-stroke' as const }
  const tick = (p: Vec2, n: Vec2) => {
    const t = scale(n, 7 * px)
    return <line x1={p.x - t.x} y1={p.y - t.y} x2={p.x + t.x} y2={p.y + t.y} {...stroke} strokeWidth={2} />
  }
  let ruler = null
  if (a && end && dist(a.p, end.p) > 0) {
    const n = outward(norm(sub(end.p, a.p)))
    const mid = add(scale(add(a.p, end.p), 0.5), scale(n, 14 * px))
    ruler = (
      <>
        <line x1={a.p.x} y1={a.p.y} x2={end.p.x} y2={end.p.y} {...stroke} strokeWidth={2} strokeDasharray={b ? undefined : '6 4'} />
        {tick(a.p, n)}
        {tick(end.p, n)}
        <text
          x={mid.x}
          y={mid.y}
          fontSize={14 * px}
          fontWeight={700}
          textAnchor="middle"
          dominantBaseline="middle"
          transform={`rotate(${-rot} ${mid.x} ${mid.y})`}
          className="plan-label measure-label"
        >
          {formatLength(dist(a.p, end.p), unit)}
        </text>
      </>
    )
  }
  // Where a tap would land, when it snaps: a square on a corner, a circle on a line.
  const next = !b && hover && hover.to !== 'free' ? hover : null
  return (
    <g pointerEvents="none">
      {ruler}
      {a && <circle cx={a.p.x} cy={a.p.y} r={4 * px} fill="#fff" {...stroke} strokeWidth={2} />}
      {b && <circle cx={b.p.x} cy={b.p.y} r={4 * px} fill="#fff" {...stroke} strokeWidth={2} />}
      {next &&
        (next.to === 'corner' ? (
          <rect x={next.p.x - 6 * px} y={next.p.y - 6 * px} width={12 * px} height={12 * px} fill="none" {...stroke} strokeWidth={1.5} />
        ) : (
          <circle cx={next.p.x} cy={next.p.y} r={6 * px} fill="none" {...stroke} strokeWidth={1.5} />
        ))}
    </g>
  )
}

/** What to do next, and the length once there are two points. */
export function MeasureChip({
  ends,
  hover,
  unit,
  onClear,
}: {
  ends: MeasureSnap[]
  hover: MeasureSnap | null
  unit: LengthUnit
  onClear: () => void
}) {
  const [a, b] = ends
  const end = b ?? (a ? hover : null)
  return (
    <div className="measure-chip" role="status">
      {!a ? (
        <span>Tap two points to measure between them. They snap to corners and walls.</span>
      ) : (
        <>
          {end && dist(a.p, end.p) >= 1 ? <b>{formatLength(dist(a.p, end.p), unit)}</b> : null}
          {!b && <span className="muted">Tap the second point.</span>}
          <button className="link" onClick={onClear}>
            Clear
          </button>
        </>
      )}
    </div>
  )
}
