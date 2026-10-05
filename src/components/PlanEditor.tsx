import { useEffect, useMemo, useRef, useState } from 'react'
import { isSelfIntersecting, pointInPolygon, area as polyArea } from '../geometry/polygon'
import { snapPoint, type Snapped } from '../geometry/snap'
import { dist, lerp } from '../geometry/vec'
import { useStore } from '../store'
import { uploadPlanImage } from '../sync'
import { ROOM_TYPES, type Room, type RoomType, type Vec2 } from '../types'
import { formatLength } from '../units'
import { Field, LengthInput, Segmented, useSolved } from './common'
import { PlanView, type PointerInfo } from './PlanView'
import { RoomShapes } from './RoomShapes'

type Tool = 'select' | 'trace' | 'calibrate'

const snapRadius = (info: PointerInfo, k: number) => (info.pointerType === 'mouse' ? 10 : 22) / k

export function PlanEditor() {
  const project = useStore((s) => s.project)
  const selectedId = useStore((s) => s.selectedRoomId)
  const select = useStore((s) => s.select)
  const { addRoom, moveVertex, insertVertex, setCalibration } = useStore.getState()
  const solved = useSolved()

  const [tool, setTool] = useState<Tool>(project.calibration ? 'select' : 'calibrate')
  const [trace, setTrace] = useState<Vec2[]>([])
  const [hover, setHover] = useState<Snapped | null>(null)
  const [calib, setCalib] = useState<Vec2[]>([])
  const [calibMm, setCalibMm] = useState<number | null>(null)
  const [selVertex, setSelVertex] = useState<number | null>(null)
  const [snapOn, setSnapOn] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const kRef = useRef(1)
  const drag = useRef<{ roomId: string; index: number } | null>(null)

  const image = project.image
  const selected = project.rooms.find((r) => r.id === selectedId) ?? null

  const allVertices = useMemo(() => project.rooms.flatMap((r) => r.points), [project.rooms])

  const fit = image ? { minX: 0, minY: 0, w: image.width, h: image.height } : null

  const doSnap = (raw: Vec2, prev: Vec2 | null, info: PointerInfo, extra: Vec2[] = [], exclude?: Vec2): Snapped => {
    if (!snapOn || info.shiftKey || info.altKey) return { p: raw, onVertex: false }
    const verts = [...allVertices, ...extra].filter((v) => v !== exclude)
    return snapPoint(raw, prev, verts, snapRadius(info, kRef.current))
  }

  const finishTrace = (pts: Vec2[]) => {
    if (pts.length < 3) return
    if (isSelfIntersecting(pts)) {
      setError('That outline crosses itself. Undo a few corners and try again.')
      return
    }
    if (polyArea(pts) < 1) return
    const id = addRoom(pts, guessType(project.rooms.length))
    setTrace([])
    setHover(null)
    setTool('select')
    select(id)
    setError(null)
  }

  const onTap = (raw: Vec2, info: PointerInfo) => {
    setError(null)
    if (tool === 'trace') {
      if (trace.length >= 3 && dist(raw, trace[0]) < snapRadius(info, kRef.current)) {
        finishTrace(trace)
        return
      }
      const s = doSnap(raw, trace[trace.length - 1] ?? null, info, trace)
      setTrace([...trace, s.p])
      return
    }
    if (tool === 'calibrate') {
      if (calib.length >= 2) setCalib([raw])
      else setCalib([...calib, calib.length === 1 ? doSnap(raw, calib[0], info, [], undefined).p : raw])
      return
    }
    // select tool
    if (info.handle?.startsWith('v:')) {
      setSelVertex(Number(info.handle.slice(2)))
      return
    }
    if (info.handle?.startsWith('m:') && selected) {
      const i = Number(info.handle.slice(2))
      const a = selected.points[i]
      const b = selected.points[(i + 1) % selected.points.length]
      insertVertex(selected.id, i, lerp(a, b, 0.5))
      setSelVertex(i + 1)
      return
    }
    const hits = project.rooms.filter((r) => pointInPolygon(raw, r.points))
    hits.sort((a, b) => polyArea(a.points) - polyArea(b.points))
    select(hits[0]?.id ?? null)
    setSelVertex(null)
  }

  const onHover = (raw: Vec2 | null, info: PointerInfo) => {
    if (!raw || (tool !== 'trace' && tool !== 'calibrate')) {
      setHover(null)
      return
    }
    if (tool === 'trace') {
      if (trace.length >= 3 && dist(raw, trace[0]) < snapRadius(info, kRef.current)) {
        setHover({ p: trace[0], onVertex: true })
        return
      }
      setHover(doSnap(raw, trace[trace.length - 1] ?? null, info, trace))
    } else {
      setHover(calib.length === 1 ? doSnap(raw, calib[0], info) : { p: raw, onVertex: false })
    }
  }

  const onHandleDown = (handle: string) => {
    if (tool !== 'select' || !selected || !handle.startsWith('v:')) return false
    const index = Number(handle.slice(2))
    drag.current = { roomId: selected.id, index }
    setSelVertex(index)
    return true
  }

  const onDrag = (raw: Vec2, info: PointerInfo) => {
    const d = drag.current
    if (!d) return
    const room = project.rooms.find((r) => r.id === d.roomId)
    if (!room) return
    const others = project.rooms.filter((r) => r.id !== room.id).flatMap((r) => r.points)
    const own = room.points.filter((_, i) => i !== d.index)
    const s = !snapOn || info.shiftKey ? { p: raw } : snapPoint(raw, null, [...others, ...own], snapRadius(info, kRef.current))
    moveVertex(room.id, d.index, s.p)
  }

  // Keyboard shortcuts for desktop tracing.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest('input, select, textarea')) return
      if (tool === 'trace') {
        if (e.key === 'Escape') setTrace([])
        if (e.key === 'Enter') finishTrace(trace)
        if (e.key === 'Backspace') setTrace((t) => t.slice(0, -1))
      } else if (tool === 'select' && selected && selVertex != null && (e.key === 'Backspace' || e.key === 'Delete')) {
        useStore.getState().deleteVertex(selected.id, selVertex)
        setSelVertex(null)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const switchTool = (t: Tool) => {
    setTool(t)
    setTrace([])
    setHover(null)
    setError(null)
    if (t === 'calibrate') {
      setCalib(project.calibration ? [project.calibration.a, project.calibration.b] : [])
      setCalibMm(project.calibration?.mm ?? null)
    }
  }

  if (!image) return <NoImage />

  const cursor = tool === 'select' ? 'default' : 'crosshair'

  return (
    <div className="split">
      <div className="canvas-wrap">
        <PlanView
          image={image}
          fit={fit}
          fitKey={image.src}
          cursor={cursor}
          onTap={onTap}
          onHover={onHover}
          onHandleDown={onHandleDown}
          onDrag={onDrag}
          onDragEnd={() => (drag.current = null)}
        >
          {(k) => {
            kRef.current = k
            return (
              <>
                <RoomShapes rooms={project.rooms} solved={solved} k={k} selectedId={tool === 'select' ? selectedId : null} />
                {tool === 'select' && selected && <VertexHandles room={selected} k={k} selVertex={selVertex} />}
                {tool === 'trace' && <TraceOverlay points={trace} hover={hover} k={k} image={image} />}
                {tool === 'calibrate' && <CalibOverlay points={calib} hover={hover} k={k} mm={calibMm} />}
              </>
            )
          }}
        </PlanView>
        <div className="canvas-toolbar">
          <Segmented<Tool>
            value={tool}
            onChange={switchTool}
            options={[
              { value: 'select', label: 'Select' },
              { value: 'trace', label: 'Draw room' },
              { value: 'calibrate', label: 'Set scale' },
            ]}
          />
          <label className="check small">
            <input type="checkbox" checked={snapOn} onChange={(e) => setSnapOn(e.target.checked)} /> Snap
          </label>
        </div>
      </div>

      <aside className="panel">
        {error && <div className="callout warn">{error}</div>}
        {tool === 'calibrate' && (
          <CalibratePanel
            points={calib}
            mm={calibMm}
            setMm={setCalibMm}
            onSave={() => {
              if (calib.length === 2 && calibMm) {
                setCalibration({ a: calib[0], b: calib[1], mm: calibMm })
                switchTool(project.rooms.length ? 'select' : 'trace')
              }
            }}
            onClear={() => {
              setCalib([])
              setCalibration(null)
            }}
          />
        )}
        {tool === 'trace' && (
          <TracePanel
            count={trace.length}
            onUndo={() => setTrace(trace.slice(0, -1))}
            onFinish={() => finishTrace(trace)}
            onCancel={() => switchTool('select')}
          />
        )}
        {tool === 'select' &&
          (selected ? (
            <RoomInspector room={selected} selVertex={selVertex} clearVertex={() => setSelVertex(null)} />
          ) : (
            <PlanOverview onTool={switchTool} />
          ))}
      </aside>
    </div>
  )
}

/** Sensible default room type based on how many rooms exist so far. */
function guessType(existing: number): RoomType {
  return existing === 0 ? 'living' : 'bedroom'
}

function NoImage() {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const load = async (blob: Blob) => {
    setBusy(true)
    setErr(null)
    try {
      await uploadPlanImage(blob)
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="empty">
      <h2>Start with a floor plan</h2>
      <p>Upload a picture of the layout (a brochure image, screenshot, or photo taken straight on).</p>
      <label className="btn primary">
        {busy ? 'Loading…' : 'Choose image'}
        <input type="file" accept="image/*" hidden onChange={(e) => e.target.files?.[0] && load(e.target.files[0])} />
      </label>
      <button
        className="btn"
        onClick={async () => {
          const res = await fetch('./sample.jpg')
          load(await res.blob())
        }}
      >
        Use the sample plan
      </button>
      {err && <div className="callout warn">{err}</div>}
    </div>
  )
}

function PlanOverview({ onTool }: { onTool: (t: Tool) => void }) {
  const project = useStore((s) => s.project)
  const select = useStore((s) => s.select)
  const setTab = useStore((s) => s.setTab)
  const solved = useSolved()
  return (
    <div className="stack">
      <h2>Plan</h2>
      <ol className="steps">
        <li className={project.calibration ? 'done' : 'todo'}>
          <strong>Set the scale</strong>
          {solved.mmPerPx ? (
            <span> · 1 px = {solved.mmPerPx.toFixed(2)} mm</span>
          ) : (
            <span> · tap both ends of a known dimension</span>
          )}
          <button className="link" onClick={() => onTool('calibrate')}>
            {project.calibration ? 'Redo' : 'Start'}
          </button>
        </li>
        <li className={project.rooms.length ? 'done' : 'todo'}>
          <strong>Trace each room</strong> along its inside wall faces · {project.rooms.length} so far
          <button className="link" onClick={() => onTool('trace')}>
            Draw room
          </button>
        </li>
        <li className="todo">
          <strong>Measure on site</strong>
          <button className="link" onClick={() => setTab('measure')} disabled={!project.rooms.length || !project.calibration}>
            Go
          </button>
        </li>
      </ol>
      {project.rooms.length > 0 && (
        <ul className="room-list">
          {project.rooms.map((r) => (
            <li key={r.id}>
              <button onClick={() => select(r.id)}>
                <span>{r.name}</span>
                <span className="muted">{ROOM_TYPES.find((t) => t.value === r.type)?.label}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <p className="muted small">
        Tip: trace the <em>inside</em> face of the walls — the line you'd measure along with a tape. Rooms that share a
        wall should each be traced on their own side of it. Open-plan areas can be split with an “open” edge.
      </p>
    </div>
  )
}

function CalibratePanel({
  points,
  mm,
  setMm,
  onSave,
  onClear,
}: {
  points: Vec2[]
  mm: number | null
  setMm: (v: number | null) => void
  onSave: () => void
  onClear: () => void
}) {
  const unit = useStore((s) => s.project.settings.inputUnit)
  return (
    <div className="stack">
      <h2>Set the scale</h2>
      <p>
        Tap both ends of a dimension printed on the plan — the longest one is most accurate (e.g. the overall width line).
        Zoom in for precision.
      </p>
      <p className="muted">{points.length < 2 ? `Point ${points.length + 1} of 2` : 'Now enter the real length:'}</p>
      {points.length === 2 && (
        <>
          <Field label="Real length">
            <LengthInput value={mm} onChange={setMm} unit={unit} autoFocus onEnter={onSave} />
          </Field>
          <div className="row">
            <button className="btn primary" disabled={!mm} onClick={onSave}>
              Save scale
            </button>
            <button className="btn" onClick={onClear}>
              Clear
            </button>
          </div>
        </>
      )}
    </div>
  )
}

function TracePanel({
  count,
  onUndo,
  onFinish,
  onCancel,
}: {
  count: number
  onUndo: () => void
  onFinish: () => void
  onCancel: () => void
}) {
  return (
    <div className="stack">
      <h2>Draw a room</h2>
      <p>
        Tap each <strong>inside corner</strong> in order. Lines snap straight and line up with existing corners. Tap the
        first corner (or Finish) to close the room.
      </p>
      <p className="muted small">Desktop: Enter finishes, Backspace removes the last corner, hold Shift to place freely.</p>
      <p className="muted">{count} corner{count === 1 ? '' : 's'}</p>
      <div className="row">
        <button className="btn" onClick={onUndo} disabled={!count}>
          Undo corner
        </button>
        <button className="btn primary" onClick={onFinish} disabled={count < 3}>
          Finish
        </button>
        <button className="btn ghost" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  )
}

function RoomInspector({ room, selVertex, clearVertex }: { room: Room; selVertex: number | null; clearVertex: () => void }) {
  const { updateRoom, deleteRoom, updateEdge, deleteVertex, select, setTab, setWizard } = useStore.getState()
  const rooms = useStore((s) => s.project.rooms)
  const solved = useSolved()
  const s = solved.byId.get(room.id)
  const zones = [...new Set(rooms.map((r) => r.acZone).filter(Boolean))]

  return (
    <div className="stack">
      <div className="row between">
        <h2>{room.name}</h2>
        <button className="btn ghost" onClick={() => select(null)}>
          Done
        </button>
      </div>
      <Field label="Name">
        <input value={room.name} onChange={(e) => updateRoom(room.id, { name: e.target.value })} />
      </Field>
      <Field label="Type">
        <select value={room.type} onChange={(e) => updateRoom(room.id, { type: e.target.value as RoomType })}>
          {ROOM_TYPES.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Aircon zone" hint="Rooms with the same zone name are cooled together (e.g. open-plan living + dining).">
        <input
          list="zones"
          value={room.acZone}
          placeholder={room.name}
          onChange={(e) => updateRoom(room.id, { acZone: e.target.value })}
        />
        <datalist id="zones">
          {zones.map((z) => (
            <option key={z} value={z} />
          ))}
        </datalist>
      </Field>

      <h3>Edges</h3>
      <p className="muted small">Mark boundaries without a physical wall (open plan) as “Open”.</p>
      <ul className="edge-list">
        {room.edges.map((e, i) => (
          <li key={e.id}>
            <span>
              Edge {i + 1}
              <span className="muted"> · ≈ {s ? formatLength(s.estimates[i]) : '—'}</span>
            </span>
            <Segmented
              value={e.kind}
              onChange={(kind) => updateEdge(room.id, i, { kind })}
              options={[
                { value: 'wall', label: 'Wall' },
                { value: 'open', label: 'Open' },
              ]}
            />
          </li>
        ))}
      </ul>

      {selVertex != null && (
        <div className="callout">
          Corner {selVertex + 1} selected · drag to move.
          <button
            className="btn small"
            disabled={room.points.length <= 3}
            onClick={() => {
              deleteVertex(room.id, selVertex)
              clearVertex()
            }}
          >
            Delete corner
          </button>
        </div>
      )}
      <p className="muted small">Drag corners to adjust. Tap a “+” on an edge to add a corner.</p>

      <div className="row">
        <button
          className="btn primary"
          onClick={() => {
            setWizard({ roomId: room.id, step: 'room' })
            setTab('measure')
          }}
        >
          Measure this room
        </button>
        <button
          className="btn danger"
          onClick={() => {
            if (confirm(`Delete ${room.name}?`)) deleteRoom(room.id)
          }}
        >
          Delete room
        </button>
      </div>
    </div>
  )
}

function VertexHandles({ room, k, selVertex }: { room: Room; k: number; selVertex: number | null }) {
  const n = room.points.length
  return (
    <g>
      {room.points.map((p, i) => {
        const q = room.points[(i + 1) % n]
        const m = lerp(p, q, 0.5)
        return (
          <g key={`m${i}`} data-handle={`m:${i}`} className="handle">
            <circle cx={m.x} cy={m.y} r={9 / k} fill="#fff" stroke="#2563eb" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
            <path
              d={`M ${m.x - 4 / k} ${m.y} H ${m.x + 4 / k} M ${m.x} ${m.y - 4 / k} V ${m.y + 4 / k}`}
              stroke="#2563eb"
              strokeWidth={1.5}
              vectorEffect="non-scaling-stroke"
            />
          </g>
        )
      })}
      {room.points.map((p, i) => (
        <circle
          key={`v${i}`}
          data-handle={`v:${i}`}
          className="handle"
          cx={p.x}
          cy={p.y}
          r={(i === selVertex ? 9 : 7) / k}
          fill={i === selVertex ? '#2563eb' : '#fff'}
          stroke="#2563eb"
          strokeWidth={2}
          vectorEffect="non-scaling-stroke"
        />
      ))}
    </g>
  )
}

function TraceOverlay({
  points,
  hover,
  k,
  image,
}: {
  points: Vec2[]
  hover: Snapped | null
  k: number
  image: { width: number; height: number }
}) {
  const last = points[points.length - 1]
  return (
    <g pointerEvents="none">
      {hover?.guideX != null && (
        <line x1={hover.guideX} y1={0} x2={hover.guideX} y2={image.height} className="guide" vectorEffect="non-scaling-stroke" />
      )}
      {hover?.guideY != null && (
        <line x1={0} y1={hover.guideY} x2={image.width} y2={hover.guideY} className="guide" vectorEffect="non-scaling-stroke" />
      )}
      {points.length > 0 && (
        <polyline
          points={points.map((p) => `${p.x},${p.y}`).join(' ')}
          fill="none"
          stroke="#2563eb"
          strokeWidth={2.5}
          vectorEffect="non-scaling-stroke"
        />
      )}
      {last && hover && (
        <line
          x1={last.x}
          y1={last.y}
          x2={hover.p.x}
          y2={hover.p.y}
          stroke="#2563eb"
          strokeWidth={2}
          strokeDasharray="6 4"
          vectorEffect="non-scaling-stroke"
        />
      )}
      {points.map((p, i) => (
        <circle
          key={i}
          cx={p.x}
          cy={p.y}
          r={(i === 0 && points.length >= 3 ? 9 : 5) / k}
          fill={i === 0 ? '#fff' : '#2563eb'}
          stroke="#2563eb"
          strokeWidth={2}
          vectorEffect="non-scaling-stroke"
        />
      ))}
      {hover && (
        <circle
          cx={hover.p.x}
          cy={hover.p.y}
          r={6 / k}
          fill={hover.onVertex ? '#16a34a' : 'none'}
          stroke={hover.onVertex ? '#16a34a' : '#2563eb'}
          strokeWidth={2}
          vectorEffect="non-scaling-stroke"
        />
      )}
    </g>
  )
}

function CalibOverlay({ points, hover, k, mm }: { points: Vec2[]; hover: Snapped | null; k: number; mm: number | null }) {
  const [a, b0] = points
  const b = b0 ?? (a && hover ? hover.p : null)
  return (
    <g pointerEvents="none">
      {a && b && (
        <>
          <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#dc2626" strokeWidth={3} vectorEffect="non-scaling-stroke" />
          {b0 && mm && (
            <text x={(a.x + b.x) / 2} y={(a.y + b.y) / 2 - 8 / k} fontSize={14 / k} textAnchor="middle" className="plan-label calib">
              {formatLength(mm)}
            </text>
          )}
        </>
      )}
      {points.map((p, i) => (
        <circle key={i} cx={p.x} cy={p.y} r={6 / k} fill="#dc2626" stroke="#fff" strokeWidth={2} vectorEffect="non-scaling-stroke" />
      ))}
    </g>
  )
}
