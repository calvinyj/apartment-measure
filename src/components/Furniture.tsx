import { useMemo } from 'react'
import { formatPrice, sizeLabel, type FurnitureSpot, type StatusTally } from '../furniture'
import { layoutCallouts } from '../geometry/callouts'
import { bbox } from '../geometry/polygon'
import type { Solved } from '../geometry/solve'
import { add, norm, scale, sub } from '../geometry/vec'
import { ORDER_STATUSES, type FurnitureItem, type LengthUnit, type OrderStatus, type Vec2 } from '../types'
import type { FloorPlanData } from './FloorPlan'
import { ACCENT, turn, type LabelBox } from './Lights'

/**
 * Furniture is marked with a diamond, apart from round lights and square plug points. Pending is hollow,
 * ordered filled, and delivered filled with a tick, so they tell apart without the colour too.
 */
const STATUS_STYLE: Record<OrderStatus, { fill: string; stroke: string }> = {
  pending: { fill: '#fff', stroke: '#64748b' },
  ordered: { fill: '#3b82f6', stroke: '#1d4ed8' },
  delivered: { fill: '#16a34a', stroke: '#15803d' },
}
const LINE = '#475569'
const GROUP = '#334155'

/** Sizes on screen, px. */
/** from a diamond's middle to its corners */
const MARK_R = 7
/** the mark for a spot with several items, with how many in it */
const GROUP_R = 9.5
const PAD_X = 8
const PAD_Y = 5
const NAME_PX = 12
const NAME_LINE = 16
const DETAIL_PX = 10.5
const DETAIL_LINE = 13.5
const DOT_R = 5
/** where a card's text starts, after its status dot */
const TEXT_X = PAD_X + DOT_R * 2 + 5
/** between the cards of different spots, and between one spot's own cards */
const GAP = 8
const STACK_GAP = 3
/** between the plan and the cards; one spot's cards are joined by a bracket this far in from them */
const MARGIN = 30
const BRACKET = 7

/** A card's width for a view this wide, px: narrower on a phone, where cards leave less room for the plan. */
export const cardWidth = (viewWidth: number) => Math.round(Math.min(170, Math.max(90, viewWidth * 0.17)))

/** Room to keep either side of the plan when fitting it, px, for cards this wide. */
export const cardAside = (w: number) => MARGIN + w + 12

let measure: { ctx: CanvasRenderingContext2D; family: string } | null | undefined

/** How wide text is on screen, px: measured in the page's font, or a fair guess with no page. */
function textWidth(text: string, px: number, weight: number): number {
  if (measure === undefined) {
    const ctx = typeof document === 'undefined' ? null : document.createElement('canvas').getContext('2d')
    measure = ctx && { ctx, family: getComputedStyle(document.body).fontFamily }
  }
  if (!measure) return text.length * px * 0.55
  measure.ctx.font = `${weight} ${px}px ${measure.family}`
  return measure.ctx.measureText(text).width
}

/** The text cut short with … to fit `max` px. */
function fitText(text: string, px: number, weight: number, max: number): string {
  if (textWidth(text, px, weight) <= max) return text
  let lo = 0
  let hi = text.length
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (textWidth(`${text.slice(0, mid).trimEnd()}…`, px, weight) <= max) lo = mid
    else hi = mid - 1
  }
  return `${text.slice(0, lo).trimEnd()}…`
}

interface Card {
  name: string
  unnamed: boolean
  /** on the right of the name line; '' with none, or when it's on a line of its own */
  price: string
  /** the model and size, and the price where it doesn't fit beside the name */
  details: string[]
  /** px */
  h: number
}

/** A card's lines, cut short to fit `w` px. The price goes on the right of the name where that leaves room for it. */
function cardFor(f: FurnitureItem, unit: LengthUnit, w: number): Card {
  const max = w - TEXT_X - PAD_X
  const name = f.name.trim()
  const price = f.price != null ? formatPrice(f.price) : ''
  const beside = price ? max - textWidth(price, DETAIL_PX, 600) - 6 : max
  const inline = beside >= 40
  const details = [f.model.trim(), sizeLabel(f, unit), inline ? '' : price]
    .filter(Boolean)
    .map((t) => fitText(t, DETAIL_PX, 400, max))
  return {
    name: fitText(name || 'Unnamed', NAME_PX, 600, inline ? beside : max),
    unnamed: !name,
    price: inline ? price : '',
    details,
    h: PAD_Y * 2 + NAME_LINE + details.length * DETAIL_LINE,
  }
}

/** Every corner of the rooms and walls, in mm: what the cards go beside. */
export function planPoints(plan: FloorPlanData, solved: Solved): Vec2[] {
  return [
    ...solved.rooms.flatMap((r) => r.outline),
    ...[...plan.walls.solid, ...plan.walls.windows].flatMap((poly) => poly.flatMap((ring) => ring.map(([x, y]) => ({ x, y })))),
  ]
}

const markR = (s: FurnitureSpot) => (s.items.length > 1 ? GROUP_R : MARK_R)

/** A diamond centred on c, r from its middle to each corner. */
const diamond = (c: Vec2, r: number) => `M${c.x} ${c.y - r}L${c.x + r} ${c.y}L${c.x} ${c.y + r}L${c.x - r} ${c.y}Z`

/** Where the spots' marks are, for labels to keep off (the diamond doesn't turn with the view, so this covers it). */
export const furnitureBoxes = (spots: FurnitureSpot[], ke: number): LabelBox[] =>
  spots.map((s) => ({ c: s.at, hw: markR(s) / ke, hh: markR(s) / ke }))

/** An item's status as a diamond, centred on c; sizes in the drawing's units. */
function StatusMark({ status, c, r, sw }: { status: OrderStatus; c: Vec2; r: number; sw: number }) {
  const st = STATUS_STYLE[status]
  return (
    <>
      <path d={diamond(c, r)} fill={st.fill} stroke={st.stroke} strokeWidth={sw} strokeLinejoin="round" />
      {status === 'delivered' && (
        <path
          d={`M${c.x - r * 0.36} ${c.y + r * 0.02}L${c.x - r * 0.08} ${c.y + r * 0.28}L${c.x + r * 0.36} ${c.y - r * 0.26}`}
          fill="none"
          stroke="#fff"
          strokeWidth={sw * 1.3}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      )}
    </>
  )
}

/** A spot with several items: a dark diamond with how many. */
function GroupMark({ n, c, r, sw }: { n: number; c: Vec2; r: number; sw: number }) {
  return (
    <>
      <path d={diamond(c, r)} fill={GROUP} stroke="#fff" strokeWidth={sw} strokeLinejoin="round" />
      <text x={c.x} y={c.y} fontSize={r * 0.95} fontWeight={700} textAnchor="middle" dominantBaseline="central" fill="#fff">
        {n}
      </text>
    </>
  )
}

/** An item's status mark on its own, for the legend, lists and tables. */
export function StatusIcon({ status }: { status: OrderStatus }) {
  return (
    <svg viewBox="-8 -8 16 16" aria-hidden className="status-icon">
      <StatusMark status={status} c={{ x: 0, y: 0 }} r={7} sw={1.5} />
    </svg>
  )
}

/** The mark of a spot with several items, for the legend. */
export function GroupIcon({ n = 2 }: { n?: number }) {
  return (
    <svg viewBox="-10 -10 20 20" aria-hidden className="status-icon">
      <GroupMark n={n} c={{ x: 0, y: 0 }} r={GROUP_R} sw={1} />
    </svg>
  )
}

/**
 * Furniture and appliances over the floor plan, in mm: a mark at each spot, and the cards of the items
 * there in a column beside the plan (on screen, however the view is turned), with a dotted line from
 * the spot to its cards. Interactive, a spot's mark is a target (`fs:<spot key>`), and so is each card
 * (`fc:<item id>`); the selected item's card is outlined.
 */
export function FurnitureLayer({
  spots,
  points,
  ke,
  rot = 0,
  unit,
  cardW,
  selectedId,
  interactive = false,
}: {
  spots: FurnitureSpot[]
  /** what the cards go beside, in mm */
  points: Vec2[]
  ke: number
  rot?: number
  unit: LengthUnit
  /** px */
  cardW: number
  selectedId?: string | null
  interactive?: boolean
}) {
  const cards = useMemo(
    () => new Map(spots.flatMap((s) => s.items).map((f) => [f.id, cardFor(f, unit, cardW)])),
    [spots, unit, cardW],
  )
  if (!spots.length) return null
  const px = 1 / ke
  // Laid out upright on screen: the drawing is turned back by the view's rotation.
  const up = (p: Vec2) => turn(p, rot)
  const box = bbox(points.map(up))
  const stackH = (s: FurnitureSpot) => s.items.reduce((sum, f) => sum + cards.get(f.id)!.h + STACK_GAP, -STACK_GAP)
  const byKey = new Map(spots.map((s) => [s.key, s]))
  const placed = layoutCallouts(
    spots.map((s) => ({ id: s.key, at: up(s.at), h: stackH(s) * px })),
    box,
    { w: cardW * px, gap: GAP * px, margin: MARGIN * px },
  ).map((c) => ({ ...c, spot: byKey.get(c.id)! }))
  const w = cardW * px
  const dotted = { stroke: LINE, strokeWidth: 1.5 * px, strokeDasharray: `0 ${3.5 * px}`, strokeLinecap: 'round' as const }
  return (
    <g transform={rot ? `rotate(${-rot})` : undefined} pointerEvents={interactive ? undefined : 'none'}>
      {placed.map(({ spot, at, port, side, y }) => {
        // Several cards are joined by a bracket, and the line ends at its middle.
        const out = side === 'left' ? -1 : 1
        const several = spot.items.length > 1
        const end = several ? { x: port.x - out * BRACKET * px, y: port.y } : port
        const from = add(at, scale(norm(sub(end, at)), markR(spot) * px))
        let yy = y
        const mids = spot.items.map((f) => {
          const h = cards.get(f.id)!.h * px
          const mid = yy + h / 2
          yy += h + STACK_GAP * px
          return mid
        })
        return (
          <g key={spot.key}>
            <line x1={from.x} y1={from.y} x2={end.x} y2={end.y} {...dotted} />
            {several && (
              <path
                d={`M${port.x} ${mids[0]}H${end.x}V${mids[mids.length - 1]}H${port.x}${mids
                  .slice(1, -1)
                  .map((m) => `M${end.x} ${m}H${port.x}`)
                  .join('')}`}
                fill="none"
                stroke={LINE}
                strokeWidth={px}
              />
            )}
          </g>
        )
      })}
      {placed.map(({ spot, x, y }) => {
        let yy = y
        return spot.items.map((f) => {
          const card = cards.get(f.id)!
          const top = yy
          const h = card.h * px
          yy += h + STACK_GAP * px
          const sel = f.id === selectedId
          const tx = x + TEXT_X * px
          return (
            <g
              key={f.id}
              data-handle={interactive ? `fc:${f.id}` : undefined}
              className={interactive ? (sel ? 'handle' : 'furniture-card') : undefined}
            >
              <rect x={x} y={top + px} width={w} height={h} rx={5 * px} fill="#0f172a" fillOpacity={0.07} />
              <rect
                x={x}
                y={top}
                width={w}
                height={h}
                rx={5 * px}
                fill="#fff"
                stroke={sel ? ACCENT : '#cbd5e1'}
                strokeWidth={(sel ? 2 : 1) * px}
              />
              <StatusMark
                status={f.status}
                c={{ x: x + (PAD_X + DOT_R) * px, y: top + (PAD_Y + NAME_LINE / 2) * px }}
                r={DOT_R * px}
                sw={1.25 * px}
              />
              <text
                x={tx}
                y={top + (PAD_Y + NAME_LINE / 2) * px}
                fontSize={NAME_PX * px}
                fontWeight={600}
                dominantBaseline="central"
                className={`furniture-name${card.unnamed ? ' unnamed' : ''}`}
              >
                {card.name}
              </text>
              {card.price && (
                <text
                  x={x + w - PAD_X * px}
                  y={top + (PAD_Y + NAME_LINE / 2) * px}
                  fontSize={DETAIL_PX * px}
                  fontWeight={600}
                  textAnchor="end"
                  dominantBaseline="central"
                  className="furniture-price"
                >
                  {card.price}
                </text>
              )}
              {card.details.map((t, i) => (
                <text
                  key={i}
                  x={tx}
                  y={top + (PAD_Y + NAME_LINE + DETAIL_LINE * (i + 0.5)) * px}
                  fontSize={DETAIL_PX * px}
                  dominantBaseline="central"
                  className="furniture-detail"
                >
                  {t}
                </text>
              ))}
            </g>
          )
        })
      })}
      {placed.map(({ spot, at }) => {
        const sel = spot.items.some((f) => f.id === selectedId)
        const r = markR(spot) * px
        return (
          <g
            key={spot.key}
            data-handle={interactive ? `fs:${spot.key}` : undefined}
            className={interactive ? 'handle' : undefined}
          >
            {sel && (
              <circle cx={at.x} cy={at.y} r={r + 4 * px} fill={ACCENT} fillOpacity={0.18} stroke={ACCENT} strokeWidth={2 * px} />
            )}
            {spot.items.length > 1 ? (
              <GroupMark n={spot.items.length} c={at} r={r} sw={1.5 * px} />
            ) : (
              <StatusMark status={spot.items[0].status} c={at} r={r} sw={1.75 * px} />
            )}
            {/* A bigger target than the mark, for fingers. */}
            {interactive && <circle cx={at.x} cy={at.y} r={15 * px} fill="transparent" />}
          </g>
        )
      })}
    </g>
  )
}

/** "4 pending, RM 5,200 · 2 ordered, RM 3,100 · …", then what they all come to. */
export function StatusSummary({ totals }: { totals: StatusTally[] }) {
  const all = totals.reduce((sum, t) => sum + t.price, 0)
  const unpriced = totals.some((t) => t.unpriced > 0)
  return (
    <div className="furniture-totals">
      {totals.map((t) => (
        <div key={t.status}>
          <span className="fixture">
            <StatusIcon status={t.status} />
            {t.count} {ORDER_STATUSES.find((s) => s.value === t.status)!.label.toLowerCase()}
          </span>
          <span className="num">
            {t.price > 0 ? `${formatPrice(t.price)}${t.unpriced ? '+' : ''}` : <span className="muted">–</span>}
          </span>
        </div>
      ))}
      <div className="total">
        <span>Total</span>
        <span className="num">{all > 0 ? `${formatPrice(all)}${unpriced ? '+' : ''}` : <span className="muted">–</span>}</span>
      </div>
      {unpriced && all > 0 && <p className="muted small">+ Some have no price set yet, so it comes to at least this.</p>}
    </div>
  )
}
