import { useMemo, useRef } from 'react'
import { compareRoom, compareWalls } from '../geometry/compare'
import { edgeFacing, facesAfternoonSun, formatFacing, outdoorEdges, roomFacing } from '../geometry/facing'
import { bbox, centroid, pointInPolygon } from '../geometry/polygon'
import type { SolvedRoom } from '../geometry/solve'
import { add, dist, dot, lerp, norm, outward, scale, sub } from '../geometry/vec'
import { placePillars, wallFaces } from '../geometry/pillars'
import { groupMeasured, groupOf, splitMeasured } from '../geometry/runs'
import { deviates } from '../geometry/scale'
import { useStore, type WizardStep } from '../store'
import { roomTypeInfo, type Edge, type Opening, type OpeningKind, type Pillar, type Room, type Vec2 } from '../types'
import { formatArea, formatLength, formatSqft } from '../units'
import { ColorInput, Field, InstalledAcField, LengthInput, PlanImageToggle, Segmented, useRememberedCheck, useSolved } from './common'
import { CompareLayer, ComparePanel, stepNote } from './ComparePlan'
import { CompassBadge } from './Compass'
import { PlanView, type PointerInfo } from './PlanView'
import { RescaleToMeasurements } from './Rescale'
import { RoomShapes } from './RoomShapes'

const OPENING_DEFAULTS: Record<OpeningKind, Omit<Opening, 'id' | 'offset'>> = {
  door: { kind: 'door', width: 900, height: 2100, sill: 0 },
  window: { kind: 'window', width: 1200, height: 1200, sill: 900 },
  opening: { kind: 'opening', width: 900, height: 2100, sill: 0 },
}

const PILLAR_SIZE = { width: 400, depth: 300 }

export function MeasureView() {
  const project = useStore((s) => s.project)
  const wizard = useStore((s) => s.wizard)
  const setWizard = useStore((s) => s.setWizard)
  const solved = useSolved()
  const viewK = useRef(1)
  const [compare, setCompare] = useRememberedCheck('measure:compare', false)
  const tolerance = project.settings.closureTolerance
  const walls = useMemo(() => compareWalls(solved, tolerance), [solved, tolerance])

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
  const rawStep = wizard?.step ?? 'room'
  // Wall steps are keyed by the first edge of their group; normalise any edge index to that.
  const activeGroup = s && typeof rawStep === 'number' ? groupOf(s.groups, rawStep) : null
  const step: WizardStep = activeGroup ? activeGroup[0] : rawStep

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
        setWizard({ roomId: room.id, step: s ? groupOf(s.groups, best)[0] : best })
        return
      }
    }
    if (compare) {
      // Comparing: tapping near a wall as measured (or its label) goes to it. Where two rooms share a line,
      // each has its own side of it, so the room tapped in comes first.
      const q = scale(p, k)
      const reach = ((info.pointerType === 'mouse' ? 22 : 28) / viewK.current) * k
      const near = solved.rooms.flatMap((r) =>
        r.starts.map((a, i) => ({ r, i, d: distToSegment(q, a, r.ends[i]), inside: pointInPolygon(q, r.outline) })),
      )
      const best = near
        .filter((c) => c.d < reach)
        .sort((a, b) => Number(b.inside) - Number(a.inside) || a.d - b.d)[0]
      if (best) {
        setWizard({ roomId: best.r.room.id, step: groupOf(best.r.groups, best.i)[0] })
        return
      }
    }
    const hit = project.rooms.find((r) => pointInPolygon(p, r.points))
    if (hit && hit.id !== room?.id) setWizard({ roomId: hit.id, step: 'room' })
  }

  return (
    <div className="split">
      <div className="canvas-wrap">
        <PlanView
          image={project.image}
          showImage={project.settings.showPlanImage}
          fit={fit}
          fitKey={room?.id ?? 'all'}
          cursor="pointer"
          onTap={onTap}
        >
          {(vk) => {
            viewK.current = vk
            return (
              <>
                {compare && !room ? (
                  <CompareLayer solved={solved} walls={walls} k={vk} />
                ) : (
                  <RoomShapes rooms={project.rooms} solved={solved} k={vk} selectedId={room?.id} dimmed={!!room} showArea={!room} />
                )}
                {room && s && <EdgeLabels room={room} s={s} k={vk} mmPerPx={k} active={activeGroup} />}
              </>
            )
          }}
        </PlanView>
        <div className="canvas-toolbar">
          <PlanImageToggle />
          <label className="check small">
            <input type="checkbox" checked={compare} onChange={(e) => setCompare(e.target.checked)} /> Compare with plan
          </label>
        </div>
        {project.north != null && <CompassBadge north={project.north} />}
      </div>
      <aside className="panel">
        {!room || !s ? (
          compare ? (
            <ComparePanel solved={solved} walls={walls} />
          ) : (
            <RoomPicker />
          )
        ) : step === 'room' ? (
          <RoomStep room={room} s={s} />
        ) : step === 'summary' ? (
          <SummaryStep room={room} s={s} />
        ) : (
          <WallStep key={`${room.id}-${step}`} room={room} s={s} group={activeGroup ?? [step as number]} />
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
      <RescaleToMeasurements nudge />
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

/** Previous/next wizard step, walking wall groups in order. */
function neighbourSteps(s: SolvedRoom, step: WizardStep): { prev: WizardStep | null; next: WizardStep } {
  const order = s.groups.map((g) => g[0])
  if (step === 'room') return { prev: null, next: order[0] ?? 'summary' }
  if (step === 'summary') return { prev: order[order.length - 1] ?? 'room', next: 'summary' }
  const i = order.indexOf(groupOf(s.groups, step)[0])
  return { prev: i <= 0 ? 'room' : order[i - 1], next: i === order.length - 1 ? 'summary' : order[i + 1] }
}

function StepNav({ room, s, step, nextLabel = 'Next' }: { room: Room; s: SolvedRoom; step: WizardStep; nextLabel?: string }) {
  const setWizard = useStore((st) => st.setWizard)
  const { prev, next } = neighbourSteps(s, step)
  return (
    <div className="wizard-nav">
      <button className="btn" onClick={() => (prev == null ? setWizard(null) : setWizard({ roomId: room.id, step: prev }))}>
        ← {prev == null ? 'Rooms' : 'Back'}
      </button>
      <button className="btn primary" onClick={() => setWizard({ roomId: room.id, step: next })}>
        {nextLabel} →
      </button>
    </div>
  )
}

function Progress({ room, s, step }: { room: Room; s: SolvedRoom; step: WizardStep }) {
  const setWizard = useStore((st) => st.setWizard)
  return (
    <div className="progress">
      <button className={step === 'room' ? 'on' : ''} onClick={() => setWizard({ roomId: room.id, step: 'room' })}>
        H
      </button>
      {s.groups.map((g, n) => (
        <button
          key={room.edges[g[0]].id}
          className={`${step === g[0] ? 'on' : ''} ${room.edges[g[0]].kind === 'open' ? 'open' : groupMeasured(room, g) != null ? 'done' : ''}`}
          onClick={() => setWizard({ roomId: room.id, step: g[0] })}
        >
          {n + 1}
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
  const setTab = useStore((st) => st.setTab)
  const solved = useSolved()
  const facing = roomFacing(solved, s)
  const autoSun =
    solved.north == null
      ? 'no, north isn’t set'
      : !facing.length
        ? 'no, no outside walls'
        : `${facesAfternoonSun(facing) ? 'yes' : 'no'}, faces ${formatFacing(facing)}`
  const autoAc =
    room.acInstalled != null
      ? 'yes, one is installed'
      : `${roomTypeInfo(room.type).ac ? 'yes' : 'no'} for ${roomTypeInfo(room.type).label.toLowerCase()}`
  return (
    <div className="stack">
      <Progress room={room} s={s} step="room" />
      <h2>{room.name}</h2>
      <p className="muted">
        {roomTypeInfo(room.type).label} · {s.wallCount} walls to measure · plan estimate {formatArea(s.area)}
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
          onEnter={() => setWizard({ roomId: room.id, step: s.groups[0]?.[0] ?? 'summary' })}
          autoFocus
        />
      </Field>
      <Field
        label="Afternoon sun"
        hint={
          <>
            Sun through west-facing windows adds {Math.round((settings.acSunnyFactor - 1) * 100)}% to the aircon size.
            {solved.north == null && (
              <>
                {' '}
                <button className="link" onClick={() => setTab('plan')}>
                  Set north
                </button>{' '}
                on the Plan tab to work it out.
              </>
            )}
          </>
        }
      >
        <select
          value={room.sunny == null ? 'auto' : room.sunny ? 'yes' : 'no'}
          onChange={(e) => updateRoom(room.id, { sunny: e.target.value === 'auto' ? null : e.target.value === 'yes' })}
        >
          <option value="auto">Auto ({autoSun})</option>
          <option value="yes">Yes</option>
          <option value="no">No</option>
        </select>
      </Field>
      <Field label="Needs aircon">
        <select
          value={room.ac == null ? 'auto' : room.ac ? 'yes' : 'no'}
          onChange={(e) => updateRoom(room.id, { ac: e.target.value === 'auto' ? null : e.target.value === 'yes' })}
        >
          <option value="auto">Auto ({autoAc})</option>
          <option value="yes">Yes</option>
          <option value="no">No</option>
        </select>
      </Field>
      <InstalledAcField room={room} />
      <StepNav room={room} s={s} step="room" nextLabel="Start walls" />
    </div>
  )
}

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0)

function WallStep({ room, s, group }: { room: Room; s: SolvedRoom; group: number[] }) {
  const settings = useStore((st) => st.project.settings)
  const rooms = useStore((st) => st.project.rooms)
  const { updateEdge, addOpening, updateOpening, removeOpening, addPillar, updatePillar, removePillar, setWizard } = useStore.getState()
  const solved = useSolved()
  const first = group[0]
  const edge = room.edges[first]
  // Show thickness/side from the longest part; changes apply to the whole wall.
  const main = group.reduce((a, b) => (s.estimates[b] > s.estimates[a] ? b : a))
  const info = s.edgeInfo[main]
  const facing = solved.north != null && outdoorEdges(solved, s).includes(main) ? edgeFacing(s, main, solved.north) : null
  const estimate = sum(group.map((i) => s.estimates[i]))
  const measured = groupMeasured(room, group)
  const check = compareRoom(s, settings.closureTolerance).find((w) => w.group[0] === first)
  const misread = check && (check.verdict === 'recheck' || check.verdict === 'conflict') ? check : null
  const unit = settings.inputUnit
  const number = s.groups.findIndex((g) => g[0] === first) + 1
  const { next } = neighbourSteps(s, first)
  const goNext = () => setWizard({ roomId: room.id, step: next })
  const neighbourNames = [
    ...new Set(group.flatMap((i) => s.edgeInfo[i].neighbors.map((nb) => rooms.find((r) => r.id === nb.roomId)?.name)).filter(Boolean)),
  ]
  // Where each part starts along the wall, so openings can be placed from corner A.
  const starts = group.map((_, j) => sum(group.slice(0, j).map((i) => s.closure.lengths[i])))
  const currentLength = sum(group.map((i) => s.closure.lengths[i]))
  const openings = group.flatMap((i, j) => room.edges[i].openings.map((o) => ({ o, edge: i, start: starts[j] })))
  const pillars = group.flatMap((i, j) => (room.edges[i].pillars ?? []).map((p) => ({ p, edge: i, start: starts[j] })))
  // A pillar against it (its own, or one in the corner of the next wall) is in the way of the tape.
  const clear = sum(wallFaces(s).flatMap((f) => (!f.pillar && group.includes(f.edge) ? [dist(f.a, f.b)] : [])))
  const behindPillar = edge.kind === 'wall' && currentLength - clear > 1

  const paint = edge.paint ?? settings.wallPaint

  const forAll = (patch: Partial<Edge>) => group.forEach((i) => updateEdge(room.id, i, patch))
  const setMeasured = (total: number | null) => {
    const parts = splitMeasured(total, group, s.estimates)
    group.forEach((i, j) => updateEdge(room.id, i, { measured: parts[j] }))
  }
  const setThickness = (thickness: number | null) => {
    for (const i of group) {
      updateEdge(room.id, i, { thickness })
      // A shared wall has one thickness; keep the neighbour's side in sync.
      for (const nb of s.edgeInfo[i].neighbors) updateEdge(nb.roomId, nb.edge, { thickness })
    }
  }

  return (
    <div className="stack">
      <Progress room={room} s={s} step={first} />
      <h2>
        {room.name} · wall {number} of {s.groups.length}
      </h2>
      <p className="muted small">
        From corner <strong className="tag-a">A</strong> to <strong className="tag-b">B</strong> (highlighted on the plan)
        {neighbourNames.length ? ` · shared with ${neighbourNames.join(', ')}` : ''}
        {facing ? ` · looks out ${facing}` : ''}
      </p>
      {group.length > 1 && (
        <p className="callout small">
          One straight wall, traced in {group.length} parts. Measure it end to end; the length is shared between the parts using
          the plan.
        </p>
      )}
      <Segmented
        value={edge.kind}
        onChange={(kind) => forAll({ kind })}
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
            {behindPillar && ' With a pillar in the way, measure up to it and add how far it runs along this wall.'}
          </>
        }
      >
        <LengthInput value={measured} unit={unit} placeholder={null} onChange={setMeasured} onEnter={goNext} autoFocus />
      </Field>
      {check?.verdict === 'step' ? (
        <div className="callout">{stepNote(check, unit)}</div>
      ) : misread ? (
        <div className="callout warn">
          The room’s other walls make it ≈ {formatLength(Math.round(misread.others as number), unit)}
          {misread.verdict === 'recheck' ? ', as the plan does' : ''}. Re-check this reading
          {misread.verdict === 'conflict' ? ', and the walls across it' : ''}.
        </div>
      ) : (
        measured != null &&
        deviates(measured, estimate) && (
          <div className="callout warn">
            That’s {Math.round(((measured - estimate) / estimate) * 100)}% off the plan.{' '}
            {check?.verdict === 'differs'
              ? 'The room’s other walls agree, so the plan is probably wrong here.'
              : 'Re-check the reading, or the plan may be wrong here.'}
          </div>
        )
      )}

      {edge.kind === 'wall' && (
        <details className="more" open={edge.thickness != null || edge.side !== 'auto' || edge.openAir === false}>
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
              onChange={(side) => forAll({ side })}
              options={[
                { value: 'auto', label: 'Auto' },
                { value: 'internal', label: 'Inside the unit' },
                { value: 'external', label: 'Outside' },
              ]}
            />
          </Field>
          {info.side === 'external' && (
            <Field label="Beyond the wall" hint="Only open air lets the sun in, which adds to the aircon size.">
              <Segmented
                value={edge.openAir === false ? 'enclosed' : 'open'}
                onChange={(v) => forAll({ openAir: v === 'open' ? undefined : false })}
                options={[
                  { value: 'open', label: 'Open air' },
                  { value: 'enclosed', label: 'Next unit / corridor' },
                ]}
              />
            </Field>
          )}
        </details>
      )}

      {edge.kind === 'wall' && (
        <details className="more" open={edge.paint != null}>
          <summary>
            Paint: <span className="swatch" style={{ background: paint }} /> {paint}
            {edge.paint == null ? ' (layout colour)' : ''}
          </summary>
          <Field label="Paint colour" hint="Hex colour code for this room’s side of the wall, shown in the 3D view.">
            <ColorInput value={paint} onChange={(hex) => forAll({ paint: hex })} />
          </Field>
          {edge.paint != null && (
            <div className="row">
              <button className="btn small" onClick={() => forAll({ paint: undefined })}>
                Use the layout colour ({settings.wallPaint})
              </button>
            </div>
          )}
        </details>
      )}

      {edge.kind === 'wall' && (
        <div className="openings">
          <h3>Doors &amp; windows on this wall</h3>
          {openings.length === 0 && <p className="muted small">None. Add them for the 3D view and wall areas.</p>}
          {openings.map(({ o, edge: i, start }) => (
            <div key={o.id} className="opening">
              <div className="row between">
                <select value={o.kind} onChange={(e) => updateOpening(room.id, i, o.id, { kind: e.target.value as OpeningKind })}>
                  <option value="door">Door</option>
                  <option value="window">Window</option>
                  <option value="opening">Opening</option>
                </select>
                <button className="btn ghost small" onClick={() => removeOpening(room.id, i, o.id)}>
                  Remove
                </button>
              </div>
              <div className="grid2">
                <Field label="Width">
                  <LengthInput value={o.width} unit={unit} onChange={(v) => v != null && updateOpening(room.id, i, o.id, { width: v })} />
                </Field>
                <Field label="Height">
                  <LengthInput value={o.height} unit={unit} onChange={(v) => v != null && updateOpening(room.id, i, o.id, { height: v })} />
                </Field>
                <Field label="From corner A">
                  <LengthInput
                    value={start + o.offset}
                    unit={unit}
                    onChange={(v) => v != null && updateOpening(room.id, i, o.id, { offset: v - start })}
                  />
                </Field>
                <Field label="Sill (floor to bottom)">
                  <LengthInput value={o.sill} unit={unit} onChange={(v) => v != null && updateOpening(room.id, i, o.id, { sill: v })} />
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
                  // Stored on the first part, positioned from corner A along the whole wall.
                  addOpening(room.id, first, { ...d, offset: Math.max(0, Math.round((currentLength - d.width) / 2)) })
                }}
              >
                + {kind[0].toUpperCase() + kind.slice(1)}
              </button>
            ))}
          </div>
        </div>
      )}

      {edge.kind === 'wall' && (
        <div className="openings">
          <h3>Pillars on this wall</h3>
          {pillars.length === 0 && (
            <p className="muted small">None. A pillar standing out from the wall is left out of the floor area.</p>
          )}
          {pillars.map(({ p, edge: i, start }) => {
            const set = (patch: Partial<Pillar>) => updatePillar(room.id, i, p.id, patch)
            // Where it is now, from the start of its part, so it stays put when it leaves a corner.
            const offset = p.at === 'a' ? -start : p.at === 'b' ? currentLength - p.width - start : p.offset
            return (
              <div key={p.id} className="opening">
                <div className="row between">
                  <strong>Pillar</strong>
                  <button className="btn ghost small" onClick={() => removePillar(room.id, i, p.id)}>
                    Remove
                  </button>
                </div>
                <Segmented
                  value={p.at ?? 'along'}
                  onChange={(at) => set({ at: at === 'along' ? undefined : at, offset })}
                  options={[
                    { value: 'a', label: 'Corner A' },
                    { value: 'along', label: 'Along the wall' },
                    { value: 'b', label: 'Corner B' },
                  ]}
                />
                <div className="grid2">
                  <Field label="Width" hint="Along the wall">
                    <LengthInput value={p.width} unit={unit} onChange={(v) => v != null && v > 0 && set({ width: v })} />
                  </Field>
                  <Field label="Depth" hint="Out from the wall">
                    <LengthInput value={p.depth} unit={unit} onChange={(v) => v != null && v > 0 && set({ depth: v })} />
                  </Field>
                  {p.at == null && (
                    <Field label="From corner A">
                      <LengthInput value={start + p.offset} unit={unit} onChange={(v) => v != null && set({ offset: v - start })} />
                    </Field>
                  )}
                </div>
              </div>
            )
          })}
          <div className="row">
            <button
              className="btn small"
              onClick={() =>
                // Stored on the first part, positioned from corner A along the whole wall.
                addPillar(room.id, first, { ...PILLAR_SIZE, offset: Math.max(0, Math.round((currentLength - PILLAR_SIZE.width) / 2)) })
              }
            >
              + Pillar
            </button>
          </div>
        </div>
      )}

      <StepNav room={room} s={s} step={first} nextLabel={measured == null ? 'Skip' : 'Next'} />
    </div>
  )
}

function SummaryStep({ room, s }: { room: Room; s: SolvedRoom }) {
  const settings = useStore((st) => st.project.settings)
  const rooms = useStore((st) => st.project.rooms)
  const setWizard = useStore((st) => st.setWizard)
  const unit = settings.inputUnit
  const c = s.closure
  const rows = s.groups.map((g, n) => {
    const plan = sum(g.map((i) => s.estimates[i]))
    const measured = groupMeasured(room, g)
    return {
      g,
      n: n + 1,
      open: room.edges[g[0]].kind === 'open',
      plan,
      measured,
      used: sum(g.map((i) => c.lengths[i])),
      dev: measured != null ? Math.abs(measured - plan) / plan : 0,
    }
  })
  const skipped = rows.filter((r) => !r.open && r.measured == null).map((r) => r.n)
  const fromPlan = rows.filter((r) => r.measured == null).map((r) => r.n)
  const worst = [...rows].sort((a, b) => b.dev - a.dev)[0]
  const idx = rooms.findIndex((r) => r.id === room.id)
  const nextRoom = rooms[idx + 1]

  return (
    <div className="stack">
      <Progress room={room} s={s} step="summary" />
      <h2>{room.name} · summary</h2>
      <div className="stat-row">
        <div className="stat">
          <span className="stat-label">Floor area</span>
          <span className="stat-value">{formatArea(s.area)}</span>
          <span className="muted">
            {formatSqft(s.area)}
            {s.pillarArea > 0 && ` · less ${formatArea(s.pillarArea)} of pillars`}
          </span>
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
            <> Most suspicious: wall {worst.n} ({Math.round(worst.dev * 100)}% off the plan).</>
          )}
          {!s.closureOk && <> Re-measure the longest walls first.</>}
        </div>
      )}
      {s.status !== 'empty' && c.checkable === 'partial' && (
        <div className={`callout ${s.closureOk ? 'ok' : 'warn'}`}>
          Wall {skipped.join(', ')} {skipped.length === 1 ? 'was' : 'were'} worked out from the others. The other direction
          checks out to {Math.round(c.measuredError)} mm.
        </div>
      )}
      {s.status !== 'empty' && c.checkable === 'none' && (
        <div className="callout">Not checkable yet: the skipped walls can absorb any error. Measure every wall to verify.</div>
      )}
      {!c.determined && s.status !== 'empty' && (
        <div className="callout warn">
          Some lengths (wall {fromPlan.join(', ')}) still rely on the plan’s scale. Measure at least one wall on each side of the
          room.
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
          {rows.map((r) => (
            <tr key={room.edges[r.g[0]].id} onClick={() => setWizard({ roomId: room.id, step: r.g[0] })} className="clickable">
              <td>
                {r.n}
                {r.open ? ' (open)' : ''}
              </td>
              <td className="muted">{formatLength(r.plan, unit)}</td>
              <td>{r.measured != null ? formatLength(r.measured, unit) : <span className="muted">—</span>}</td>
              <td>{formatLength(r.used, unit)}</td>
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

/** One length label per wall (a split straight wall gets one), with the active wall highlighted. */
function EdgeLabels({ room, s, k, mmPerPx, active }: { room: Room; s: SolvedRoom; k: number; mmPerPx: number; active: number[] | null }) {
  const unit = useStore((st) => st.project.settings.inputUnit)
  // Draw on the inside faces (what gets measured), which may sit inside the traced lines.
  const px = (p: Vec2) => scale(p, 1 / mmPerPx)
  const pts = s.planMm.map(px)
  const starts = s.planStarts.map(px)
  const ends = s.planEnds.map(px)
  const c = centroid(pts)
  const pillars = placePillars(room, s.groups, s.planStarts, s.planEnds, s.dirs)
  return (
    <g pointerEvents="none">
      <polygon
        points={pts.map((p) => `${p.x},${p.y}`).join(' ')}
        fill="none"
        stroke="#1f2933"
        strokeWidth={1}
        strokeDasharray="3 3"
        vectorEffect="non-scaling-stroke"
      />
      {pillars.map((p) => (
        <polygon
          key={p.pillar.id}
          points={p.footprint.map((q) => `${q.x / mmPerPx},${q.y / mmPerPx}`).join(' ')}
          fill="#475569"
          fillOpacity={active?.includes(p.edge) ? 0.8 : 0.5}
          stroke="#1f2933"
          strokeWidth={1}
          vectorEffect="non-scaling-stroke"
        />
      ))}
      {s.groups.map((g) => {
        const a = starts[g[0]]
        const b = ends[g[g.length - 1]]
        const first = room.edges[g[0]]
        const measured = groupMeasured(room, g)
        const d = norm(sub(b, a))
        const labelPos = add(lerp(a, b, 0.5), scale(outward(d), -16 / k))
        const isActive = active?.[0] === g[0]
        const text = measured != null ? formatLength(measured, unit) : `≈ ${formatLength(sum(g.map((i) => s.estimates[i])), unit)}`
        const angle = (Math.atan2(d.y, d.x) * 180) / Math.PI
        const upright = angle > 90 || angle < -90 ? angle + 180 : angle
        return (
          <g key={first.id}>
            {isActive && (
              <>
                {g.map((i) => (
                  <line
                    key={i}
                    x1={starts[i].x}
                    y1={starts[i].y}
                    x2={ends[i].x}
                    y2={ends[i].y}
                    stroke="#f97316"
                    strokeWidth={6}
                    strokeLinecap="round"
                    vectorEffect="non-scaling-stroke"
                  />
                ))}
                <Marker p={a} k={k} label="A" color="#f97316" toward={c} />
                <Marker p={b} k={k} label="B" color="#7c3aed" toward={c} />
              </>
            )}
            {g.flatMap((i) => {
              // Openings, drawn along their part at their offset (converted back to plan px).
              const di = s.dirs[i]
              return room.edges[i].openings.map((o) => {
                const p0 = add(starts[i], scale(di, o.offset / mmPerPx))
                const p1 = add(starts[i], scale(di, (o.offset + o.width) / mmPerPx))
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
              })
            })}
            <text
              x={labelPos.x}
              y={labelPos.y}
              fontSize={(isActive ? 14 : 11) / k}
              textAnchor="middle"
              dominantBaseline="middle"
              transform={`rotate(${upright} ${labelPos.x} ${labelPos.y})`}
              className={`plan-label ${measured != null ? 'measured' : 'estimate'} ${isActive ? 'active' : ''}`}
            >
              {first.kind === 'open' && measured == null ? 'open' : text}
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
