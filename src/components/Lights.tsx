import { direction, lightCentre, lightEnds, tempLabel, wattLabel } from '../geometry/lights'
import { pointInPolygon } from '../geometry/polygon'
import { add, outward, scale, sub } from '../geometry/vec'
import type { Light, LightKind, LightTemp, Vec2 } from '../types'

const DOWNLIGHT = { fill: '#fde4c3', stroke: '#b7791f' }
const SURFACE = { fill: '#fef3c7', stroke: '#a16207' }
const EYEBALL = '#1f2933'
const PENDANT = { fill: '#f7d4cc', stroke: '#9b4434' }
const STRIP = '#0f9d6b'
const FAN = { fill: '#cbd5e1', stroke: '#475569' }
export const ACCENT = '#2563eb'

const thin = { strokeWidth: 1.5, vectorEffect: 'non-scaling-stroke' } as const
const RAD = Math.PI / 180

type Drawn = Pick<Light, 'kind' | 'angle' | 'length' | 'size'>

/** A round fitting's radius in mm: its real size, or big enough to see (and tap) on screen. */
const roundRadius = (l: Drawn, ke: number) =>
  Math.max((l.kind === 'pendant' || l.kind === 'surface' ? 8 : 6.5) / ke, (l.size ?? 0) / 2)

/** How far from its centre an eyeball's arrow reaches, in mm. */
const aimReach = (l: Drawn, ke: number) => Math.max(24 / ke, roundRadius(l, ke) + 16 / ke)

/**
 * One light at c, drawn in mm at a size that reads on screen (`ke` = screen px per mm), or at
 * its real size once that's bigger. A fan is drawn at its real blade sweep, which doesn't catch
 * the pointer, so lights can go under it.
 */
function LightSymbol({ l, c, ke }: { l: Drawn; c: Vec2; ke: number }) {
  const px = (n: number) => n / ke
  switch (l.kind) {
    case 'downlight':
      return (
        <circle cx={c.x} cy={c.y} r={roundRadius(l, ke)} fill={DOWNLIGHT.fill} stroke={DOWNLIGHT.stroke} {...thin} />
      )
    case 'surface': {
      // A ceiling light point: a circle with a cross through it.
      const r = roundRadius(l, ke)
      const k = r * 0.7071
      return (
        <g>
          <circle cx={c.x} cy={c.y} r={r} fill={SURFACE.fill} stroke={SURFACE.stroke} {...thin} />
          <path
            d={`M${c.x - k} ${c.y - k}L${c.x + k} ${c.y + k}M${c.x + k} ${c.y - k}L${c.x - k} ${c.y + k}`}
            stroke={SURFACE.stroke}
            {...thin}
          />
        </g>
      )
    }
    case 'eyeball': {
      const d = direction(l.angle)
      const tip = add(c, scale(d, aimReach(l, ke)))
      const back = sub(tip, scale(d, px(6)))
      const n = scale(outward(d), px(4))
      return (
        <g>
          <line x1={c.x} y1={c.y} x2={back.x} y2={back.y} stroke={EYEBALL} {...thin} />
          <polygon points={[tip, add(back, n), sub(back, n)].map((p) => `${p.x},${p.y}`).join(' ')} fill={EYEBALL} />
          <circle cx={c.x} cy={c.y} r={roundRadius(l, ke)} fill="#fff" stroke={EYEBALL} {...thin} />
          <circle cx={c.x} cy={c.y} r={px(2)} fill={EYEBALL} />
        </g>
      )
    }
    case 'pendant':
      // A round pendant, or a linear one drawn at its real length.
      return l.length > 0 ? (
        <rect
          x={c.x - l.length / 2}
          y={c.y - px(4.5)}
          width={l.length}
          height={px(9)}
          rx={px(4.5)}
          transform={`rotate(${l.angle} ${c.x} ${c.y})`}
          fill={PENDANT.fill}
          stroke={PENDANT.stroke}
          {...thin}
        />
      ) : (
        <g>
          <circle cx={c.x} cy={c.y} r={roundRadius(l, ke)} fill={PENDANT.fill} stroke={PENDANT.stroke} {...thin} />
          <circle cx={c.x} cy={c.y} r={px(3)} fill="none" stroke={PENDANT.stroke} {...thin} />
        </g>
      )
    case 'strip': {
      const [a, b] = lightEnds(c, l)
      return (
        <line
          x1={a.x}
          y1={a.y}
          x2={b.x}
          y2={b.y}
          stroke={STRIP}
          strokeWidth={3}
          strokeDasharray="7 4"
          vectorEffect="non-scaling-stroke"
        />
      )
    }
    case 'fan': {
      const r = l.length / 2
      return (
        <g>
          <circle
            cx={c.x}
            cy={c.y}
            r={r}
            fill={FAN.fill}
            fillOpacity={0.35}
            stroke={FAN.stroke}
            strokeDasharray="5 4"
            pointerEvents="none"
            {...thin}
          />
          {[0, 120, 240].map((a) => {
            const tip = add(c, scale(direction(l.angle + a), r * 0.85))
            return (
              <line
                key={a}
                x1={c.x}
                y1={c.y}
                x2={tip.x}
                y2={tip.y}
                stroke={FAN.stroke}
                strokeWidth={px(5)}
                strokeLinecap="round"
              />
            )
          })}
          <circle cx={c.x} cy={c.y} r={px(5)} fill="#fff" stroke={FAN.stroke} {...thin} />
        </g>
      )
    }
  }
}

const linear = (l: Light) => l.kind === 'strip' || (l.kind === 'pendant' && l.length > 0)

interface Box {
  x0: number
  y0: number
  x1: number
  y1: number
}

const overlap = (a: Box, b: Box) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1
const around = (p: Vec2, hw: number, hh: number): Box => ({ x0: p.x - hw, y0: p.y - hh, x1: p.x + hw, y1: p.y + hh })
const spanning = (pts: Vec2[], pad: number): Box => ({
  x0: Math.min(...pts.map((p) => p.x)) - pad,
  y0: Math.min(...pts.map((p) => p.y)) - pad,
  x1: Math.max(...pts.map((p) => p.x)) + pad,
  y1: Math.max(...pts.map((p) => p.y)) + pad,
})

/** p turned about the origin by deg, clockwise on screen (as SVG's rotate). */
export function turn(p: Vec2, deg: number): Vec2 {
  const cos = Math.cos(deg * RAD)
  const sin = Math.sin(deg * RAD)
  return { x: p.x * cos - p.y * sin, y: p.x * sin + p.y * cos }
}

/**
 * Where a light's symbol is on screen, in mm turned by the view's rotation (so boxes are upright
 * on screen): its body, and an eyeball's arrow. A fan's blades and sweep don't count.
 */
function symbolBoxes(l: Light, c: Vec2, ke: number, rot: number): { body: Box; arrow?: Box } {
  const q = turn(c, rot)
  if (linear(l))
    return {
      body: spanning(
        lightEnds(c, l).map((p) => turn(p, rot)),
        (l.kind === 'strip' ? 3 : 5) / ke,
      ),
    }
  if (l.kind === 'fan') return { body: around(q, 5 / ke, 5 / ke) }
  const r = roundRadius(l, ke)
  const body = around(q, r, r)
  if (l.kind !== 'eyeball') return { body }
  const tip = turn(add(c, scale(direction(l.angle), aimReach(l, ke))), rot)
  return { body, arrow: spanning([q, tip], 4 / ke) }
}

/** Something else on the plan for labels to keep off: centred on c, half sizes upright on screen, in mm. */
export interface LabelBox {
  c: Vec2
  hw: number
  hh: number
}

/** Where the lights' symbols are, for labels to keep off; a fan's blades and sweep don't count. */
export function lightBoxes(lights: Light[], anchors: Map<string, Vec2>, ke: number, rot = 0): LabelBox[] {
  return lights.flatMap((l) => {
    const c = lightCentre(anchors, l)
    if (!c) return []
    const { body, arrow } = symbolBoxes(l, c, ke, rot)
    return (arrow ? [body, arrow] : [body]).map((b) => ({
      c: turn({ x: (b.x0 + b.x1) / 2, y: (b.y0 + b.y1) / 2 }, -rot),
      hw: (b.x1 - b.x0) / 2,
      hh: (b.y1 - b.y0) / 2,
    }))
  })
}

const tempClass = (t: LightTemp) => (t === 'tri' ? '' : t <= 3000 ? ' warm' : t >= 5000 ? ' daylight' : ' cool')

/** What a label costs where it covers something; the cheapest spot wins, in the order they're tried. */
const COVERS = { light: 4, label: 4, room: 3, wall: 2 }

/**
 * Each light's power and colour temperature, upright on screen (the view is turned by `rot`). A
 * label goes under its light or over it (centred, or lined up with either side), or beside it
 * (first, for a light running down the screen): wherever covers least of the lights, the labels
 * already placed and `avoid` (room labels), and stays inside the light's room when `outlines` are given.
 */
function SpecLabels({
  placed,
  ke,
  rot,
  avoid,
  outlines,
}: {
  placed: { l: Light; c: Vec2 }[]
  ke: number
  rot: number
  avoid: LabelBox[]
  outlines?: Map<string, Vec2[]>
}) {
  const fs = 10 / ke
  const gap = 3 / ke
  const symbols = placed.map(({ l, c }) => symbolBoxes(l, c, ke, rot))
  const fixed = [
    ...avoid.map((a) => ({ box: around(turn(a.c, rot), a.hw, a.hh), cost: COVERS.room })),
    ...symbols.flatMap((s) => (s.arrow ? [s.body, s.arrow] : [s.body])).map((box) => ({ box, cost: COVERS.light })),
  ]
  const covers = (o: Box, things: { box: Box; cost: number }[]) =>
    things.reduce((sum, t) => sum + (overlap(o, t.box) ? t.cost : 0), 0)
  // Every spot each label could go, and what it covers before any labels are down.
  const wanted = placed.flatMap(({ l, c }, i) => {
    const watt = wattLabel(l)
    const temp = l.temp == null ? null : tempLabel(l.temp)
    if (!watt && !temp) return []
    const w = [watt, temp].filter(Boolean).join(' ').length * fs * 0.6
    const h = fs * 1.1
    const b = symbols[i].body
    const q = turn(c, rot)
    const rows = [
      { y0: b.y1 + gap, y1: b.y1 + gap + h },
      { y0: b.y0 - gap - h, y1: b.y0 - gap },
    ]
    const spans = [
      { x0: q.x - w / 2, x1: q.x + w / 2 },
      { x0: b.x0, x1: b.x0 + w },
      { x0: b.x1 - w, x1: b.x1 },
    ]
    const sides = [
      { x0: b.x1 + gap, x1: b.x1 + gap + w, y0: q.y - h / 2, y1: q.y + h / 2 },
      { x0: b.x0 - gap - w, x1: b.x0 - gap, y0: q.y - h / 2, y1: q.y + h / 2 },
    ]
    const overUnder = spans.flatMap((x) => rows.map((y) => ({ ...x, ...y })))
    const tall = b.y1 - b.y0 > (b.x1 - b.x0) * 1.5
    const options = tall ? [...sides, ...overUnder] : [...overUnder, ...sides]
    const outline = outlines?.get(l.roomId)
    const outside = (o: Box) =>
      !!outline &&
      [
        { x: o.x0, y: o.y0 },
        { x: o.x1, y: o.y0 },
        { x: o.x1, y: o.y1 },
        { x: o.x0, y: o.y1 },
      ].some((p) => !pointInPolygon(turn(p, -rot), outline))
    const base = options.map((o) => covers(o, fixed) + (outside(o) ? COVERS.wall : 0))
    return [{ l, watt, temp, options, base, free: base.filter((x) => x === 0).length }]
  })
  // The most hemmed in go first, so the others make way for them.
  const labels: { box: Box; cost: number }[] = []
  const chosen = new Map<string, Box>()
  for (const x of [...wanted].sort((a, b) => a.free - b.free)) {
    const costs = x.options.map((o, i) => x.base[i] + covers(o, labels))
    const box = x.options[costs.indexOf(Math.min(...costs))]
    labels.push({ box, cost: COVERS.label })
    chosen.set(x.l.id, box)
  }
  return (
    // Drawn in the screen's frame: mm turned back by the view's rotation.
    <g transform={rot ? `rotate(${-rot})` : undefined} pointerEvents="none">
      {wanted.map(({ l, watt, temp }) => {
        const box = chosen.get(l.id)!
        return (
          <text
            key={l.id}
            x={(box.x0 + box.x1) / 2}
            y={(box.y0 + box.y1) / 2 + fs * 0.35}
            fontSize={fs}
            textAnchor="middle"
            className="plan-label spec"
          >
            {watt}
            {watt && temp && ' '}
            {temp && <tspan className={`temp${tempClass(l.temp!)}`}>{temp}</tspan>}
          </text>
        )
      })}
    </g>
  )
}

function Handle({ p, ke, id }: { p: Vec2; ke: number; id: string }) {
  return (
    <circle
      data-handle={id}
      className="handle"
      cx={p.x}
      cy={p.y}
      r={6 / ke}
      fill="#fff"
      stroke={ACCENT}
      strokeWidth={2}
      vectorEffect="non-scaling-stroke"
    />
  )
}

/**
 * The lights and fans over the floor plan, in mm, optionally with their power and colour
 * temperature (`specs`), placed clear of `avoid` and inside each light's room. Interactive, each light is a drag target (`l:<id>`), and the selected
 * one gets handles: an eyeball's aim (`a:<id>`) and the ends of a pendant or LED tube (`e0:<id>`, `e1:<id>`).
 */
export function LightLayer({
  lights,
  anchors,
  ke,
  rot = 0,
  specs = false,
  avoid = [],
  outlines,
  selectedId,
  interactive = false,
}: {
  lights: Light[]
  anchors: Map<string, Vec2>
  ke: number
  rot?: number
  specs?: boolean
  avoid?: LabelBox[]
  outlines?: Map<string, Vec2[]>
  selectedId?: string | null
  interactive?: boolean
}) {
  const placed = lights.flatMap((l) => {
    const c = lightCentre(anchors, l)
    return c ? [{ l, c }] : []
  })
  const sel = placed.find((x) => x.l.id === selectedId)
  return (
    <g pointerEvents={interactive ? undefined : 'none'}>
      {sel &&
        (linear(sel.l) ? (
          (() => {
            const [a, b] = lightEnds(sel.c, sel.l)
            return (
              <line
                x1={a.x}
                y1={a.y}
                x2={b.x}
                y2={b.y}
                stroke={ACCENT}
                strokeOpacity={0.3}
                strokeWidth={16}
                strokeLinecap="round"
                vectorEffect="non-scaling-stroke"
              />
            )
          })()
        ) : (
          <circle
            cx={sel.c.x}
            cy={sel.c.y}
            r={sel.l.kind === 'fan' ? sel.l.length / 2 : Math.max(12 / ke, roundRadius(sel.l, ke) + 5 / ke)}
            fill={ACCENT}
            fillOpacity={0.18}
            stroke={ACCENT}
            strokeWidth={2}
            vectorEffect="non-scaling-stroke"
          />
        ))}
      {placed.map(({ l, c }) => (
        <g
          key={l.id}
          data-handle={interactive ? `l:${l.id}` : undefined}
          className={interactive ? 'handle' : undefined}
        >
          <LightSymbol l={l} c={c} ke={ke} />
          {/* A bigger target than the symbol, for fingers. */}
          {interactive &&
            (linear(l) ? (
              (() => {
                const [a, b] = lightEnds(c, l)
                return (
                  <line
                    x1={a.x}
                    y1={a.y}
                    x2={b.x}
                    y2={b.y}
                    stroke="transparent"
                    strokeWidth={22}
                    vectorEffect="non-scaling-stroke"
                  />
                )
              })()
            ) : (
              <circle cx={c.x} cy={c.y} r={Math.max(15 / ke, roundRadius(l, ke))} fill="transparent" />
            ))}
        </g>
      ))}
      {specs && <SpecLabels placed={placed} ke={ke} rot={rot} avoid={avoid} outlines={outlines} />}
      {interactive && sel && sel.l.kind === 'eyeball' && (
        <Handle p={add(sel.c, scale(direction(sel.l.angle), aimReach(sel.l, ke)))} ke={ke} id={`a:${sel.l.id}`} />
      )}
      {interactive &&
        sel &&
        linear(sel.l) &&
        lightEnds(sel.c, sel.l).map((p, i) => <Handle key={i} p={p} ke={ke} id={`e${i}:${sel.l.id}`} />)}
    </g>
  )
}

const ICON: Record<LightKind, { c: Vec2; ke: number; length: number }> = {
  downlight: { c: { x: 0, y: 0 }, ke: 1, length: 0 },
  surface: { c: { x: 0, y: 0 }, ke: 0.95, length: 0 },
  eyeball: { c: { x: -7, y: 0 }, ke: 1.2, length: 0 },
  pendant: { c: { x: 0, y: 0 }, ke: 1, length: 22 },
  strip: { c: { x: 0, y: 0 }, ke: 1, length: 24 },
  fan: { c: { x: 0, y: 0 }, ke: 1.6, length: 26 },
}

/** A light's or fan's symbol on its own, for buttons, the key and table headings. */
export function LightIcon({ kind }: { kind: LightKind }) {
  const { c, ke, length } = ICON[kind]
  return (
    <svg viewBox="-14 -14 28 28" aria-hidden className="light-icon">
      <LightSymbol l={{ kind, angle: 0, length, size: null }} c={c} ke={ke} />
    </svg>
  )
}
