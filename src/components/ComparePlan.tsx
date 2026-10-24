import type { WallComparison, WallVerdict } from '../geometry/compare'
import { centroid } from '../geometry/polygon'
import type { Solved } from '../geometry/solve'
import { add, lerp, norm, outward, scale, sub } from '../geometry/vec'
import { useStore } from '../store'
import { roomTypeInfo, type LengthUnit } from '../types'
import { formatLength } from '../units'
import { RescaleToMeasurements } from './Rescale'

const COLOR: Record<WallVerdict, string> = {
  ok: '#15803d',
  recheck: '#b91c1c',
  conflict: '#b91c1c',
  step: '#2563eb',
  differs: '#b45309',
  unchecked: '#6b7280',
}

const BADGE: Record<WallVerdict, string> = { ok: 'ok', recheck: 'bad', conflict: 'bad', step: 'partial', differs: 'warn', unchecked: '' }

const SECTIONS: { title: string; verdicts: WallVerdict[] }[] = [
  { title: 'Re-check the reading', verdicts: ['recheck', 'conflict'] },
  { title: 'Right if an open side is flush', verdicts: ['step'] },
  { title: 'Not as planned', verdicts: ['differs'] },
  { title: 'Off the plan, not checked yet', verdicts: ['unchecked'] },
]

const signedLength = (mm: number, unit: LengthUnit) => {
  const r = Math.round(mm)
  return `${r > 0 ? '+' : r < 0 ? '−' : '±'}${formatLength(Math.abs(r), unit)}`
}

/** Drawn in this order, so a flagged wall isn't hidden under the room's next door on the same line. */
const DRAW_ORDER: WallVerdict[] = ['ok', 'unchecked', 'step', 'differs', 'conflict', 'recheck']

/** Biggest difference from the plan first. */
const byDifference = (a: WallComparison, b: WallComparison) => Math.abs(b.measured - b.plan) - Math.abs(a.measured - a.plan)

/**
 * Each room as planned (dashed, filled) and as measured (solid), in plan image px. Measured walls are coloured
 * by what they say against the plan, and those that don't match it are labelled with the difference.
 */
export function CompareLayer({ solved, walls, k }: { solved: Solved; walls: WallComparison[]; k: number }) {
  const unit = useStore((s) => s.project.settings.inputUnit)
  const mmPerPx = solved.mmPerPx ?? 1
  // screen px per mm
  const ke = k / mmPerPx
  const path = (pts: { x: number; y: number }[]) => pts.map((p) => `${p.x},${p.y}`).join(' ')
  return (
    <g transform={`scale(${1 / mmPerPx})`} pointerEvents="none">
      {solved.rooms.map((s) => (
        <g key={s.room.id}>
          <polygon
            points={path(s.planMm)}
            fill={roomTypeInfo(s.room.type).color}
            fillOpacity={0.25}
            stroke="#1f2933"
            strokeWidth={1}
            strokeDasharray="4 3"
            vectorEffect="non-scaling-stroke"
          />
          {s.status !== 'empty' && (
            <polygon
              points={path(s.outline)}
              fill="none"
              stroke="#1f2933"
              strokeWidth={1.5}
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
            />
          )}
        </g>
      ))}
      {[...walls].sort((x, y) => DRAW_ORDER.indexOf(x.verdict) - DRAW_ORDER.indexOf(y.verdict)).map((w) => {
        const s = solved.byId.get(w.roomId)
        if (!s) return null
        const a = s.starts[w.group[0]]
        const b = s.ends[w.group[w.group.length - 1]]
        const d = norm(sub(b, a))
        const width = w.verdict === 'ok' ? 3 : 5
        // Just inside the room, so the room across a shared line has its own side of it.
        const inside = scale(outward(d), -width / 2 / ke)
        const at = add(lerp(a, b, 0.5), scale(outward(d), -16 / ke))
        const angle = (Math.atan2(d.y, d.x) * 180) / Math.PI
        const upright = angle > 90 || angle < -90 ? angle + 180 : angle
        return (
          <g key={`${w.roomId}-${w.group[0]}`}>
            {w.group.map((i) => (
              <line
                key={i}
                x1={s.starts[i].x + inside.x}
                y1={s.starts[i].y + inside.y}
                x2={s.ends[i].x + inside.x}
                y2={s.ends[i].y + inside.y}
                stroke={COLOR[w.verdict]}
                strokeWidth={width}
                strokeLinecap="round"
                vectorEffect="non-scaling-stroke"
              />
            ))}
            {w.verdict !== 'ok' && (
              <text
                x={at.x}
                y={at.y}
                fontSize={12 / ke}
                textAnchor="middle"
                dominantBaseline="middle"
                transform={`rotate(${upright} ${at.x} ${at.y})`}
                className="plan-label"
                style={{ fill: COLOR[w.verdict], fontWeight: 700 }}
              >
                {signedLength(w.measured - w.plan, unit)}
              </text>
            )}
          </g>
        )
      })}
      {solved.rooms.map((s) => {
        const c = centroid(s.planMm)
        return (
          <text key={s.room.id} x={c.x} y={c.y} fontSize={12 / ke} textAnchor="middle" dominantBaseline="middle" className="plan-label" fontWeight={600}>
            {s.room.name}
          </text>
        )
      })}
    </g>
  )
}

/** Every measured wall against the plan, what's off first; tap one to go to it. */
export function ComparePanel({ solved, walls }: { solved: Solved; walls: WallComparison[] }) {
  const unit = useStore((s) => s.project.settings.inputUnit)
  const setWizard = useStore((s) => s.setWizard)
  const count = (vs: WallVerdict[]) => walls.filter((w) => vs.includes(w.verdict)).length
  const asPlanned = walls.filter((w) => w.verdict === 'ok').sort(byDifference)

  const row = (w: WallComparison, why: boolean) => {
    const room = solved.byId.get(w.roomId)!.room
    return (
      <li key={`${w.roomId}-${w.group[0]}`}>
        <button onClick={() => setWizard({ roomId: w.roomId, step: w.group[0] })}>
          <span className="compare-row">
            <span>
              <span className="swatch" style={{ background: roomTypeInfo(room.type).color }} />
              {room.name} · wall {w.n}
            </span>
            <span className="muted small">
              {formatLength(w.measured, unit)} measured · plan {formatLength(w.plan, unit)}
            </span>
            {why && <span className="small">{explain(w, unit)}</span>}
          </span>
          <span className={`badge ${BADGE[w.verdict]}`}>{signedLength(w.measured - w.plan, unit)}</span>
        </button>
      </li>
    )
  }

  return (
    <div className="stack">
      <h2>Compare with plan</h2>
      <p>
        Each wall you’ve measured, against the plan and against what the room’s other walls make it. A misread stands out
        from a wall that’s really built differently.
      </p>
      <ul className="compare-key small">
        <li>
          <svg width="22" height="8" aria-hidden>
            <line x1="1" y1="4" x2="21" y2="4" stroke="#1f2933" strokeDasharray="4 3" />
          </svg>
          The plan
        </li>
        <li>
          <svg width="22" height="8" aria-hidden>
            <line x1="1" y1="4" x2="21" y2="4" stroke="#1f2933" strokeWidth="1.5" />
          </svg>
          As measured
        </li>
      </ul>
      <RescaleToMeasurements nudge />
      {!walls.length ? (
        <p className="muted">Nothing measured yet. Once you’ve measured some walls, each is compared with the plan here.</p>
      ) : (
        <p className="muted">
          {walls.length} wall{walls.length === 1 ? '' : 's'} measured: {count(['ok'])} as planned, {count(['differs'])} not as planned,{' '}
          {count(['recheck', 'conflict'])} to re-check
          {count(['step']) > 0 && `, ${count(['step'])} right if an open side is flush`}
          {count(['unchecked']) > 0 && `, ${count(['unchecked'])} not checked yet`}.
        </p>
      )}
      {SECTIONS.map(({ title, verdicts }) => {
        const list = walls.filter((w) => verdicts.includes(w.verdict)).sort(byDifference)
        if (!list.length) return null
        return (
          <section key={title} className="stack tight">
            <h3>
              <span className="swatch" style={{ background: COLOR[verdicts[0]] }} />
              {title}
            </h3>
            <ul className="room-list">{list.map((w) => row(w, true))}</ul>
          </section>
        )
      })}
      {asPlanned.length > 0 && (
        <details className="more">
          <summary>
            <span className="swatch" style={{ background: COLOR.ok }} />
            As planned: {asPlanned.length} wall{asPlanned.length === 1 ? '' : 's'}, within 2% (or 50 mm)
          </summary>
          <ul className="room-list">{asPlanned.map((w) => row(w, false))}</ul>
        </details>
      )}
    </div>
  )
}

function explain(w: WallComparison, unit: LengthUnit): string {
  const others = w.others != null ? formatLength(Math.round(w.others), unit) : ''
  switch (w.verdict) {
    case 'recheck':
      return `The room’s other walls make it ≈ ${others}, as the plan does. Measure it again.`
    case 'conflict':
      return `The room’s other walls make it ≈ ${others}. Measure it again, and the walls across it.`
    case 'step':
      return stepNote(w, unit)
    case 'differs':
      return `The room’s other walls agree, so it’s built ${w.measured > w.plan ? 'longer' : 'shorter'} than drawn.`
    case 'unchecked':
      return 'Nothing checks it yet. Measure the room’s other walls to tell a misread from a wall that isn’t as planned.'
    default:
      return ''
  }
}

/** Why a wall that's off the plan may still be right, when the room's open side is set out from the wall beside it. */
export function stepNote(w: WallComparison, unit: LengthUnit): string {
  const step = formatLength(Math.round(Math.abs((w.others as number) - (w.flush as number))), unit)
  return `The plan sets the room’s open side ${step} out from the wall beside it. If it’s flush, the room’s other walls make this ≈ ${formatLength(Math.round(w.flush as number), unit)}.`
}
