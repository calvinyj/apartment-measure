import { cabinetTop } from '../cabinets/checks'
import { boxSpan, legPoint, outline, placeCabinet, type Placement } from '../cabinets/placement'
import type { Solved } from '../geometry/solve'
import type { Cabinet, Vec2 } from '../types'
import { inkOn } from './CabinetDrawings'
import { PLAN_CUT } from './FloorPlan'

const EDGE = '#3f4652'

/**
 * Where a cabinet is against the plan's cut: below it (seen from above, top and all), through it (a tall
 * cabinet or wardrobe, cut like the walls), or above it (a wall cabinet, dashed as on a drawing).
 */
export type PlanLevel = 'below' | 'cut' | 'above'

export const planLevel = (c: Cabinet): PlanLevel => (c.bottom >= PLAN_CUT ? 'above' : cabinetTop(c) > PLAN_CUT ? 'cut' : 'below')

export const PLAN_LEVEL_LABEL: Record<PlanLevel, string> = {
  below: 'Base cabinet',
  cut: 'Tall cabinet or wardrobe',
  above: 'Wall cabinet (above)',
}

export interface PlacedCabinet {
  c: Cabinet
  p: Placement
  level: PlanLevel
}

/** The cabinets that are on their walls, low ones first so wall cabinets are drawn over them. */
export function placeCabinets(cabinets: Cabinet[], solved: Solved): PlacedCabinet[] {
  const order: PlanLevel[] = ['below', 'cut', 'above']
  return cabinets
    .flatMap((c) => {
      const res = placeCabinet(solved, c)
      return res.ok ? [{ c, p: res.placement, level: planLevel(c) }] : []
    })
    .sort((a, b) => order.indexOf(a.level) - order.indexOf(b.level))
}

const pts = (ps: Vec2[]) => ps.map((q) => `${q.x},${q.y}`).join(' ')

/** A cabinet's outline on the plan: a base cabinet's top (with its overhang), else its carcass. */
export const planOutline = ({ c, p, level }: PlacedCabinet) => outline(p, level === 'below' ? c.depth + (c.top?.overhang ?? 0) : c.depth)

/** A cabinet from above on the plan, in mm. */
function CabinetShape({ c, p, level }: PlacedCabinet) {
  const line = { stroke: EDGE, strokeWidth: 1, vectorEffect: 'non-scaling-stroke' as const, strokeLinejoin: 'round' as const }
  if (level === 'above')
    return <polygon points={pts(planOutline({ c, p, level }))} fill={c.fronts.color} fillOpacity={0.2} {...line} strokeDasharray="6 4" />

  if (level === 'cut') {
    // Cut through like the walls, and crossed along each wall as tall units are on a drawing.
    const ink = inkOn(c.fronts.color)
    return (
      <g>
        <polygon points={pts(planOutline({ c, p, level }))} fill={c.fronts.color} {...line} strokeWidth={1.5} />
        {p.legs.map((leg, k) => {
          const [u0, u1] = boxSpan(c, p, k)
          const [a, b, cc, d] = [legPoint(leg, u0), legPoint(leg, u1), legPoint(leg, u1, c.depth), legPoint(leg, u0, c.depth)]
          return (
            <g key={k} stroke={ink.faint} strokeWidth={0.8}>
              <line x1={a.x} y1={a.y} x2={cc.x} y2={cc.y} vectorEffect="non-scaling-stroke" />
              <line x1={b.x} y1={b.y} x2={d.x} y2={d.y} vectorEffect="non-scaling-stroke" />
            </g>
          )
        })}
      </g>
    )
  }

  // Below the cut: its top, with any sink, hob or basin in it.
  const depth = c.depth + (c.top?.overhang ?? 0)
  return (
    <g>
      <polygon points={pts(planOutline({ c, p, level }))} fill={c.top ? c.top.finish.color : c.fronts.color} {...line} />
      {(c.top?.cutouts ?? []).map((x) => {
        const leg = p.legs[x.leg]
        if (!leg) return null
        const u = leg.from + leg.cornerLeft + x.x
        const v = depth / 2
        const corners = [
          legPoint(leg, u - x.width / 2, v - x.depth / 2),
          legPoint(leg, u + x.width / 2, v - x.depth / 2),
          legPoint(leg, u + x.width / 2, v + x.depth / 2),
          legPoint(leg, u - x.width / 2, v + x.depth / 2),
        ]
        return x.kind === 'hob' ? (
          <polygon key={x.id} points={pts(corners)} fill="#1f2933" fillOpacity={0.8} {...line} />
        ) : (
          <polygon key={x.id} points={pts(corners)} fill="#fff" {...line} />
        )
      })}
    </g>
  )
}

/** Cabinets on the floor plan, in mm. */
export function CabinetLayer({ placed }: { placed: PlacedCabinet[] }) {
  return (
    <g pointerEvents="none">
      {placed.map((x) => (
        <CabinetShape key={x.c.id} {...x} />
      ))}
    </g>
  )
}

/** A cabinet as the plan draws it at this level, for the legend. */
export function CabinetIcon({ level }: { level: PlanLevel }) {
  return (
    <svg viewBox="-14 -14 28 28" aria-hidden className="light-icon">
      <rect x={-12} y={-13} width={24} height={3} fill={EDGE} />
      {level === 'above' ? (
        <rect x={-11} y={-10} width={22} height={13} fill="#d8c8b0" fillOpacity={0.2} stroke={EDGE} strokeWidth={1.2} strokeDasharray="3 2" />
      ) : level === 'cut' ? (
        <>
          <rect x={-11} y={-10} width={22} height={13} fill="#d8c8b0" stroke={EDGE} strokeWidth={1.5} />
          <path d="M-11 -10 L11 3 M11 -10 L-11 3" stroke="#6b7280" strokeWidth={0.8} />
        </>
      ) : (
        <>
          <rect x={-11} y={-10} width={22} height={15} fill="#e9e7e2" stroke={EDGE} strokeWidth={1} />
          <rect x={-5} y={-6} width={10} height={7} fill="#fff" stroke={EDGE} strokeWidth={0.8} />
        </>
      )}
    </svg>
  )
}
