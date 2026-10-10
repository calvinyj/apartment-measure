import { plugSpot, type WallSpot } from '../geometry/plugs'
import type { Solved } from '../geometry/solve'
import { add, outward, scale } from '../geometry/vec'
import type { PlugPoint, Vec2 } from '../types'
import { ACCENT, turn, type LabelBox } from './Lights'

/** Existing points are drawn outlined, new ones filled, so they tell apart without the colour too. */
const STYLE = {
  existing: { fill: '#fff', stroke: '#475569', text: '#334155' },
  new: { fill: '#dc2626', stroke: '#b91c1c', text: '#fff' },
}

/** The badge's height and width on screen, px. */
const BADGE_H = 15
const badgeW = (count: number) => 8 + String(count).length * 7

/** Where a plug point's badge goes, in mm: just inside the room from its spot, upright on screen (the view is turned by `rot`). */
export function plugBadge(s: WallSpot, count: number, ke: number, rot = 0): LabelBox {
  const hw = badgeW(count) / 2 / ke
  const hh = BADGE_H / 2 / ke
  const inward = scale(outward(s.dir), -1)
  const t = turn(inward, rot)
  const reach = hw * Math.abs(t.x) + hh * Math.abs(t.y)
  return { c: add(s.at, scale(inward, reach + 4 / ke)), hw, hh }
}

/** A remark's font size on screen, px. */
const NOTE_PX = 10

/**
 * Where a plug point's remark goes, in mm: beside its badge on screen, to the right unless that's
 * towards the wall (then to the left), so it reads like "[2] TV".
 */
function noteBox(s: WallSpot, badge: LabelBox, note: string, ke: number, rot: number): LabelBox {
  const hw = (note.length * NOTE_PX * 0.6) / 2 / ke
  const hh = (NOTE_PX * 1.1) / 2 / ke
  const side = turn(scale(outward(s.dir), -1), rot).x < -0.5 ? -1 : 1
  const q = turn(badge.c, rot)
  return { c: turn({ x: q.x + side * (badge.hw + 3 / ke + hw), y: q.y }, -rot), hw, hh }
}

export interface PlacedPlug {
  p: PlugPoint
  s: WallSpot
  box: LabelBox
  /** its remark's, if it has one */
  note: LabelBox | null
}

/** Each plug point's spot on its wall and its badge, at this zoom and turn of the view; ones whose room is gone are left out. */
export function placePlugs(
  plugs: PlugPoint[],
  solved: Solved,
  anchors: Map<string, Vec2>,
  ke: number,
  rot = 0,
): PlacedPlug[] {
  return plugs.flatMap((p) => {
    const s = plugSpot(solved, anchors, p)
    if (!s) return []
    const box = plugBadge(s, p.count, ke, rot)
    const note = p.note.trim() ? noteBox(s, box, p.note.trim(), ke, rot) : null
    return [{ p, s, box, note }]
  })
}

/** What the plug points cover on the plan, for other labels to keep off. */
export const plugBoxes = (placed: PlacedPlug[]) => placed.flatMap((x) => (x.note ? [x.box, x.note] : [x.box]))

/** An upright box at b (mm) on a view turned by `rot`, e.g. a bigger target for a finger. */
const upright = (b: LabelBox, rot: number) => ({
  x: b.c.x - b.hw,
  y: b.c.y - b.hh,
  width: b.hw * 2,
  height: b.hh * 2,
  transform: rot ? `rotate(${-rot} ${b.c.x} ${b.c.y})` : undefined,
})

/** One plug point: a mark on the wall where it is, and a badge with how many sockets it has. */
function PlugSymbol({
  count,
  existing,
  s,
  box,
  ke,
  rot,
}: {
  count: number
  existing: boolean
  s: WallSpot
  box: LabelBox
  ke: number
  rot: number
}) {
  const st = existing ? STYLE.existing : STYLE.new
  const half = scale(s.dir, 5 / ke)
  // On the room's side of the wall's face.
  const m = add(s.at, scale(outward(s.dir), -1.5 / ke))
  const { c, hw, hh } = box
  return (
    <g>
      <line
        x1={m.x - half.x}
        y1={m.y - half.y}
        x2={m.x + half.x}
        y2={m.y + half.y}
        stroke={st.stroke}
        strokeWidth={3}
        vectorEffect="non-scaling-stroke"
      />
      <g transform={rot ? `rotate(${-rot} ${c.x} ${c.y})` : undefined}>
        <rect
          x={c.x - hw}
          y={c.y - hh}
          width={hw * 2}
          height={hh * 2}
          rx={3 / ke}
          fill={st.fill}
          stroke={st.stroke}
          strokeWidth={1.5}
          vectorEffect="non-scaling-stroke"
        />
        <text
          x={c.x}
          y={c.y + 3.6 / ke}
          fontSize={10.5 / ke}
          fontWeight={700}
          textAnchor="middle"
          fill={st.text}
          pointerEvents="none"
        >
          {count}
        </text>
      </g>
    </g>
  )
}

/**
 * Plug points over the floor plan, in mm (`placed`: each with its spot on the wall and its badge).
 * Interactive, each is a drag target (`p:<id>`) and the selected one is highlighted.
 */
export function PlugLayer({
  placed,
  ke,
  rot = 0,
  selectedId,
  interactive = false,
}: {
  placed: PlacedPlug[]
  ke: number
  rot?: number
  selectedId?: string | null
  interactive?: boolean
}) {
  const sel = placed.find((x) => x.p.id === selectedId)
  const pad = 4 / ke
  return (
    <g pointerEvents={interactive ? undefined : 'none'}>
      {sel && (
        <rect
          x={sel.box.c.x - sel.box.hw - pad}
          y={sel.box.c.y - sel.box.hh - pad}
          width={(sel.box.hw + pad) * 2}
          height={(sel.box.hh + pad) * 2}
          rx={5 / ke}
          transform={rot ? `rotate(${-rot} ${sel.box.c.x} ${sel.box.c.y})` : undefined}
          fill={ACCENT}
          fillOpacity={0.18}
          stroke={ACCENT}
          strokeWidth={2}
          vectorEffect="non-scaling-stroke"
        />
      )}
      {placed.map(({ p, s, box, note }) => (
        <g
          key={p.id}
          data-handle={interactive ? `p:${p.id}` : undefined}
          className={interactive ? 'handle' : undefined}
        >
          <PlugSymbol count={p.count} existing={p.existing} s={s} box={box} ke={ke} rot={rot} />
          {note && (
            <text
              x={note.c.x}
              y={note.c.y + (NOTE_PX * 0.35) / ke}
              fontSize={NOTE_PX / ke}
              textAnchor="middle"
              transform={rot ? `rotate(${-rot} ${note.c.x} ${note.c.y})` : undefined}
              className="plan-label plug-note"
            >
              {p.note.trim()}
            </text>
          )}
          {/* A bigger target than the badge, for fingers, and the remark can be tapped too. */}
          {interactive && <circle cx={box.c.x} cy={box.c.y} r={15 / ke} fill="transparent" />}
          {interactive && note && <rect {...upright(note, rot)} fill="transparent" />}
        </g>
      ))}
    </g>
  )
}

/** A plug point's badge on its own, for buttons, the key and tables. */
export function PlugIcon({ existing, count = 2 }: { existing: boolean; count?: number }) {
  return (
    <svg viewBox="-14 -14 28 28" aria-hidden className="light-icon">
      <line x1={-12} y1={-11} x2={12} y2={-11} stroke="#3f4652" strokeWidth={3} />
      <PlugSymbol
        count={count}
        existing={existing}
        s={{ at: { x: 0, y: -9.5 }, edge: 0, dir: { x: 1, y: 0 }, a: { x: -12, y: -9.5 }, b: { x: 12, y: -9.5 } }}
        box={{ c: { x: 0, y: 1.5 } as Vec2, hw: badgeW(count) / 2, hh: BADGE_H / 2 }}
        ke={1}
        rot={0}
      />
    </svg>
  )
}

/** A plug point's badge in text, e.g. in tables. */
export function PlugBadge({ count, existing }: { count: number; existing: boolean }) {
  return (
    <span
      className={`plug-badge${existing ? '' : ' new'}`}
      title={`${existing ? 'Existing' : 'New'}, ${count} socket${count > 1 ? 's' : ''}`}
    >
      {count}
    </span>
  )
}
