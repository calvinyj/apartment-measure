import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { normDeg } from '../geometry/facing'
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
  /** false hides the image but keeps the view framed as if it were there */
  showImage?: boolean
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
  /** view rotation in degrees, clockwise on screen */
  rotation?: number
  /** lets the user turn the view: two-finger twist, or drag with the right mouse button (or Shift) */
  onRotate?: (deg: number) => void
  children?: (k: number, rotation: number) => ReactNode
  /** floats over the plan, e.g. a legend; an element in it marked `data-fit-clear` on the left is kept clear when fitting */
  overlay?: ReactNode
}

interface View {
  k: number
  tx: number
  ty: number
  /** rotation, degrees clockwise */
  a: number
}

type Gesture =
  | { type: 'idle' }
  | { type: 'press'; x: number; y: number; handle: string | null; dragging: boolean }
  | { type: 'pan'; x: number; y: number; view: View }
  | { type: 'pinch'; dist: number; angle: number; mid: Vec2; view: View }
  | { type: 'turn'; from: number; view: View }

const TAP_SLOP = 6
const RAD = Math.PI / 180

const clampK = (k: number) => Math.min(40, Math.max(0.05, k))

/** Pulled square when within a few degrees of a quarter turn (plans are drawn square). */
const snapTurn = (deg: number) => {
  const q = Math.round(deg / 90) * 90
  return normDeg(Math.abs(deg - q) < 4 ? q : deg)
}

/** The plan point under screen point s. */
function planAt(v: View, s: Vec2): Vec2 {
  const x = (s.x - v.tx) / v.k
  const y = (s.y - v.ty) / v.k
  const c = Math.cos(v.a * RAD)
  const sn = Math.sin(v.a * RAD)
  return { x: x * c + y * sn, y: y * c - x * sn }
}

/** The view at scale k and rotation a that puts plan point p under screen point s. */
function place(p: Vec2, s: Vec2, k: number, a: number): View {
  const c = Math.cos(a * RAD)
  const sn = Math.sin(a * RAD)
  return { k, a, tx: s.x - k * (p.x * c - p.y * sn), ty: s.y - k * (p.x * sn + p.y * c) }
}

export function PlanView({
  image,
  showImage = true,
  fit,
  fitKey,
  cursor,
  onTap,
  onHover,
  onHandleDown,
  onDrag,
  onDragEnd,
  rotation = 0,
  onRotate,
  children,
  overlay,
}: Props) {
  const svgRef = useRef<SVGSVGElement>(null)
  const [view, setView] = useState<View>({ k: 1, tx: 0, ty: 0, a: 0 })
  const viewRef = useRef(view)
  viewRef.current = view
  const pointers = useRef(new Map<number, Vec2>())
  const gesture = useRef<Gesture>({ type: 'idle' })
  const userMoved = useRef(false)

  // Kept in step straight away so back-to-back changes in one event build on each other.
  const commit = (v: View) => {
    viewRef.current = v
    setView(v)
  }

  const centre = (): Vec2 => {
    const r = svgRef.current!.getBoundingClientRect()
    return { x: r.width / 2, y: r.height / 2 }
  }

  const doFit = useCallback(() => {
    const svg = svgRef.current
    if (!svg || !fit) return
    const { width, height } = svg.getBoundingClientRect()
    if (width === 0 || height === 0) return
    // Beside anything floating on the left (a legend), unless it takes too much of the width to leave room.
    const clear = svg.parentElement?.querySelector('[data-fit-clear]')?.getBoundingClientRect()
    const left = clear && clear.width < width * 0.35 ? clear.right - svg.getBoundingClientRect().left : 0
    // Fit the box as it lies once turned.
    const c = Math.abs(Math.cos(rotation * RAD))
    const sn = Math.abs(Math.sin(rotation * RAD))
    const k = Math.min((width - left) / (fit.w * c + fit.h * sn), height / (fit.w * sn + fit.h * c)) * 0.92
    const mid = { x: left + (width - left) / 2, y: height / 2 }
    commit(place({ x: fit.minX + fit.w / 2, y: fit.minY + fit.h / 2 }, mid, k, rotation))
    userMoved.current = false
  }, [fit?.minX, fit?.minY, fit?.w, fit?.h, rotation])

  // Rotation set from outside (a button): turn about the middle, or refit if the user hasn't moved the view.
  useLayoutEffect(() => {
    const v = viewRef.current
    if (v.a === rotation || !svgRef.current) return
    const c = centre()
    commit(place(planAt(v, c), c, v.k, rotation))
    if (!userMoved.current) doFit()
  }, [rotation])

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
  const toPlan = (s: Vec2): Vec2 => planAt(viewRef.current, s)
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
      userMoved.current = true
      commit(place(planAt(v, s), s, clampK(v.k * f), v.a))
    }
    svg.addEventListener('wheel', onWheel, { passive: false })
    return () => svg.removeEventListener('wheel', onWheel)
  }, [])

  const startPinch = () => {
    const [a, b] = [...pointers.current.values()]
    gesture.current = {
      type: 'pinch',
      dist: Math.hypot(a.x - b.x, a.y - b.y),
      angle: Math.atan2(b.y - a.y, b.x - a.x) / RAD,
      mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
      view: viewRef.current,
    }
  }

  /** Pointer angle around the middle of the view, degrees. */
  const angleAt = (s: Vec2) => {
    const c = centre()
    return Math.atan2(s.y - c.y, s.x - c.x) / RAD
  }

  const turnTo = (a: number) => {
    if (a === viewRef.current.a) return
    const c = centre()
    commit(place(planAt(viewRef.current, c), c, viewRef.current.k, a))
    onRotate?.(a)
  }

  const onPointerDown = (e: React.PointerEvent) => {
    const turning = onRotate != null && e.pointerType === 'mouse' && (e.button === 2 || (e.button === 0 && e.shiftKey))
    if (e.button !== 0 && e.pointerType === 'mouse' && !turning) return
    svgRef.current!.setPointerCapture(e.pointerId)
    const s = local(e.clientX, e.clientY)
    pointers.current.set(e.pointerId, s)
    if (turning) {
      gesture.current = { type: 'turn', from: angleAt(s), view: viewRef.current }
      return
    }
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
      const turn = onRotate ? snapTurn(g.view.a + Math.atan2(b.y - a.y, b.x - a.x) / RAD - g.angle) : g.view.a
      const turned = turn !== viewRef.current.a
      userMoved.current = true
      commit(place(planAt(g.view, g.mid), mid, clampK((g.view.k * d) / g.dist), turn))
      if (turned) onRotate?.(turn)
    } else if (g.type === 'turn') {
      userMoved.current = true
      turnTo(snapTurn(g.view.a + angleAt(s) - g.from))
    } else if (g.type === 'press') {
      if (g.dragging) {
        onDrag?.(toPlan(s), info(e, g.handle))
      } else if (Math.hypot(s.x - g.x, s.y - g.y) > TAP_SLOP) {
        gesture.current = { type: 'pan', x: g.x, y: g.y, view: viewRef.current }
      }
    } else if (g.type === 'pan') {
      userMoved.current = true
      commit({ ...g.view, tx: g.view.tx + s.x - g.x, ty: g.view.ty + s.y - g.y })
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

  const zoomBy = (f: number) => {
    const v = viewRef.current
    const c = centre()
    userMoved.current = true
    commit(place(planAt(v, c), c, clampK(v.k * f), v.a))
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
        onContextMenu={onRotate ? (e) => e.preventDefault() : undefined}
      >
        <g transform={`translate(${view.tx} ${view.ty}) rotate(${view.a}) scale(${view.k})`}>
          {image && showImage && <image href={image.src} width={image.width} height={image.height} style={{ opacity: 0.85 }} />}
          {children?.(view.k, view.a)}
        </g>
      </svg>
      {overlay}
      <div className="zoom-buttons">
        <button title="Zoom in" onClick={() => zoomBy(1.4)}>
          +
        </button>
        <button title="Zoom out" onClick={() => zoomBy(1 / 1.4)}>
          −
        </button>
        <button title="Fit" onClick={doFit}>
          ⤢
        </button>
      </div>
    </div>
  )
}
