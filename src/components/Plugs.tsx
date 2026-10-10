import { plugSpot, type WallSpot } from '../geometry/plugs'
import { pointInPolygon } from '../geometry/polygon'
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

/** A remark's font size on screen, and its gap from the badge, px. */
const NOTE_PX = 10
const NOTE_GAP = 4

let measure: CanvasRenderingContext2D | null | undefined

/** How wide a remark is on screen, px: measured in the page's font, or a fair guess with no page (in tests). */
function noteWidth(text: string): number {
  if (measure === undefined) {
    measure = typeof document === 'undefined' ? null : document.createElement('canvas').getContext('2d')
    if (measure) measure.font = `${NOTE_PX}px ${getComputedStyle(document.body).fontFamily}`
  }
  return measure ? measure.measureText(text).width : text.length * NOTE_PX * 0.55
}

/** A plug point's remark: its lines start (or end) at `at`, beside the badge and centred on it across, covering `box`. */
export interface PlugNote {
  lines: string[]
  at: Vec2
  anchor: 'start' | 'end'
  box: LabelBox
}

/** A long remark as two lines, split at the comma, or else the space, nearest the middle; null for a single word. */
function twoLines(text: string): string[] | null {
  const breaks = (re: RegExp) => [...text.matchAll(re)].map((m) => m.index! + m[0].length)
  const at = breaks(/,\s*/g).length ? breaks(/,\s*/g) : breaks(/\s+/g)
  if (!at.length) return null
  const cut = at.reduce((a, b) => (Math.abs(b - text.length / 2) < Math.abs(a - text.length / 2) ? b : a))
  return [text.slice(0, cut).trim(), text.slice(cut).trim()]
}

/**
 * Where a plug point's remark could go, in mm, best first. Beside its badge on screen, so it reads
 * like "[2] TV": away from the wall when the wall is beside the badge, or else to the right or the
 * left. Failing that, under or over the badge (away from the wall), lined up with its edge.
 */
function noteOptions(s: WallSpot, badge: LabelBox, lines: string[], ke: number, rot: number): PlugNote[] {
  const w = Math.max(...lines.map(noteWidth)) / ke
  const hh = (lines.length * NOTE_PX * 1.2) / 2 / ke
  const q = turn(badge.c, rot)
  const inward = turn(scale(outward(s.dir), -1), rot)
  // `side`: which way the text runs from x, on screen.
  const note = (x: number, y: number, side: number): PlugNote => ({
    lines,
    at: turn({ x, y }, -rot),
    anchor: side > 0 ? 'start' : 'end',
    box: { c: turn({ x: x + (side * w) / 2, y }, -rot), hw: w / 2, hh },
  })
  const beside = (side: number) => note(q.x + side * (badge.hw + NOTE_GAP / ke), q.y, side)
  const under = (down: number, side: number) => note(q.x - side * badge.hw, q.y + down * (badge.hh + 2 / ke + hh), side)
  if (Math.abs(inward.x) > 0.5) {
    const side = Math.sign(inward.x)
    return [beside(side), under(1, side), under(-1, side)]
  }
  const down = Math.sign(inward.y)
  return [beside(1), beside(-1), under(down, 1), under(down, -1)]
}

/** How much two boxes (mm, upright on a view turned by `rot`) overlap on screen, mm². */
function overlap(a: LabelBox, b: LabelBox, rot: number) {
  const p = turn(a.c, rot)
  const q = turn(b.c, rot)
  const x = Math.min(p.x + a.hw, q.x + b.hw) - Math.max(p.x - a.hw, q.x - b.hw)
  const y = Math.min(p.y + a.hh, q.y + b.hh) - Math.max(p.y - a.hh, q.y - b.hh)
  return x > 0 && y > 0 ? x * y : 0
}

/** How much of a box (mm, upright on a view turned by `rot`) is outside the outline, 0–1, from points across it. */
function outside(b: LabelBox, outline: Vec2[], rot: number) {
  const q = turn(b.c, rot)
  const fx = [-1, -0.5, 0, 0.5, 1]
  const fy = [-1, 0, 1]
  const out = fx.flatMap((x) =>
    fy.filter((y) => !pointInPolygon(turn({ x: q.x + x * b.hw, y: q.y + y * b.hh }, -rot), outline)),
  )
  return out.length / (fx.length * fy.length)
}

export interface PlacedPlug {
  p: PlugPoint
  s: WallSpot
  box: LabelBox
  note: PlugNote | null
}

/**
 * What a remark costs, by how much of something it covers (on screen): going outside its room
 * (through a wall) is worst, then covering other plug points. Wrapping onto two lines costs a little,
 * so a remark only wraps when one line can't go anywhere clear.
 */
const COVERS = { outside: 2, plug: 1.5, other: 1, wrap: 40 }

/**
 * Each plug point's spot on its wall, its badge and its remark, at this zoom and turn of the view;
 * ones whose room is gone are left out. A remark goes where it stays in the room and covers least
 * of the other badges and remarks, and of `avoid` (room labels, lights).
 */
export function placePlugs(
  plugs: PlugPoint[],
  solved: Solved,
  anchors: Map<string, Vec2>,
  ke: number,
  rot = 0,
  avoid: LabelBox[] = [],
): PlacedPlug[] {
  const spots = plugs.flatMap((p) => {
    const s = plugSpot(solved, anchors, p)
    return s ? [{ p, s, box: plugBadge(s, p.count, ke, rot) }] : []
  })
  const taken = spots.map((x) => x.box)
  const px2 = ke * ke
  return spots.map(({ p, s, box }) => {
    const text = p.note.trim()
    if (!text) return { p, s, box, note: null }
    const outline = solved.byId.get(p.roomId)?.outline
    const sum = (boxes: LabelBox[], n: PlugNote) =>
      boxes.reduce((a, b) => a + (b === box ? 0 : overlap(n.box, b, rot)), 0)
    // How much of the remark is through the wall, mm².
    const through = (n: PlugNote) => (outline ? outside(n.box, outline, rot) * 4 * n.box.hw * n.box.hh : 0)
    const cost = (n: PlugNote) =>
      px2 * (COVERS.outside * through(n) + COVERS.plug * sum(taken, n) + COVERS.other * sum(avoid, n)) +
      (n.lines.length > 1 ? COVERS.wrap : 0)
    const wrapped = twoLines(text)
    const options = [...noteOptions(s, box, [text], ke, rot), ...(wrapped ? noteOptions(s, box, wrapped, ke, rot) : [])]
    const note = options.reduce((best, n) => (cost(n) < cost(best) ? n : best))
    taken.push(note.box)
    return { p, s, box, note }
  })
}

/** What the plug points cover on the plan, for other labels to keep off. */
export const plugBoxes = (placed: PlacedPlug[]) => placed.flatMap((x) => (x.note ? [x.box, x.note.box] : [x.box]))

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
              x={note.at.x}
              y={note.at.y + (NOTE_PX * 0.35 - ((note.lines.length - 1) * NOTE_PX * 1.2) / 2) / ke}
              fontSize={NOTE_PX / ke}
              textAnchor={note.anchor}
              transform={rot ? `rotate(${-rot} ${note.at.x} ${note.at.y})` : undefined}
              className="plan-label plug-note"
            >
              {note.lines.map((line, i) => (
                <tspan key={i} x={note.at.x} dy={i ? (NOTE_PX * 1.2) / ke : 0}>
                  {line}
                </tspan>
              ))}
            </text>
          )}
          {/* A bigger target than the badge, for fingers, and the remark can be tapped too. */}
          {interactive && <circle cx={box.c.x} cy={box.c.y} r={15 / ke} fill="transparent" />}
          {interactive && note && <rect {...upright(note.box, rot)} fill="transparent" />}
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
