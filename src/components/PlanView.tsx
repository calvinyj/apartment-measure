import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import type { Vec2 } from '../types'

export interface PointerInfo {
  shiftKey: boolean
  altKey: boolean
  pointerType: string
  /** value of the nearest [data-handle] under the pointer, if any */
  handle: string | null
}

export interface FitBox {
  minX: number
  minY: number
  w: number
  h: number
}

interface Props {
  image: { src: string; width: number; height: number } | null
  fit: FitBox | null
  /** refit whenever this changes */
  fitKey?: string
  cursor?: string
  onTap?: (p: Vec2, info: PointerInfo) => void
  onHover?: (p: Vec2 | null, info: PointerInfo) => void
  /** return true to drag this handle instead of panning */
  onHandleDown?: (handle: string) => boolean
  onDrag?: (p: Vec2, info: PointerInfo) => void
  onDragEnd?: () => void
  children?: (k: number) => ReactNode
}

interface View {
  k: number
  tx: number
  ty: number
}

type Gesture =
  | { type: 'idle' }
  | { type: 'press'; x: number; y: number; handle: string | null; dragging: boolean }
  | { type: 'pan'; x: number; y: number; view: View }
  | { type: 'pinch'; dist: number; mid: Vec2; view: View }

const TAP_SLOP = 6

export function PlanView({ image, fit, fitKey, cursor, onTap, onHover, onHandleDown, onDrag, onDragEnd, children }: Props) {
  const svgRef = useRef<SVGSVGElement>(null)
  const [view, setView] = useState<View>({ k: 1, tx: 0, ty: 0 })
  const viewRef = useRef(view)
  viewRef.current = view
  const pointers = useRef(new Map<number, Vec2>())
  const gesture = useRef<Gesture>({ type: 'idle' })
  const userMoved = useRef(false)

  const doFit = useCallback(() => {
    const svg = svgRef.current
    if (!svg || !fit) return
    const { width, height } = svg.getBoundingClientRect()
    if (width === 0 || height === 0) return
    const k = Math.min(width / fit.w, height / fit.h) * 0.92
    setView({ k, tx: (width - fit.w * k) / 2 - fit.minX * k, ty: (height - fit.h * k) / 2 - fit.minY * k })
    userMoved.current = false
  }, [fit?.minX, fit?.minY, fit?.w, fit?.h])

  useLayoutEffect(() => {
    doFit()
  }, [fitKey, image?.src])

  useEffect(() => {
    const svg = svgRef.current
    if (!svg) return
    const ro = new ResizeObserver(() => {
      if (!userMoved.current) doFit()
    })
    ro.observe(svg)
    return () => ro.disconnect()
  }, [doFit])

  const local = (clientX: number, clientY: number): Vec2 => {
    const r = svgRef.current!.getBoundingClientRect()
    return { x: clientX - r.left, y: clientY - r.top }
  }
  const toPlan = (s: Vec2): Vec2 => {
    const v = viewRef.current
    return { x: (s.x - v.tx) / v.k, y: (s.y - v.ty) / v.k }
  }
  const info = (e: React.PointerEvent | PointerEvent, handle: string | null = null): PointerInfo => ({
    shiftKey: e.shiftKey,
    altKey: e.altKey,
    pointerType: e.pointerType,
    handle,
  })

  // Wheel zoom needs a non-passive listener to stop the page scrolling.
  useEffect(() => {
    const svg = svgRef.current
    if (!svg) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const s = local(e.clientX, e.clientY)
      const v = viewRef.current
      const f = Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015))
      const k = Math.min(40, Math.max(0.05, v.k * f))
      const p = { x: (s.x - v.tx) / v.k, y: (s.y - v.ty) / v.k }
      userMoved.current = true
      setView({ k, tx: s.x - p.x * k, ty: s.y - p.y * k })
    }
    svg.addEventListener('wheel', onWheel, { passive: false })
    return () => svg.removeEventListener('wheel', onWheel)
  }, [])

  const startPinch = () => {
    const [a, b] = [...pointers.current.values()]
    gesture.current = {
      type: 'pinch',
      dist: Math.hypot(a.x - b.x, a.y - b.y),
      mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
      view: viewRef.current,
    }
  }

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return
    svgRef.current!.setPointerCapture(e.pointerId)
    const s = local(e.clientX, e.clientY)
    pointers.current.set(e.pointerId, s)
    if (pointers.current.size === 2) {
      if (gesture.current.type === 'press' && gesture.current.dragging) onDragEnd?.()
      startPinch()
      return
    }
    const el = (e.target as Element).closest('[data-handle]')
    const handle = el?.getAttribute('data-handle') ?? null
    const dragging = handle != null && (onHandleDown?.(handle) ?? false)
    gesture.current = { type: 'press', x: s.x, y: s.y, handle, dragging }
  }

  const onPointerMove = (e: React.PointerEvent) => {
    const s = local(e.clientX, e.clientY)
    if (!pointers.current.has(e.pointerId)) {
      if (e.pointerType === 'mouse') onHover?.(toPlan(s), info(e))
      return
    }
    pointers.current.set(e.pointerId, s)
    const g = gesture.current
    if (g.type === 'pinch' && pointers.current.size >= 2) {
      const [a, b] = [...pointers.current.values()]
      const d = Math.hypot(a.x - b.x, a.y - b.y)
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
      const k = Math.min(40, Math.max(0.05, (g.view.k * d) / g.dist))
      const p = { x: (g.mid.x - g.view.tx) / g.view.k, y: (g.mid.y - g.view.ty) / g.view.k }
      userMoved.current = true
      setView({ k, tx: mid.x - p.x * k, ty: mid.y - p.y * k })
    } else if (g.type === 'press') {
      if (g.dragging) {
        onDrag?.(toPlan(s), info(e, g.handle))
      } else if (Math.hypot(s.x - g.x, s.y - g.y) > TAP_SLOP) {
        gesture.current = { type: 'pan', x: g.x, y: g.y, view: viewRef.current }
      }
    } else if (g.type === 'pan') {
      userMoved.current = true
      setView({ ...g.view, tx: g.view.tx + s.x - g.x, ty: g.view.ty + s.y - g.y })
    }
    if (e.pointerType === 'mouse') onHover?.(toPlan(s), info(e))
  }

  const onPointerUp = (e: React.PointerEvent) => {
    const s = local(e.clientX, e.clientY)
    const g = gesture.current
    pointers.current.delete(e.pointerId)
    if (g.type === 'press') {
      if (g.dragging) onDragEnd?.()
      if (Math.hypot(s.x - g.x, s.y - g.y) <= TAP_SLOP) onTap?.(toPlan(s), info(e, g.handle))
    }
    if (pointers.current.size === 1 && g.type === 'pinch') {
      const [p] = [...pointers.current.values()]
      gesture.current = { type: 'pan', x: p.x, y: p.y, view: viewRef.current }
    } else if (pointers.current.size === 0) {
      gesture.current = { type: 'idle' }
    }
  }

  const onPointerCancel = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId)
    if (gesture.current.type === 'press' && gesture.current.dragging) onDragEnd?.()
    gesture.current = { type: 'idle' }
  }

  return (
    <div className="plan-view">
      <svg
        ref={svgRef}
        style={{ cursor: cursor ?? 'grab' }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        onPointerLeave={(e) => e.pointerType === 'mouse' && onHover?.(null, info(e))}
      >
        <g transform={`translate(${view.tx} ${view.ty}) scale(${view.k})`}>
          {image && <image href={image.src} width={image.width} height={image.height} style={{ opacity: 0.85 }} />}
          {children?.(view.k)}
        </g>
      </svg>
      <div className="zoom-buttons">
        <button
          title="Zoom in"
          onClick={() => {
            const r = svgRef.current!.getBoundingClientRect()
            const v = viewRef.current
            const c = { x: r.width / 2, y: r.height / 2 }
            const k = Math.min(40, v.k * 1.4)
            userMoved.current = true
            setView({ k, tx: c.x - ((c.x - v.tx) / v.k) * k, ty: c.y - ((c.y - v.ty) / v.k) * k })
          }}
        >
          +
        </button>
        <button
          title="Zoom out"
          onClick={() => {
            const r = svgRef.current!.getBoundingClientRect()
            const v = viewRef.current
            const c = { x: r.width / 2, y: r.height / 2 }
            const k = Math.max(0.05, v.k / 1.4)
            userMoved.current = true
            setView({ k, tx: c.x - ((c.x - v.tx) / v.k) * k, ty: c.y - ((c.y - v.ty) / v.k) * k })
          }}
        >
          −
        </button>
        <button title="Fit" onClick={doFit}>
          ⤢
        </button>
      </div>
    </div>
  )
}
