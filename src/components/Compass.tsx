import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from 'react'
import { normDeg } from '../geometry/facing'

/** Whole degrees, pulled onto 45° steps when within 2° (plans are mostly square to north). */
function snap(deg: number) {
  const step = Math.round(deg / 45) * 45
  return normDeg(Math.abs(deg - step) < 2 ? step : Math.round(deg))
}

/** Pointer angle around the element's centre, clockwise from straight up. */
function angleAt(el: Element, e: { clientX: number; clientY: number }) {
  const r = el.getBoundingClientRect()
  return (Math.atan2(e.clientX - (r.left + r.width / 2), -(e.clientY - (r.top + r.height / 2))) * 180) / Math.PI
}

const TICKS = Array.from({ length: 72 }, (_, i) => i * 5)
const LABELS = [
  { deg: 0, text: 'N' },
  { deg: 90, text: 'E' },
  { deg: 180, text: 'S' },
  { deg: 270, text: 'W' },
]

/**
 * A compass card over the plan: grab the ring and turn it until the red needle
 * matches the plan's north arrow. The middle stays see-through and lets the plan pan.
 */
export function CompassDial({ value, onChange }: { value: number | null; onChange: (deg: number) => void }) {
  const svgRef = useRef<SVGSVGElement>(null)
  const turn = useRef<{ from: number; start: number } | null>(null)
  const deg = value ?? 0

  const onDown = (e: ReactPointerEvent<SVGCircleElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId)
    turn.current = { from: angleAt(svgRef.current!, e), start: deg }
  }
  const onMove = (e: ReactPointerEvent<SVGCircleElement>) => {
    const t = turn.current
    if (t) onChange(snap(t.start + angleAt(svgRef.current!, e) - t.from))
  }
  const onUp = () => (turn.current = null)

  return (
    <div className="compass-dial">
      <svg
        ref={svgRef}
        viewBox="-100 -100 200 200"
        tabIndex={0}
        role="slider"
        aria-label="North direction"
        aria-valuemin={0}
        aria-valuemax={359}
        aria-valuenow={Math.round(deg)}
        aria-valuetext={`${Math.round(deg)}° clockwise from the top`}
        onKeyDown={(e) => {
          const d = e.key === 'ArrowRight' || e.key === 'ArrowUp' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowDown' ? -1 : 0
          if (!d) return
          e.preventDefault()
          onChange(normDeg(Math.round(deg) + d * (e.shiftKey ? 15 : 1)))
        }}
      >
        <g transform={`rotate(${deg})`} className={value == null ? 'unset' : undefined}>
          <circle r={84} className="dial-band" />
          {TICKS.map((t) => (
            <line
              key={t}
              x1={0}
              y1={-94}
              x2={0}
              y2={t % 45 === 0 ? -82 : t % 15 === 0 ? -86 : -90}
              transform={`rotate(${t})`}
              className={t % 45 === 0 ? 'dial-tick major' : 'dial-tick'}
            />
          ))}
          {LABELS.map((l) => (
            // Placed round the card but kept upright so they stay readable.
            <text
              key={l.text}
              transform={`rotate(${l.deg}) translate(0 -64) rotate(${-(deg + l.deg)})`}
              className={l.deg === 0 ? 'dial-label north' : 'dial-label'}
            >
              {l.text}
            </text>
          ))}
          <line x1={0} y1={56} x2={0} y2={-48} className="dial-needle south" />
          <line x1={0} y1={0} x2={0} y2={-48} className="dial-needle" />
          <path d="M 0 -58 L -7 -44 L 7 -44 Z" className="dial-arrow" />
          <circle r={3} className="dial-hub" />
        </g>
        <circle
          r={84}
          className="dial-grip"
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={onUp}
        />
      </svg>
      <div className="dial-hint">{value == null ? 'Turn the ring to set north' : `${Math.round(deg)}°`}</div>
    </div>
  )
}

/**
 * Small north arrow for a view's corner; `needle` lets a 3D view turn it as the camera orbits,
 * and `turn` is a 2D view's rotation, so the needle still points north on screen.
 */
export function CompassBadge({
  north,
  onClick,
  needle,
  turn = 0,
}: {
  north: number | null
  onClick?: () => void
  needle?: RefObject<SVGGElement | null>
  turn?: number
}) {
  const rose = (
    <svg viewBox="-22 -22 44 44" aria-hidden>
      {north == null ? (
        <text y={4} className="badge-n unset">
          N?
        </text>
      ) : (
        <g ref={needle} transform={`rotate(${north + turn})`}>
          <path d="M 0 -6 L 6 14 L 0 10 L -6 14 Z" className="badge-arrow" />
          <text y={-9} className="badge-n">
            N
          </text>
        </g>
      )}
    </svg>
  )
  const title = north == null ? 'Set north' : `North: ${Math.round(north)}° clockwise from the top of the plan`
  return onClick ? (
    <button className="compass-badge" title={title} aria-label={title} onClick={onClick}>
      {rose}
    </button>
  ) : (
    <div className="compass-badge" title={title}>
      {rose}
    </div>
  )
}

/** Degrees typed in directly, e.g. a bearing taken from a map. */
export function DegreeInput({ value, onChange }: { value: number | null; onChange: (deg: number | null) => void }) {
  const show = (v: number | null) => (v == null ? '' : String(Math.round(v)))
  const [text, setText] = useState(show(value))
  const focused = useRef(false)
  useEffect(() => {
    if (!focused.current) setText(show(value))
  }, [value])
  return (
    <input
      className="deg-input"
      inputMode="numeric"
      value={text}
      placeholder="—"
      onFocus={(e) => {
        focused.current = true
        e.target.select()
      }}
      onBlur={() => {
        focused.current = false
        setText(show(value))
      }}
      onChange={(e) => {
        setText(e.target.value)
        const v = parseFloat(e.target.value)
        if (e.target.value.trim() === '') onChange(null)
        else if (Number.isFinite(v)) onChange(normDeg(v))
      }}
    />
  )
}
