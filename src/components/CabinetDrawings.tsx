import { useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { cabinetTop } from '../cabinets/checks'
import { doorLeaves } from '../cabinets/materials'
import { legPoint, outline, type Placement } from '../cabinets/placement'
import { doorSpace, insideSpace, layOut, moveDivider, samePath, type LaidCell, type LaidDivider, type Rect } from '../cabinets/sections'
import { bbox } from '../geometry/polygon'
import type { ApplianceKind, Cabinet, CabinetSection, Cutout, Vec2 } from '../types'
import { parseHexColor } from './common'

const INK = '#3f4652'
const MUTED = '#6b7280'
const ACCENT = '#2563eb'
/** Lines drawn on a finish, and fainter ones (door swings, rails). */
export interface Ink {
  line: string
  faint: string
}

const DARK_INK: Ink = { line: INK, faint: MUTED }
const LIGHT_INK: Ink = { line: '#f3f4f6', faint: '#b9c0ca' }

/** Relative luminance of a hex colour (0 black to 1 white), as WCAG defines it. */
function luminance(hex: string) {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const v = parseInt(hex.slice(i, i + 2), 16) / 255
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

const contrast = (a: number, b: number) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)

/** Lines that show up on this finish: dark ones on a light finish, light ones on a dark finish. */
export function inkOn(fill: string): Ink {
  const hex = parseHexColor(fill)
  if (!hex) return DARK_INK
  const l = luminance(hex)
  return contrast(l, luminance(LIGHT_INK.line)) > contrast(l, luminance(INK)) ? LIGHT_INK : DARK_INK
}

/** Gap between legs in the unfolded elevation, mm. */
const LEG_GAP = 240
/** Gap between neighbouring fronts, mm. */
const GAP = 3
/** How deep a sink or basin bowl is drawn below the top, mm. */
const BOWL = 180

export const APPLIANCE_LABEL: Record<ApplianceKind, string> = {
  oven: 'Oven',
  microwave: 'Microwave',
  dishwasher: 'Dishwasher',
  fridge: 'Fridge',
  washer: 'Washer',
  hood: 'Hood',
  other: 'Appliance',
}

export const CUTOUT_LABEL: Record<Cutout['kind'], string> = { sink: 'Sink', hob: 'Hob', basin: 'Basin' }

/** The element's size on screen, kept up to date. */
function useBoxSize<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const [size, setSize] = useState({ w: 0, h: 0 })
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setSize({ w: e.contentRect.width, h: e.contentRect.height }))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, size] as const
}

interface Box {
  minX: number
  minY: number
  w: number
  h: number
}

/** Fit content (mm) into the screen box with pad px on each side: px per mm, and the viewBox. */
function fitView(content: Box, screen: { w: number; h: number }, pad: { l: number; r: number; t: number; b: number }) {
  const k = Math.max(1e-4, Math.min((screen.w - pad.l - pad.r) / content.w, (screen.h - pad.t - pad.b) / content.h))
  // Centre what's left over.
  const extraX = (screen.w - pad.l - pad.r - content.w * k) / 2
  const extraY = (screen.h - pad.t - pad.b - content.h * k) / 2
  const minX = content.minX - (pad.l + extraX) / k
  const minY = content.minY - (pad.t + extraY) / k
  return { k, viewBox: `${minX} ${minY} ${screen.w / k} ${screen.h / k}` }
}

/** Fronts are drawn a hair apart, so neighbours read as separate doors. */
const inset = (r: Rect, g = GAP / 2): Rect => ({ x: r.x + g, y: r.y + g, w: Math.max(0, r.w - 2 * g), h: Math.max(0, r.h - 2 * g) })

const line = (x1: number, y1: number, x2: number, y2: number, props: Record<string, unknown> = {}) => (
  <line x1={x1} y1={y1} x2={x2} y2={y2} vectorEffect="non-scaling-stroke" {...props} />
)

/** Shelves, and a hanging rail under the top shelf (or near the top), inside a compartment. */
function Inside({ r, shelves, rail, k, ink }: { r: Rect; shelves: number; rail: boolean; k: number; ink: Ink }) {
  const ys = rail
    ? Array.from({ length: shelves }, (_, i) => r.y + Math.min(300 * (i + 1), (r.h * (i + 1)) / (shelves + 2)))
    : Array.from({ length: shelves }, (_, i) => r.y + (r.h * (i + 1)) / (shelves + 1))
  const railY = rail ? (ys.length ? ys[ys.length - 1] : r.y) + 70 : null
  return (
    <g pointerEvents="none">
      {ys.map((y, i) => (
        <rect key={i} x={r.x + 8} y={y - 9} width={Math.max(0, r.w - 16)} height={18} fill="#cbd5e1" stroke={MUTED} strokeWidth={0.6} vectorEffect="non-scaling-stroke" />
      ))}
      {railY != null && (
        <>
          {line(r.x + 20, railY, r.x + r.w - 20, railY, { stroke: ink.faint, strokeWidth: 2.5, strokeLinecap: 'round' })}
          {r.h > 600 &&
            Array.from({ length: Math.max(1, Math.floor((r.w - 80) / 120)) }, (_, i) => {
              const x = r.x + 60 + i * 120
              return (
                <path
                  key={i}
                  d={`M${x} ${railY} l-40 ${Math.min(600, r.h * 0.45)} h80 z`}
                  fill="none"
                  stroke="#9ca3af"
                  strokeWidth={0.7}
                  vectorEffect="non-scaling-stroke"
                />
              )
            })}
          {r.w * k > 70 && (
            <text x={r.x + r.w / 2} y={railY + 14 / k} fontSize={10 / k} textAnchor="middle" fill={ink.faint}>
              hanging
            </text>
          )}
        </>
      )}
    </g>
  )
}

/** Drawers inside a compartment, behind its doors: fronts of inside board, set in from the sides, with a finger pull. */
function InsideDrawers({ r, n, fill, ink }: { r: Rect; n: number; fill: string; ink: Ink }) {
  const h = r.h / n
  return (
    <g pointerEvents="none">
      {Array.from({ length: n }, (_, i) => {
        const d = inset({ x: r.x + 20, y: r.y + i * h, w: Math.max(0, r.w - 40), h })
        const pull = Math.min(60, d.w * 0.15)
        const y = d.y + Math.min(30, d.h * 0.2)
        return (
          <g key={i}>
            <rect x={d.x} y={d.y} width={d.w} height={d.h} fill={fill} stroke={ink.line} strokeWidth={0.8} vectorEffect="non-scaling-stroke" />
            {line(d.x + d.w / 2 - pull, y, d.x + d.w / 2 + pull, y, { stroke: ink.faint, strokeWidth: 2, strokeLinecap: 'round' })}
          </g>
        )
      })}
    </g>
  )
}

/** Where a handle goes on a front: near the top of a base cabinet's, the bottom of a wall cabinet's, else the middle. */
type HandleAt = 'top' | 'middle' | 'bottom'

function Handle({
  c,
  r,
  side,
  at,
  horizontal,
  ink,
}: {
  c: Cabinet
  r: Rect
  side: 'left' | 'right' | 'centre'
  at: HandleAt
  horizontal?: boolean
  ink: Ink
}) {
  if (c.handle === 'none') return null
  if (c.handle === 'profile') {
    const y = at === 'bottom' ? r.y + r.h - 6 : r.y + 6
    return line(r.x, y, r.x + r.w, y, { stroke: ink.line, strokeWidth: 2, pointerEvents: 'none' })
  }
  const x = side === 'left' ? r.x + 40 : side === 'right' ? r.x + r.w - 40 : r.x + r.w / 2
  const y = at === 'top' ? r.y + Math.min(120, r.h * 0.2) : at === 'bottom' ? r.y + r.h - Math.min(120, r.h * 0.2) : r.y + r.h / 2
  if (c.handle === 'knob') return <circle cx={x} cy={y} r={12} fill={ink.line} pointerEvents="none" />
  const len = horizontal ? Math.min(r.w * 0.4, 200) : Math.min(r.h * 0.3, 160)
  return horizontal
    ? line(x - len / 2, y, x + len / 2, y, { stroke: ink.line, strokeWidth: 3, strokeLinecap: 'round', pointerEvents: 'none' })
    : line(x, y - len / 2, x, y + len / 2, { stroke: ink.line, strokeWidth: 3, strokeLinecap: 'round', pointerEvents: 'none' })
}

/** A door leaf with its opening lines: they meet at the hinge side. */
function Leaf({ c, r, hinge, at, ink }: { c: Cabinet; r: Rect; hinge: 'left' | 'right' | 'top'; at: HandleAt; ink: Ink }) {
  const dash = { stroke: ink.faint, strokeWidth: 0.8, strokeDasharray: '6 4', pointerEvents: 'none' }
  return (
    <>
      {hinge === 'left' && (
        <>
          {line(r.x + r.w, r.y, r.x, r.y + r.h / 2, dash)}
          {line(r.x + r.w, r.y + r.h, r.x, r.y + r.h / 2, dash)}
        </>
      )}
      {hinge === 'right' && (
        <>
          {line(r.x, r.y, r.x + r.w, r.y + r.h / 2, dash)}
          {line(r.x, r.y + r.h, r.x + r.w, r.y + r.h / 2, dash)}
        </>
      )}
      {hinge === 'top' && (
        <>
          {line(r.x, r.y + r.h, r.x + r.w / 2, r.y, dash)}
          {line(r.x + r.w, r.y + r.h, r.x + r.w / 2, r.y, dash)}
        </>
      )}
      <Handle
        c={c}
        r={r}
        side={hinge === 'left' ? 'right' : hinge === 'right' ? 'left' : 'centre'}
        at={hinge === 'top' ? 'bottom' : at}
        horizontal={hinge === 'top'}
        ink={ink}
      />
    </>
  )
}

/** One compartment's front (and, with `inside`, what's behind its doors). */
function CellFront({ c, laid, k, inside }: { c: Cabinet; laid: LaidCell; k: number; inside: boolean }) {
  const { cell } = laid
  const r = inset(laid.rect)
  const at: HandleAt = c.kind === 'wall' ? 'bottom' : c.kind === 'base' || c.kind === 'vanity' ? 'top' : 'middle'
  // Lines on the fronts, and on the carcass inside, that show up on their finish.
  const ink = inkOn(c.fronts.color)
  const inner = inkOn(c.carcass.color)
  const front = { fill: c.fronts.color, stroke: ink.line, strokeWidth: 1, vectorEffect: 'non-scaling-stroke' as const }
  const label = (text: string) =>
    r.w * k > 50 && r.h * k > 18 ? (
      <text x={r.x + r.w / 2} y={r.y + r.h / 2} fontSize={11 / k} textAnchor="middle" dominantBaseline="middle" fill={INK} pointerEvents="none">
        {text}
      </text>
    ) : null

  if (cell.front === 'drawers') {
    const n = Math.max(1, cell.drawers)
    const h = laid.rect.h / n
    return (
      <>
        {Array.from({ length: n }, (_, i) => {
          const d = inset({ x: laid.rect.x, y: laid.rect.y + i * h, w: laid.rect.w, h })
          return (
            <g key={i}>
              <rect x={d.x} y={d.y} width={d.w} height={d.h} {...front} />
              <Handle c={c} r={d} side="centre" at={h > 400 ? 'top' : 'middle'} horizontal ink={ink} />
            </g>
          )
        })}
      </>
    )
  }
  if (cell.front === 'appliance')
    return (
      <>
        <rect x={r.x} y={r.y} width={r.w} height={r.h} fill="#e5e7eb" stroke={INK} strokeWidth={1} vectorEffect="non-scaling-stroke" />
        {line(r.x, r.y, r.x + r.w, r.y + r.h, { stroke: '#cbd5e1', strokeWidth: 0.8, pointerEvents: 'none' })}
        {line(r.x + r.w, r.y, r.x, r.y + r.h, { stroke: '#cbd5e1', strokeWidth: 0.8, pointerEvents: 'none' })}
        {label(APPLIANCE_LABEL[cell.appliance])}
      </>
    )
  if (cell.front === 'panel') return <rect x={r.x} y={r.y} width={r.w} height={r.h} {...front} />
  if (cell.front === 'open')
    return (
      <>
        <rect x={r.x} y={r.y} width={r.w} height={r.h} fill={c.carcass.color} stroke={inner.line} strokeWidth={1} vectorEffect="non-scaling-stroke" />
        <rect x={r.x} y={r.y} width={r.w} height={r.h} fill="#000" fillOpacity={0.07} pointerEvents="none" />
        <Inside r={r} shelves={cell.shelves} rail={cell.rail} k={k} ink={inner} />
      </>
    )

  // Doors, and a fixed panel beside them
  const space = doorSpace(cell, laid.rect)
  const fixed = space.fixed && inset(space.fixed)
  const d = inset(space.doors)
  const leaves = doorLeaves(cell, space.doors.w)
  const lw = d.w / leaves
  const leafRects = Array.from({ length: leaves }, (_, i) => ({ x: d.x + i * lw, y: d.y, w: lw, h: d.h }))
  const behind = insideSpace(cell, laid.rect)
  return (
    <>
      {inside && (
        <>
          <rect x={r.x} y={r.y} width={r.w} height={r.h} fill={c.carcass.color} />
          <rect x={r.x} y={r.y} width={r.w} height={r.h} fill="#000" fillOpacity={0.07} />
          <Inside r={inset(behind.above)} shelves={cell.shelves} rail={cell.rail} k={k} ink={inner} />
          {behind.drawers && <InsideDrawers r={inset(behind.drawers)} n={behind.n} fill={c.carcass.color} ink={inner} />}
        </>
      )}
      {fixed && <rect x={fixed.x} y={fixed.y} width={fixed.w} height={fixed.h} {...front} opacity={inside ? 0.45 : 1} />}
      {leafRects.map((lr, i) => {
        const g = inset(lr, leaves > 1 ? GAP / 2 : 0)
        const hinge = cell.hinge === 'lift' ? 'top' : cell.hinge === 'pair' || cell.hinge === 'sliding' ? (i === 0 ? 'left' : 'right') : cell.hinge
        return (
          <g key={i} opacity={inside ? 0.45 : 1}>
            <rect x={g.x} y={g.y} width={g.w} height={g.h} {...front} />
            {cell.hinge === 'sliding' ? (
              <>
                {r.w * k > 60 && (
                  <text x={g.x + g.w / 2} y={g.y + g.h / 2} fontSize={14 / k} textAnchor="middle" dominantBaseline="middle" fill={ink.faint} pointerEvents="none">
                    {i === 0 ? '→' : '←'}
                  </text>
                )}
                <Handle c={c} r={g} side={i === 0 ? 'right' : 'left'} at="middle" ink={ink} />
              </>
            ) : (
              <Leaf c={c} r={g} hinge={hinge as 'left' | 'right' | 'top'} at={at} ink={ink} />
            )}
          </g>
        )
      })}
    </>
  )
}

export interface CellRef {
  leg: number
  path: number[]
}

/** A dimension along x at height y, with its length in the middle. */
function DimX({ x1, x2, y, k, text }: { x1: number; x2: number; y: number; k: number; text: string }) {
  const t = 4 / k
  return (
    <g pointerEvents="none">
      {line(x1, y, x2, y, { stroke: MUTED, strokeWidth: 0.8 })}
      {line(x1, y - t, x1, y + t, { stroke: MUTED, strokeWidth: 0.8 })}
      {line(x2, y - t, x2, y + t, { stroke: MUTED, strokeWidth: 0.8 })}
      {(x2 - x1) * k > 26 && (
        <text x={(x1 + x2) / 2} y={y - 3 / k} fontSize={10 / k} textAnchor="middle" fill={INK}>
          {text}
        </text>
      )}
    </g>
  )
}

/** A dimension along y at x, its length to the right. */
function DimY({ y1, y2, x, k, text }: { y1: number; y2: number; x: number; k: number; text: string }) {
  const t = 4 / k
  return (
    <g pointerEvents="none">
      {line(x, y1, x, y2, { stroke: MUTED, strokeWidth: 0.8 })}
      {line(x - t, y1, x + t, y1, { stroke: MUTED, strokeWidth: 0.8 })}
      {line(x - t, y2, x + t, y2, { stroke: MUTED, strokeWidth: 0.8 })}
      {Math.abs(y2 - y1) * k > 12 && (
        <text x={x + 6 / k} y={(y1 + y2) / 2} fontSize={10 / k} dominantBaseline="middle" fill={INK}>
          {text}
        </text>
      )}
    </g>
  )
}

const mm = (n: number) => Math.round(n).toLocaleString()

/**
 * The cabinet from the front, its legs unfolded side by side (left to right as you face them). Floor at
 * y = 0, up is negative. Tap a compartment to select it; drag a divider to resize the parts either side.
 */
export function Elevation({
  cabinet: c,
  placement: p,
  selected = null,
  onSelect,
  onChangeLeg,
  inside = false,
  dims = true,
  captions = true,
  className = 'cab-drawing',
}: {
  cabinet: Cabinet
  placement: Placement
  selected?: CellRef | null
  onSelect?: (s: CellRef | null) => void
  onChangeLeg?: (leg: number, front: CabinetSection) => void
  inside?: boolean
  /** sizes along the bottom and up the right */
  dims?: boolean
  /** each leg's wall over it, and "corner" between legs */
  captions?: boolean
  className?: string
}) {
  const [ref, screen] = useBoxSize<HTMLDivElement>()
  const svgRef = useRef<SVGSVGElement>(null)
  const drag = useRef<{ leg: number; d: LaidDivider; sizes: number[]; root: CabinetSection; x: number; y: number; k: number } | null>(null)

  const legs = p.legs.map((leg, i) => ({ leg, front: c.legs[i] }))
  let x = 0
  const placed = legs.map(({ leg, front }, i) => {
    const w = Math.max(0, leg.width)
    const at = x
    x += w + LEG_GAP
    return { i, leg, front, x: at, w, laid: front ? layOut(front, { x: 0, y: 0, w, h: c.height }) : null }
  })
  const total = Math.max(1, x - LEG_GAP)
  const carcassTop = -(c.bottom + c.height)
  const stone = c.top?.thickness ?? 0
  const upstand = c.top?.upstand ?? 0
  const top = carcassTop - stone - upstand
  const content: Box = { minX: 0, minY: Math.min(top, carcassTop - (c.top?.cutouts.some((x) => x.kind === 'hob') ? 40 : 0)), w: total, h: 0 }
  content.h = -content.minY
  const ready = screen.w > 0 && screen.h > 0
  const { k, viewBox } = ready
    ? fitView(content, screen, { l: 12, r: dims ? 112 : 12, t: captions ? 26 : 8, b: dims ? 46 : 10 })
    : { k: 1, viewBox: `0 ${content.minY} ${total} ${content.h}` }
  const fs = 11 / k

  const startDrag = (e: ReactPointerEvent, leg: number, d: LaidDivider, sizes: number[], root: CabinetSection) => {
    if (!onChangeLeg) return
    e.stopPropagation()
    ;(e.target as Element).setPointerCapture(e.pointerId)
    drag.current = { leg, d, sizes, root, x: e.clientX, y: e.clientY, k: svgRef.current?.getScreenCTM()?.a ?? k }
  }
  const moveDrag = (e: ReactPointerEvent) => {
    const g = drag.current
    if (!g || !onChangeLeg) return
    const delta = (g.d.split === 'across' ? e.clientX - g.x : e.clientY - g.y) / g.k
    onChangeLeg(g.leg, moveDivider(g.root, g.d, g.sizes, Math.round(delta / 5) * 5))
  }
  const endDrag = () => {
    drag.current = null
  }

  return (
    <div ref={ref} className={className}>
      <svg
        ref={svgRef}
        viewBox={viewBox}
        width="100%"
        height="100%"
        onPointerMove={moveDrag}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onClick={() => onSelect?.(null)}
      >
        {/* floor */}
        {line(-40 / k, 0, total + 40 / k, 0, { stroke: INK, strokeWidth: 1.5 })}
        {placed.map(({ i, leg, x: lx, w, laid }) => {
          const y0 = carcassTop
          return (
            <g key={i} transform={`translate(${lx} 0)`}>
              {captions && w * k > 44 && (
                <text x={w / 2} y={top - 10 / k} fontSize={fs} textAnchor="middle" fill={MUTED}>
                  Wall {leg.wallNo}
                </text>
              )}
              {/* upstand and top */}
              {c.top && upstand > 0 && (
                <rect x={0} y={carcassTop - stone - upstand} width={w} height={upstand} fill={c.top.finish.color} fillOpacity={0.6} stroke={INK} strokeWidth={0.6} vectorEffect="non-scaling-stroke" />
              )}
              {c.top && (
                <rect x={0} y={carcassTop - stone} width={w} height={stone} fill={c.top.finish.color} stroke={INK} strokeWidth={1} vectorEffect="non-scaling-stroke" />
              )}
              {/* under the carcass */}
              {c.mount === 'plinth' && c.bottom > 0 && (
                <rect x={30} y={-c.bottom} width={Math.max(0, w - 60)} height={c.bottom} fill={INK} fillOpacity={0.55} />
              )}
              {c.mount === 'legs' && c.bottom > 0 && (
                <>
                  <rect x={40} y={-c.bottom} width={30} height={c.bottom} fill={INK} />
                  <rect x={w - 70} y={-c.bottom} width={30} height={c.bottom} fill={INK} />
                </>
              )}
              {/* carcass */}
              <rect x={0} y={y0} width={w} height={c.height} fill={c.carcass.color} stroke={INK} strokeWidth={1.2} vectorEffect="non-scaling-stroke" />
              <g transform={`translate(0 ${y0})`}>
                {laid?.cells.map((l) => {
                  const on = samePath(selected?.leg === i ? selected.path : null, l.path)
                  return (
                    <g
                      key={l.path.join('.')}
                      onClick={(e) => {
                        if (!onSelect) return
                        e.stopPropagation()
                        onSelect({ leg: i, path: l.path })
                      }}
                      style={onSelect ? { cursor: 'pointer' } : undefined}
                    >
                      <CellFront c={c} laid={l} k={k} inside={inside} />
                      {on && (
                        <rect
                          x={l.rect.x}
                          y={l.rect.y}
                          width={l.rect.w}
                          height={l.rect.h}
                          fill={ACCENT}
                          fillOpacity={0.12}
                          stroke={ACCENT}
                          strokeWidth={3}
                          vectorEffect="non-scaling-stroke"
                          pointerEvents="none"
                        />
                      )}
                    </g>
                  )
                })}
                {onChangeLeg &&
                  laid?.dividers.map((d) => {
                    const sizes = laid.splits.find((s) => samePath(s.path, d.path))?.sizes ?? []
                    const hit = 7 / k
                    const r =
                      d.split === 'across'
                        ? { x: d.at - hit, y: d.rect.y, width: 2 * hit, height: d.rect.h }
                        : { x: d.rect.x, y: d.at - hit, width: d.rect.w, height: 2 * hit }
                    return (
                      <rect
                        key={`${d.path.join('.')}:${d.index}`}
                        {...r}
                        className="cab-divider"
                        style={{ cursor: d.split === 'across' ? 'ew-resize' : 'ns-resize' }}
                        onPointerDown={(e) => startDrag(e, i, d, sizes, c.legs[i])}
                        onClick={(e) => e.stopPropagation()}
                      />
                    )
                  })}
              </g>
              {/* cut-outs in the top */}
              {c.top?.cutouts
                .filter((x) => x.leg === i)
                .map((x) =>
                  x.kind === 'hob' ? (
                    <g key={x.id} pointerEvents="none">
                      <rect x={x.x - x.width / 2} y={carcassTop - stone - 14} width={x.width} height={14} fill={INK} />
                      <text x={x.x} y={carcassTop - stone - 22} fontSize={10 / k} textAnchor="middle" fill={INK}>
                        Hob
                      </text>
                    </g>
                  ) : (
                    <g key={x.id} pointerEvents="none">
                      <path
                        d={`M${x.x - x.width / 2} ${carcassTop - stone} v${BOWL + stone} h${x.width} v${-(BOWL + stone)}`}
                        fill="#fff"
                        fillOpacity={0.5}
                        stroke={INK}
                        strokeWidth={1}
                        strokeDasharray="5 3"
                        vectorEffect="non-scaling-stroke"
                      />
                      {x.width * k > 30 && (
                        <text x={x.x} y={carcassTop + BOWL / 2} fontSize={10 / k} textAnchor="middle" dominantBaseline="middle" fill={INK}>
                          {CUTOUT_LABEL[x.kind]}
                        </text>
                      )}
                    </g>
                  ),
                )}
              {/* widths below the floor */}
              {dims && laid && (
                <>
                  {laid.splits[0] && laid.splits[0].path.length === 0 && laid.splits[0].split === 'across' ? (
                    (() => {
                      let at = 0
                      return laid.splits[0].sizes.map((s, j) => {
                        const x1 = at
                        at += s
                        return <DimX key={j} x1={x1} x2={at} y={18 / k} k={k} text={mm(s)} />
                      })
                    })()
                  ) : null}
                  <DimX x1={0} x2={w} y={38 / k} k={k} text={mm(w)} />
                </>
              )}
            </g>
          )
        })}
        {/* corners between legs */}
        {placed.slice(1).map(({ i, x: lx }) => (
          <g key={`corner${i}`} pointerEvents="none">
            {line(lx - LEG_GAP / 2, 0, lx - LEG_GAP / 2, top, { stroke: MUTED, strokeWidth: 1, strokeDasharray: '10 4 2 4' })}
            {captions && LEG_GAP * k > 44 && (
              <text x={lx - LEG_GAP / 2} y={top - 10 / k} fontSize={10 / k} textAnchor="middle" fill={MUTED}>
                corner
              </text>
            )}
          </g>
        ))}
        {/* heights at the right */}
        {dims && (
          <g>
            {c.bottom > 0 && <DimY y1={0} y2={-c.bottom} x={total + 16 / k} k={k} text={mm(c.bottom)} />}
            <DimY y1={-c.bottom} y2={carcassTop} x={total + 16 / k} k={k} text={mm(c.height)} />
            {stone > 0 && <DimY y1={carcassTop} y2={carcassTop - stone} x={total + 16 / k} k={k} text={mm(stone)} />}
            <DimY y1={0} y2={-cabinetTop(c)} x={total + 64 / k} k={k} text={mm(cabinetTop(c))} />
          </g>
        )}
      </svg>
    </div>
  )
}

/** Turn plan points so the first leg's wall runs left to right along the top, the room below it. */
function turner(p: Placement) {
  const d = p.legs[0].dir
  const o = p.legs[0].origin
  // Rotate by -angle(d): d goes to +x, and the room (on its right on screen) stays below.
  return (q: Vec2): Vec2 => {
    const x = q.x - o.x
    const y = q.y - o.y
    return { x: x * d.x + y * d.y, y: -x * d.y + y * d.x }
  }
}

const pts = (ps: Vec2[]) => ps.map((q) => `${q.x},${q.y}`).join(' ')

/** The cabinet from above, with its walls, top and cut-outs; the first wall along the top. */
export function TopView({ cabinet: c, placement: p, className = 'cab-drawing' }: { cabinet: Cabinet; placement: Placement; className?: string }) {
  const [ref, screen] = useBoxSize<HTMLDivElement>()
  const turn = turner(p)
  const D = c.depth
  const stoneDepth = c.top ? D + c.top.overhang : D
  const WALL_T = 120
  const walls = p.legs.map((leg) =>
    [legPoint(leg, 0), legPoint(leg, leg.wallLength), legPoint(leg, leg.wallLength, -WALL_T), legPoint(leg, 0, -WALL_T)].map(turn),
  )
  const carcass = outline(p, D).map(turn)
  const stone = c.top ? outline(p, stoneDepth).map(turn) : null
  // Dashed lines are drawn over the stone, else the fronts (a wall cabinet's outline only).
  const onTop = c.top ? inkOn(c.top.finish.color) : c.kind === 'wall' ? DARK_INK : inkOn(c.fronts.color)
  const cutouts = (c.top?.cutouts ?? []).flatMap((x) => {
    const leg = p.legs[x.leg]
    if (!leg) return []
    const u = leg.from + leg.cornerLeft + x.x
    const v = stoneDepth / 2
    const corners = [
      legPoint(leg, u - x.width / 2, v - x.depth / 2),
      legPoint(leg, u + x.width / 2, v - x.depth / 2),
      legPoint(leg, u + x.width / 2, v + x.depth / 2),
      legPoint(leg, u - x.width / 2, v + x.depth / 2),
    ].map(turn)
    return [{ x, corners, centre: turn(legPoint(leg, u, v)) }]
  })
  // Where each leg after a corner starts: the corner is built into the leg before it.
  const seams = p.legs.slice(1).map((leg) => [legPoint(leg, leg.cornerLeft), legPoint(leg, leg.cornerLeft, D)].map(turn))
  // Each leg's length along its wall, written outside the wall and turned to run along it (kept upright).
  const lengths = p.legs.map((leg) => {
    const a = turn(legPoint(leg, 0))
    const b2 = turn(legPoint(leg, 1))
    const deg = (Math.atan2(b2.y - a.y, b2.x - a.x) * 180) / Math.PI
    return { at: turn(legPoint(leg, (leg.from + leg.to) / 2, -WALL_T)), text: mm(leg.to - leg.from), deg: deg > 90 || deg < -90 ? deg + 180 : deg }
  })
  const b = bbox([...walls.flat(), ...(stone ?? carcass)])
  const content: Box = { minX: b.minX, minY: b.minY, w: Math.max(1, b.w), h: Math.max(1, b.h) }
  const ready = screen.w > 0 && screen.h > 0
  const { k, viewBox } = ready ? fitView(content, screen, { l: 30, r: 30, t: 30, b: 16 }) : { k: 1, viewBox: `${b.minX} ${b.minY} ${b.w} ${b.h}` }
  return (
    <div ref={ref} className={className}>
      <svg viewBox={viewBox} width="100%" height="100%">
        {walls.map((w, i) => (
          <polygon key={i} points={pts(w)} fill={INK} />
        ))}
        <polygon
          points={pts(carcass)}
          fill={c.kind === 'wall' ? 'none' : c.fronts.color}
          stroke={INK}
          strokeWidth={1}
          strokeDasharray={c.kind === 'wall' ? '6 4' : undefined}
          vectorEffect="non-scaling-stroke"
        />
        {stone && <polygon points={pts(stone)} fill={c.top!.finish.color} stroke={INK} strokeWidth={1.2} vectorEffect="non-scaling-stroke" />}
        {stone && <polygon points={pts(carcass)} fill="none" stroke={onTop.faint} strokeWidth={0.8} strokeDasharray="4 3" vectorEffect="non-scaling-stroke" />}
        {seams.map(([a, b2], i) => (
          <line key={i} x1={a.x} y1={a.y} x2={b2.x} y2={b2.y} stroke={onTop.faint} strokeWidth={0.8} strokeDasharray="4 3" vectorEffect="non-scaling-stroke" />
        ))}
        {cutouts.map(({ x, corners, centre }) => (
          <g key={x.id}>
            <polygon points={pts(corners)} fill="#fff" stroke={INK} strokeWidth={1} strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
            <text x={centre.x} y={centre.y} fontSize={10 / k} textAnchor="middle" dominantBaseline="middle" fill={INK}>
              {CUTOUT_LABEL[x.kind]}
            </text>
          </g>
        ))}
        {lengths.map((l, i) => (
          <text key={i} x={l.at.x} y={l.at.y} fontSize={10 / k} textAnchor="middle" fill={INK} transform={`rotate(${l.deg} ${l.at.x} ${l.at.y}) translate(0 ${-6 / k})`}>
            {l.text}
          </text>
        ))}
      </svg>
    </div>
  )
}
