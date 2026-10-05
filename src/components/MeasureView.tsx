import { useRef } from 'react'
import { bbox, centroid, pointInPolygon } from '../geometry/polygon'
import type { SolvedRoom } from '../geometry/solve'
import { add, dist, dot, lerp, norm, outward, scale, sub } from '../geometry/vec'
import { useStore, type WizardStep } from '../store'
import { roomTypeInfo, type Opening, type OpeningKind, type Room, type Vec2 } from '../types'
import { formatArea, formatLength, formatSqft } from '../units'
import { Field, LengthInput, Segmented, useSolved } from './common'
import { PlanView, type PointerInfo } from './PlanView'
import { RoomShapes } from './RoomShapes'

const OPENING_DEFAULTS: Record<OpeningKind, Omit<Opening, 'id' | 'offset'>> = {
  door: { kind: 'door', width: 900, height: 2100, sill: 0 },
  window: { kind: 'window', width: 1200, height: 1200, sill: 900 },
  opening: { kind: 'opening', width: 900, height: 2100, sill: 0 },
}

/** A measurement this far from the plan is probably a typo or the wrong wall. */
const deviates = (measured: number, estimate: number) => Math.abs(measured - estimate) > Math.max(150, estimate * 0.08)

export function MeasureView() {
  const project = useStore((s) => s.project)
  const wizard = useStore((s) => s.wizard)
  const setWizard = useStore((s) => s.setWizard)
  const solved = useSolved()
  const viewK = useRef(1)

  if (!project.image || !project.calibration) {
    return (
      <div className="empty">
        <h2>Set up the plan first</h2>
        <p>Upload a plan, set its scale and trace the rooms on the Plan tab.</p>
        <button className="btn primary" onClick={() => useStore.getState().setTab('plan')}>
          Go to Plan
        </button>
      </div>
    )
  }

  const room = wizard ? project.rooms.find((r) => r.id === wizard.roomId) : undefined
  const s = room ? solved.byId.get(room.id) : undefined
  const step = wizard?.step ?? 'room'
  const edgeIndex = typeof step === 'number' ? step : null

  const k = solved.mmPerPx ?? 1
  const fit = (() => {
    const pts = room ? room.points : project.rooms.flatMap((r) => r.points)
    if (!pts.length) return { minX: 0, minY: 0, w: project.image.width, h: project.image.height }
    const b = bbox(pts)
    const pad = Math.max(b.w, b.h) * 0.25 + 20
    return { minX: b.minX - pad, minY: b.minY - pad, w: b.w + 2 * pad, h: b.h + 2 * pad }
  })()

  const onTap = (p: Vec2, info: PointerInfo) => {
    if (room) {
      // Tapping near a wall of the current room jumps to it.
      const n = room.points.length
      let best = -1
      let bestD = (info.pointerType === 'mouse' ? 14 : 28) / viewK.current
      room.points.forEach((a, i) => {
        const d = distToSegment(p, a, room.points[(i + 1) % n])
        if (d < bestD) {
          best = i
          bestD = d
        }
      })
      if (best >= 0) {
        setWizard({ roomId: room.id, step: best })
        return
      }
    }
    const hit = project.rooms.find((r) => pointInPolygon(p, r.points))
    if (hit && hit.id !== room?.id) setWizard({ roomId: hit.id, step: 'room' })
  }

  return (
    <div className="split">
      <div className="canvas-wrap">
        <PlanView image={project.image} fit={fit} fitKey={room?.id ?? 'all'} cursor="pointer" onTap={onTap}>
          {(vk) => {
            viewK.current = vk
            return (
              <>
                <RoomShapes rooms={project.rooms} solved={solved} k={vk} selectedId={room?.id} dimmed={!!room} showArea={!room} />
                {room && s && <EdgeLabels room={room} s={s} k={vk} mmPerPx={k} active={edgeIndex} />}
              </>
            )
          }}
        </PlanView>
      </div>
      <aside className="panel">
        {!room || !s ? (
          <RoomPicker />
        ) : step === 'room' ? (
          <RoomStep room={room} s={s} />
        ) : step === 'summary' ? (
          <SummaryStep room={room} s={s} />
        ) : (
          <WallStep key={`${room.id}-${step}`} room={room} s={s} index={step} />
        )}
      </aside>
    </div>
  )
}

function distToSegment(p: Vec2, a: Vec2, b: Vec2) {
  const ab = sub(b, a)
  const t = Math.max(0, Math.min(1, dot(sub(p, a), ab) / Math.max(1e-9, dot(ab, ab))))
  return dist(p, lerp(a, b, t))
}

function StatusBadge({ s, tol }: { s: SolvedRoom; tol: number }) {
  if (s.status === 'empty') return <span className="badge">not measured</span>
  if (s.status === 'partial') return <span className="badge partial">{`${s.measuredCount}/${s.wallCount} walls`}</span>
  if (s.closure.checkable === 'none') return <span className="badge partial">unverified</span>
  if (s.closure.measuredError > tol) return <span className="badge warn">check · {Math.round(s.closure.measuredError)} mm off</span>
  return <span className="badge ok">✓ measured</span>
}

function RoomPicker() {
  const project = useStore((s) => s.project)
  const setWizard = useStore((s) => s.setWizard)
  const solved = useSolved()
  const done = solved.rooms.filter((r) => r.status === 'complete').length
  return (
    <div className="stack">
      <h2>Measure</h2>
      <p>
        Pick a room (or tap it on the plan). For each wall, measure the inside face from corner to corner at about waist
        height, clear of skirting.
      </p>
      <p className="muted">
        {done} of {project.rooms.length} rooms fully measured
      </p>
      <ul className="room-list">
        {solved.rooms.map((s) => (
          <li key={s.room.id}>
            <button onClick={() => setWizard({ roomId: s.room.id, step: s.status === 'empty' ? 'room' : 'summary' })}>
              <span>
                <span className="swatch" style={{ background: roomTypeInfo(s.room.type).color }} />
                {s.room.name}
              </span>
              <StatusBadge s={s} tol={project.settings.closureTolerance} />
            </button>
          </li>
        ))}
      </ul>
      {!project.rooms.length && <p className="muted">No rooms yet — trace them on the Plan tab.</p>}
    </div>
  )
}

function StepNav({ room, step, nextLabel = 'Next', onNext }: { room: Room; step: WizardStep; nextLabel?: string; onNext?: () => void }) {
  const setWizard = useStore((s) => s.setWizard)
  const n = room.edges.length
  const prev: WizardStep | null = step === 'room' ? null : step === 'summary' ? n - 1 : step === 0 ? 'room' : step - 1
  const next: WizardStep = step === 'room' ? 0 : step === 'summary' ? 'summary' : step === n - 1 ? 'summary' : step + 1
  return (
    <div className="wizard-nav">
      <button className="btn" onClick={() => (prev == null ? setWizard(null) : setWizard({ roomId: room.id, step: prev }))}>
        ← {prev == null ? 'Rooms' : 'Back'}
      </button>
      <button
        className="btn primary"
        onClick={() => {
          onNext?.()
          setWizard({ roomId: room.id, step: next })
        }}
      >
        {nextLabel} →
      </button>
    </div>
  )
}

function Progress({ room, step }: { room: Room; step: WizardStep }) {
  const setWizard = useStore((s) => s.setWizard)
  return (
    <div className="progress">
      <button className={step === 'room' ? 'on' : ''} onClick={() => setWizard({ roomId: room.id, step: 'room' })}>
        H
      </button>
      {room.edges.map((e, i) => (
        <button
          key={e.id}
          className={`${step === i ? 'on' : ''} ${e.kind === 'open' ? 'open' : e.measured != null ? 'done' : ''}`}
          onClick={() => setWizard({ roomId: room.id, step: i })}
        >
          {i + 1}
        </button>
      ))}
      <button className={step === 'summary' ? 'on' : ''} onClick={() => setWizard({ roomId: room.id, step: 'summary' })}>
        ✓
      </button>
    </div>
  )
}

function RoomStep({ room, s }: { room: Room; s: SolvedRoom }) {
  const settings = useStore((st) => st.project.settings)
  const updateRoom = useStore((st) => st.updateRoom)
  const setWizard = useStore((st) => st.setWizard)
  return (
    <div className="stack">
      <Progress room={room} step="room" />
      <h2>{room.name}</h2>
      <p className="muted">
        {roomTypeInfo(room.type).label} · {room.edges.length} edges · plan estimate {formatArea(s.area)}
      </p>
      <Field
        label="Ceiling height"
        hint={`Floor to ceiling (to the false ceiling if there is one). Leave blank to use the default ${formatLength(settings.defaultHeight, settings.inputUnit)}.`}
      >
        <LengthInput
          value={room.height}
          placeholder={settings.defaultHeight}
          unit={settings.inputUnit}
          onChange={(height) => updateRoom(room.id, { height })}
          onEnter={() => setWizard({ roomId: room.id, step: 0 })}
          autoFocus
        />
      </Field>
      <label className="check">
        <input type="checkbox" checked={room.sunny} onChange={(e) => updateRoom(room.id, { sunny: e.target.checked })} />
        Gets strong afternoon sun / west-facing (adds aircon margin)
      </label>
      <Field label="Needs aircon">
        <select
          value={room.ac == null ? 'auto' : room.ac ? 'yes' : 'no'}
          onChange={(e) => updateRoom(room.id, { ac: e.target.value === 'auto' ? null : e.target.value === 'yes' })}
        >
          <option value="auto">Auto ({roomTypeInfo(room.type).ac ? 'yes' : 'no'} for {roomTypeInfo(room.type).label.toLowerCase()})</option>
          <option value="yes">Yes</option>
          <option value="no">No</option>
        </select>
      </Field>
      <StepNav room={room} step="room" nextLabel="Start walls" />
    </div>
  )
}

function WallStep({ room, s, index }: { room: Room; s: SolvedRoom; index: number }) {
  const settings = useStore((st) => st.project.settings)
  const rooms = useStore((st) => st.project.rooms)
  const { updateEdge, addOpening, updateOpening, removeOpening, setWizard } = useStore.getState()
  const edge = room.edges[index]
  const info = s.edgeInfo[index]
  const estimate = s.estimates[index]
  const unit = settings.inputUnit
  const next = () => setWizard({ roomId: room.id, step: index === room.edges.length - 1 ? 'summary' : index + 1 })
  const neighbourNames = [...new Set(info.neighbors.map((nb) => rooms.find((r) => r.id === nb.roomId)?.name).filter(Boolean))]
  const currentLength = s.closure.lengths[index]

  const setThickness = (thickness: number | null) => {
    updateEdge(room.id, index, { thickness })
    // A shared wall has one thickness; keep the neighbour's side in sync.
    for (const nb of info.neighbors) updateEdge(nb.roomId, nb.edge, { thickness })
  }

  return (
    <div className="stack">
      <Progress room={room} step={index} />
      <h2>
        {room.name} · wall {index + 1} of {room.edges.length}
      </h2>
      <p className="muted small">
        From corner <strong className="tag-a">A</strong> to <strong className="tag-b">B</strong> (highlighted on the plan)
        {neighbourNames.length ? ` · shared with ${neighbourNames.join(', ')}` : ''}
      </p>
      <Segmented
        value={edge.kind}
        onChange={(kind) => updateEdge(room.id, index, { kind })}
        options={[
          { value: 'wall', label: 'Wall' },
          { value: 'open', label: 'Open (no wall)' },
        ]}
      />

      <Field
        label={edge.kind === 'open' ? 'Length (optional)' : 'Measured length'}
        hint={
          <>
            Plan says ≈ {formatLength(estimate, unit)}.{' '}
            {edge.kind === 'open' ? 'Skip it and it will be worked out from the other walls.' : 'Skip if you can’t reach it.'}
          </>
        }
      >
        <LengthInput
          value={edge.measured}
          unit={unit}
          placeholder={null}
          onChange={(measured) => updateEdge(room.id, index, { measured })}
          onEnter={next}
          autoFocus
        />
      </Field>
      {edge.measured != null && deviates(edge.measured, estimate) && (
        <div className="callout warn">
          That’s {Math.round(((edge.measured - estimate) / estimate) * 100)}% off the plan. Re-check the reading, or the plan
          may be wrong here.
        </div>
      )}

      {edge.kind === 'wall' && (
        <details className="more" open={edge.thickness != null || edge.side !== 'auto'}>
          <summary>
            Wall thickness: {formatLength(info.thickness, unit)} · {info.side}
            {edge.thickness == null ? ' (default)' : ''}
          </summary>
          <Field
            label="Thickness"
            hint={
              <>
                Measure across a door frame (wall + plaster on both sides).
                {info.planGap != null && info.planGap > 20 ? ` The plan suggests about ${formatLength(Math.round(info.planGap / 10) * 10, unit)}.` : ''}
              </>
            }
          >
            <LengthInput value={edge.thickness} placeholder={info.thickness} unit={unit} onChange={setThickness} />
          </Field>
          <Field label="Other side is">
            <Segmented
              value={edge.side}
              onChange={(side) => updateEdge(room.id, index, { side })}
              options={[
                { value: 'auto', label: 'Auto' },
                { value: 'internal', label: 'Inside the unit' },
                { value: 'external', label: 'Outside' },
              ]}
            />
          </Field>
        </details>
      )}

      {edge.kind === 'wall' && (
        <div className="openings">
          <h3>Doors &amp; windows on this wall</h3>
          {edge.openings.length === 0 && <p className="muted small">None. Add them for the 3D view and wall areas.</p>}
          {edge.openings.map((o) => (
            <div key={o.id} className="opening">
              <div className="row between">
                <select value={o.kind} onChange={(e) => updateOpening(room.id, index, o.id, { kind: e.target.value as OpeningKind })}>
                  <option value="door">Door</option>
                  <option value="window">Window</option>
                  <option value="opening">Opening</option>
                </select>
                <button className="btn ghost small" onClick={() => removeOpening(room.id, index, o.id)}>
                  Remove
                </button>
              </div>
              <div className="grid2">
                <Field label="Width">
                  <LengthInput value={o.width} unit={unit} onChange={(v) => v != null && updateOpening(room.id, index, o.id, { width: v })} />
                </Field>
                <Field label="Height">
                  <LengthInput value={o.height} unit={unit} onChange={(v) => v != null && updateOpening(room.id, index, o.id, { height: v })} />
                </Field>
                <Field label="From corner A">
                  <LengthInput value={o.offset} unit={unit} onChange={(v) => v != null && updateOpening(room.id, index, o.id, { offset: v })} />
                </Field>
                <Field label="Sill (floor to bottom)">
                  <LengthInput value={o.sill} unit={unit} onChange={(v) => v != null && updateOpening(room.id, index, o.id, { sill: v })} />
                </Field>
              </div>
            </div>
          ))}
          <div className="row">
            {(['door', 'window', 'opening'] as OpeningKind[]).map((kind) => (
              <button
                key={kind}
                className="btn small"
                onClick={() => {
                  const d = OPENING_DEFAULTS[kind]
                  addOpening(room.id, index, { ...d, offset: Math.max(0, Math.round((currentLength - d.width) / 2)) })
                }}
              >
                + {kind[0].toUpperCase() + kind.slice(1)}
              </button>
            ))}
          </div>
        </div>
      )}

      <StepNav room={room} step={index} nextLabel={edge.measured == null ? 'Skip' : 'Next'} />
    </div>
  )
}

function SummaryStep({ room, s }: { room: Room; s: SolvedRoom }) {
  const settings = useStore((st) => st.project.settings)
  const rooms = useStore((st) => st.project.rooms)
  const setWizard = useStore((st) => st.setWizard)
  const unit = settings.inputUnit
  const c = s.closure
  const skipped = room.edges.map((e, i) => (e.kind === 'wall' && e.measured == null ? i : -1)).filter((i) => i >= 0)
  const fromPlan = room.edges.map((e, i) => (e.measured == null ? i : -1)).filter((i) => i >= 0)
  const worst = room.edges
    .map((e, i) => ({ i, dev: e.measured != null ? Math.abs(e.measured - s.estimates[i]) / s.estimates[i] : 0 }))
    .sort((a, b) => b.dev - a.dev)[0]
  const idx = rooms.findIndex((r) => r.id === room.id)
  const nextRoom = rooms[idx + 1]

  return (
    <div className="stack">
      <Progress room={room} step="summary" />
      <h2>{room.name} · summary</h2>
      <div className="stat-row">
        <div className="stat">
          <span className="stat-label">Floor area</span>
          <span className="stat-value">{formatArea(s.area)}</span>
          <span className="muted">{formatSqft(s.area)}</span>
        </div>
        <div className="stat">
          <span className="stat-label">Volume</span>
          <span className="stat-value">{((s.area * s.height) / 1e9).toFixed(1)} m³</span>
          <span className="muted">h = {formatLength(s.height, unit)}</span>
        </div>
      </div>

      {s.status === 'empty' && <div className="callout">Nothing measured yet — these figures come from the plan’s scale.</div>}
      {s.status !== 'empty' && c.checkable === 'full' && (
        <div className={`callout ${s.closureOk ? 'ok' : 'warn'}`}>
          {s.closureOk ? '✓ ' : '⚠ '}
          Walls agree to within <strong>{Math.round(c.measuredError)} mm</strong> (tolerance {settings.closureTolerance} mm).
          {!s.closureOk && worst && worst.dev > 0.02 && (
            <> Most suspicious: wall {worst.i + 1} ({Math.round(worst.dev * 100)}% off the plan).</>
          )}
          {!s.closureOk && <> Re-measure the longest walls first.</>}
        </div>
      )}
      {s.status !== 'empty' && c.checkable === 'partial' && (
        <div className={`callout ${s.closureOk ? 'ok' : 'warn'}`}>
          Wall {skipped.map((i) => i + 1).join(', ')} {skipped.length === 1 ? 'was' : 'were'} worked out from the others. The other
          direction checks out to {Math.round(c.measuredError)} mm.
        </div>
      )}
      {s.status !== 'empty' && c.checkable === 'none' && (
        <div className="callout">Not checkable yet: the skipped walls can absorb any error. Measure every wall to verify.</div>
      )}
      {!c.determined && s.status !== 'empty' && (
        <div className="callout warn">
          Some lengths (wall {fromPlan.map((i) => i + 1).join(', ')}) still rely on the plan’s scale. Measure at least one wall
          on each side of the room.
        </div>
      )}

      <table className="table">
        <thead>
          <tr>
            <th>Wall</th>
            <th>Plan</th>
            <th>Measured</th>
            <th>Used</th>
          </tr>
        </thead>
        <tbody>
          {room.edges.map((e, i) => (
            <tr key={e.id} onClick={() => setWizard({ roomId: room.id, step: i })} className="clickable">
              <td>
                {i + 1}
                {e.kind === 'open' ? ' (open)' : ''}
              </td>
              <td className="muted">{formatLength(s.estimates[i], unit)}</td>
              <td>{e.measured != null ? formatLength(e.measured, unit) : <span className="muted">—</span>}</td>
              <td>{formatLength(c.lengths[i], unit)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="muted small">“Used” lengths are the measurements nudged (least-squares) so the room closes exactly.</p>

      <div className="wizard-nav">
        <button className="btn" onClick={() => setWizard(null)}>
          All rooms
        </button>
        {nextRoom ? (
          <button className="btn primary" onClick={() => setWizard({ roomId: nextRoom.id, step: 'room' })}>
            Next: {nextRoom.name} →
          </button>
        ) : (
          <button className="btn primary" onClick={() => useStore.getState().setTab('report')}>
            See report →
          </button>
        )}
      </div>
    </div>
  )
}

/** Length labels for every wall of the focused room, with the active wall highlighted. */
function EdgeLabels({ room, s, k, mmPerPx, active }: { room: Room; s: SolvedRoom; k: number; mmPerPx: number; active: number | null }) {
  const unit = useStore((st) => st.project.settings.inputUnit)
  const n = room.points.length
  const c = centroid(room.points)
  return (
    <g pointerEvents="none">
      {room.points.map((a, i) => {
        const b = room.points[(i + 1) % n]
        const e = room.edges[i]
        const d = norm(sub(b, a))
        const inward = scale(outward(d), -1)
        const mid = lerp(a, b, 0.5)
        const labelPos = add(mid, scale(inward, 16 / k))
        const isActive = i === active
        const text = e.measured != null ? formatLength(e.measured, unit) : `≈ ${formatLength(s.estimates[i], unit)}`
        const angle = (Math.atan2(d.y, d.x) * 180) / Math.PI
        const upright = angle > 90 || angle < -90 ? angle + 180 : angle
        // Openings, drawn along the wall at their offset (converted back to plan px).
        return (
          <g key={e.id}>
            {isActive && (
              <>
                <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#f97316" strokeWidth={6} strokeLinecap="round" vectorEffect="non-scaling-stroke" />
                <Marker p={a} k={k} label="A" color="#f97316" toward={c} />
                <Marker p={b} k={k} label="B" color="#7c3aed" toward={c} />
              </>
            )}
            {e.openings.map((o) => {
              const p0 = add(a, scale(d, o.offset / mmPerPx))
              const p1 = add(a, scale(d, (o.offset + o.width) / mmPerPx))
              return (
                <line
                  key={o.id}
                  x1={p0.x}
                  y1={p0.y}
                  x2={p1.x}
                  y2={p1.y}
                  stroke={o.kind === 'window' ? '#0ea5e9' : '#a16207'}
                  strokeWidth={isActive ? 4 : 3}
                  vectorEffect="non-scaling-stroke"
                />
              )
            })}
            <text
              x={labelPos.x}
              y={labelPos.y}
              fontSize={(isActive ? 14 : 11) / k}
              textAnchor="middle"
              dominantBaseline="middle"
              transform={`rotate(${upright} ${labelPos.x} ${labelPos.y})`}
              className={`plan-label ${e.measured != null ? 'measured' : 'estimate'} ${isActive ? 'active' : ''}`}
            >
              {e.kind === 'open' && e.measured == null ? 'open' : text}
            </text>
          </g>
        )
      })}
    </g>
  )
}

function Marker({ p, k, label, color, toward }: { p: Vec2; k: number; label: string; color: string; toward: Vec2 }) {
  const dir = norm(sub(toward, p))
  const q = add(p, scale(dir, 14 / k))
  return (
    <g>
      <circle cx={p.x} cy={p.y} r={5 / k} fill={color} />
      <circle cx={q.x} cy={q.y} r={9 / k} fill={color} />
      <text x={q.x} y={q.y} fontSize={11 / k} fill="#fff" textAnchor="middle" dominantBaseline="central" fontWeight={700}>
        {label}
      </text>
    </g>
  )
}
