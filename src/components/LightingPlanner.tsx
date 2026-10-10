import { useEffect, useMemo, useRef, useState } from 'react'
import { normDeg } from '../geometry/facing'
import {
  angleOf,
  DEFAULT_LENGTH,
  DEFAULT_TUBE,
  direction,
  FAN_SIZES,
  fanSizeFor,
  formatWatts,
  isRound,
  lightCentre,
  lightEnds,
  lightSchedule,
  nearestWall,
  newLight,
  offsetFrom,
  roomAnchors,
  roomAt,
  snapAngle,
  snapInLine,
  specsFrom,
  specsOf,
  tempLabel,
  TUBE_SIZES,
  tubesFor,
  wallDistances,
} from '../geometry/lights'
import type { SolvedRoom } from '../geometry/solve'
import { add, len, lerp, norm, outward, scale, sub } from '../geometry/vec'
import { useStore } from '../store'
import {
  LIGHT_KINDS,
  LIGHT_TEMPS,
  lightKindInfo,
  type LengthUnit,
  type Light,
  type LightKind,
  type Vec2,
} from '../types'
import { fmtInt, formatArea, formatLength } from '../units'
import { Field, LengthInput, NumberInput, PlanImageToggle, Segmented, useSolved } from './common'
import { FloorPlan, roomLabelBoxes, useFloorPlan } from './FloorPlan'
import { LightIcon, LightLayer } from './Lights'
import { PlanView, type PointerInfo } from './PlanView'

type Tool = 'select' | LightKind
type Part = 'body' | 'aim' | 'e0' | 'e1'

const PARTS: Record<string, Part> = { l: 'body', a: 'aim', e0: 'e0', e1: 'e1' }

/** The light and part of it under a pointer, from its `data-handle`. */
function parseHandle(handle: string | null): { id: string; part: Part } | null {
  const m = handle?.match(/^(l|a|e0|e1):(.+)$/)
  return m ? { id: m[2], part: PARTS[m[1]] } : null
}

const HINT: Record<LightKind, string> = {
  downlight: 'Fixed, pointing straight down.',
  surface: 'Mounted on the ceiling rather than set into it, e.g. where there’s no false ceiling.',
  eyeball: 'Turns to light a wall or a picture. The arrow is where it aims.',
  pendant: 'Hangs down, e.g. over the dining table. Linear or round.',
  strip: 'A run of LED tubes, e.g. in a cove or along the tops of cabinets.',
  fan: 'A ceiling fan, drawn at its blade sweep and sized for the room.',
}

/** Usual watts for each kind, offered as you type (an LED tube's go by its length; see TUBE_SIZES). */
const WATTS: Record<LightKind, number[]> = {
  downlight: [5, 7, 9, 12, 15, 18, 24],
  surface: [12, 18, 24, 36, 48],
  eyeball: [5, 7, 9, 12],
  pendant: [10, 15, 20, 30, 40],
  strip: [8, 9, 12, 14, 16, 18, 20],
  fan: [30, 35, 50, 75],
}

export function LightingPlanner() {
  const project = useStore((s) => s.project)
  const { addLight, updateLight, removeLight } = useStore.getState()
  const solved = useSolved()
  const plan = useFloorPlan(solved)
  const anchors = useMemo(() => roomAnchors(solved), [solved])
  const outlines = useMemo(() => new Map(solved.rooms.map((r) => [r.room.id, r.outline])), [solved])
  const [tool, setTool] = useState<Tool>('select')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [labels, setLabels] = useState(true)
  const [dims, setDims] = useState(false)
  const [specs, setSpecs] = useState(true)
  const [guides, setGuides] = useState<{ x: number | null; y: number | null }>({ x: null, y: null })
  const [error, setError] = useState<string | null>(null)
  const keRef = useRef(1)
  // Where the light was when the drag started, so the pointer keeps its grip and a fixed end stays put.
  const drag = useRef<{ id: string; part: Part; start: { c: Vec2; ends: [Vec2, Vec2]; grab: Vec2 } | null } | null>(
    null,
  )

  const mmPerPx = solved.mmPerPx
  const selected = project.lights.find((l) => l.id === selectedId) ?? null

  const remove = (id: string) => {
    removeLight(id)
    setSelectedId(null)
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest('input, select, textarea')) return
      if (e.key === 'Escape') {
        setSelectedId(null)
        setTool('select')
      }
      if ((e.key === 'Backspace' || e.key === 'Delete') && selectedId) remove(selectedId)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  if (!plan || !mmPerPx) {
    return (
      <div className="empty">
        <h2>Nothing to plan yet</h2>
        <p>Set the plan’s scale and trace at least one room on the Plan tab.</p>
      </div>
    )
  }

  const toMm = (p: Vec2) => scale(p, mmPerPx)

  const onTap = (raw: Vec2, info: PointerInfo) => {
    setError(null)
    const hit = parseHandle(info.handle)
    if (hit) return setSelectedId(hit.id)
    if (tool === 'select') return setSelectedId(null)
    const p = toMm(raw)
    const r = roomAt(solved, p)
    if (!r) return setError('Tap inside a room to place it.')
    setSelectedId(addLight({ ...newLight(tool, r, anchors.get(r.room.id)!, p), ...specsFrom(project.lights, tool) }))
  }

  const onHandleDown = (handle: string) => {
    const hit = parseHandle(handle)
    if (!hit) return false
    drag.current = { ...hit, start: null }
    setSelectedId(hit.id)
    return true
  }

  const onDrag = (raw: Vec2, info: PointerInfo) => {
    const d = drag.current
    const l = d && useStore.getState().project.lights.find((x) => x.id === d.id)
    const c = l && lightCentre(anchors, l)
    if (!d || !l || !c) return
    const p = toMm(raw)
    d.start ??= { c, ends: lightEnds(c, l), grab: sub(c, p) }
    const free = info.shiftKey || info.altKey
    const room = solved.byId.get(l.roomId) ?? null
    if (d.part === 'body') {
      // In line with another light or the middle of a room.
      const others = project.lights.filter((o) => o.id !== l.id).flatMap((o) => lightCentre(anchors, o) ?? [])
      const s = free
        ? { p: add(p, d.start.grab), x: null, y: null }
        : snapInLine(add(p, d.start.grab), [...others, ...anchors.values()], 8 / keRef.current)
      setGuides({ x: s.x, y: s.y })
      // Dragged into another room, it belongs there now.
      const r = roomAt(solved, s.p) ?? room
      if (r) updateLight(l.id, { roomId: r.room.id, ...offsetFrom(anchors.get(r.room.id)!, s.p) })
    } else if (d.part === 'aim') {
      const deg = angleOf(sub(p, c))
      updateLight(l.id, { angle: free ? normDeg(Math.round(deg)) : snapAngle(deg, room) })
    } else {
      // One end follows the pointer; the other stays where it was. The angle runs from end 0 to end 1.
      const fixed = d.part === 'e0' ? d.start.ends[1] : d.start.ends[0]
      const v = d.part === 'e0' ? sub(fixed, p) : sub(p, fixed)
      const angle = free ? normDeg(Math.round(angleOf(v))) : snapAngle(angleOf(v), room)
      const length = Math.max(100, Math.round(len(v) / 10) * 10)
      const half = scale(direction(angle), length / 2)
      const mid = d.part === 'e0' ? sub(fixed, half) : add(fixed, half)
      updateLight(l.id, { angle, length, ...offsetFrom(anchors.get(l.roomId)!, mid) })
    }
  }

  const onDragEnd = () => {
    drag.current = null
    setGuides({ x: null, y: null })
  }

  const pickTool = (t: Tool) => {
    setTool(t)
    setError(null)
  }

  const box = plan.walls.box
  const selCentre = selected && lightCentre(anchors, selected)
  const selRoom = selected && solved.byId.get(selected.roomId)

  return (
    <div className="split">
      <div className="canvas-wrap banded">
        <div className="viewer-toolbar">
          <div className="segmented tool-palette" role="radiogroup" aria-label="Tool">
            <button
              className={tool === 'select' ? 'on' : ''}
              onClick={() => pickTool('select')}
              role="radio"
              aria-checked={tool === 'select'}
            >
              Select
            </button>
            {LIGHT_KINDS.map((k) => (
              <button
                key={k.value}
                className={tool === k.value ? 'on' : ''}
                onClick={() => pickTool(k.value)}
                role="radio"
                aria-checked={tool === k.value}
                aria-label={k.label}
                title={`${k.label}: tap a room to place one`}
              >
                <LightIcon kind={k.value} />
                <span className="tool-label">{k.label}</span>
              </button>
            ))}
          </div>
          <label className="check small">
            <input type="checkbox" checked={labels} onChange={(e) => setLabels(e.target.checked)} /> Labels
          </label>
          <label className="check small">
            <input type="checkbox" checked={dims} onChange={(e) => setDims(e.target.checked)} /> Dimensions
          </label>
          {project.lights.some((l) => l.watt != null || l.temp != null) && (
            <label className="check small">
              <input type="checkbox" checked={specs} onChange={(e) => setSpecs(e.target.checked)} /> Watt &amp; temp
            </label>
          )}
          <PlanImageToggle />
        </div>
        <div className="band-canvas">
          <PlanView
            image={project.image}
            showImage={project.settings.showPlanImage}
            fit={plan.fit}
            fitKey="lighting"
            cursor={tool === 'select' ? 'default' : 'crosshair'}
            onTap={onTap}
            onHandleDown={onHandleDown}
            onDrag={onDrag}
            onDragEnd={onDragEnd}
          >
            {(k) => {
              const ke = k / mmPerPx
              keRef.current = ke
              return (
                <g transform={`scale(${1 / mmPerPx})`}>
                  <FloorPlan
                    plan={plan}
                    solved={solved}
                    ke={ke}
                    labels={labels}
                    dims={dims}
                    unit={project.settings.inputUnit}
                  />
                  {guides.x != null && (
                    <line
                      x1={guides.x}
                      y1={box.minY - 500}
                      x2={guides.x}
                      y2={box.maxY + 500}
                      className="guide"
                      vectorEffect="non-scaling-stroke"
                    />
                  )}
                  {guides.y != null && (
                    <line
                      x1={box.minX - 500}
                      y1={guides.y}
                      x2={box.maxX + 500}
                      y2={guides.y}
                      className="guide"
                      vectorEffect="non-scaling-stroke"
                    />
                  )}
                  {selected && selCentre && selRoom && (
                    <WallDistances
                      r={selRoom}
                      c={selCentre}
                      from={selected.kind === 'fan' ? selected.length / 2 : 0}
                      ke={ke}
                      unit={project.settings.inputUnit}
                    />
                  )}
                  <LightLayer
                    lights={project.lights}
                    anchors={anchors}
                    ke={ke}
                    specs={specs}
                    avoid={labels ? roomLabelBoxes(plan, ke) : []}
                    outlines={outlines}
                    selectedId={selectedId}
                    interactive
                  />
                </g>
              )
            }}
          </PlanView>
        </div>
      </div>
      <aside className="panel">
        {error && <div className="callout warn">{error}</div>}
        {selected ? (
          <LightInspector
            key={selected.id}
            light={selected}
            room={selRoom ?? null}
            centre={selCentre ?? null}
            onDone={() => setSelectedId(null)}
            onDelete={() => remove(selected.id)}
          />
        ) : (
          <LightingOverview />
        )}
      </aside>
    </div>
  )
}

/** Dashed lines from a light straight out to the walls, with how far each is; `from` mm out (a fan's blade tips). */
function WallDistances({
  r,
  c,
  from = 0,
  ke,
  unit,
}: {
  r: SolvedRoom
  c: Vec2
  from?: number
  ke: number
  unit: LengthUnit
}) {
  const fs = 10.5 / ke
  return (
    <g pointerEvents="none">
      {wallDistances(r, c).map(({ to, dist }, i) => {
        const gap = dist - from
        // Too short on screen to hold a label.
        if (gap * ke < 40) return null
        const d = norm(sub(to, c))
        const start = add(c, scale(d, from))
        const angle = angleOf(d)
        const upright = angle > 90 || angle <= -90 ? angle + 180 : angle
        const at = add(lerp(start, to, 0.5), scale(outward(d), fs * 0.8))
        return (
          <g key={i}>
            <line
              x1={start.x}
              y1={start.y}
              x2={to.x}
              y2={to.y}
              className="dist-line"
              vectorEffect="non-scaling-stroke"
            />
            <text
              x={at.x}
              y={at.y}
              fontSize={fs}
              textAnchor="middle"
              dominantBaseline="middle"
              transform={`rotate(${upright} ${at.x} ${at.y})`}
              className="plan-label dist"
            >
              {formatLength(Math.round(gap), unit)}
            </text>
          </g>
        )
      })}
    </g>
  )
}

/** Keep fan blade tips at least this far from walls (the usual guidance is 18 inches). */
const FAN_CLEARANCE = 450

function LightInspector({
  light,
  room,
  centre,
  onDone,
  onDelete,
}: {
  light: Light
  room: SolvedRoom | null
  centre: Vec2 | null
  onDone: () => void
  onDelete: () => void
}) {
  const unit = useStore((s) => s.project.settings.inputUnit)
  const lights = useStore((s) => s.project.lights)
  const updateLight = useStore((s) => s.updateLight)
  const updateLights = useStore((s) => s.updateLights)
  const info = lightKindInfo(light.kind)
  const linear = light.kind === 'strip' || (light.kind === 'pendant' && light.length > 0)
  const fan = light.kind === 'fan'
  const strip = light.kind === 'strip'
  const sameKind = lights.filter((l) => l.kind === light.kind)
  const differ = sameKind.some(
    (l) => l.size !== light.size || l.watt !== light.watt || l.temp !== light.temp || l.model !== light.model,
  )
  // Models already used for this kind, offered as you type.
  const models = [...new Set(sameKind.map((l) => l.model.trim()).filter(Boolean))].sort()
  const suggested = room && FAN_SIZES.find((s) => s.mm === fanSizeFor(room.area))
  const wall = fan && room && centre ? nearestWall(room, centre) : null
  const tips = wall && wall.dist - light.length / 2
  const tubeLength = light.size ?? DEFAULT_TUBE
  const tube = strip ? TUBE_SIZES.find((s) => s.mm === tubeLength) : undefined
  const tubes = tubesFor(light)
  const tubeName = tube ? `${tube.feet}ft` : formatLength(tubeLength, unit)
  const run = formatLength(light.length, unit)
  const lit = tubes * tubeLength
  // One tube too long for the run doesn't fit at all; the longest that does is offered instead.
  const fits = TUBE_SIZES.filter((s) => s.mm <= light.length).at(-1)
  const tooLong = `A ${tubeName} tube (${formatLength(tubeLength, unit)}) is longer than this ${run} run`
  const ends =
    lit > light.length ? ', overlapping at the joins' : lit < light.length ? ', the ends sitting just short' : ''
  const tubeHint =
    tubes === 1 && tubeLength > light.length
      ? `${tooLong}${fits ? `; a ${fits.feet}ft one fits` : ''}.`
      : `${tubes} × ${tubeName} tube${tubes > 1 ? 's' : ''} (${formatLength(lit, unit)}) for this ${run} run${ends}.`

  // A fan is sized for its room; an LED tube or pendant made from something without a length gets a usual one.
  const changeKind = (kind: LightKind) => {
    const length =
      kind === 'fan'
        ? room
          ? fanSizeFor(room.area)
          : DEFAULT_LENGTH.fan
        : lightKindInfo(kind).linear && (light.length <= 0 || fan)
          ? DEFAULT_LENGTH[kind]
          : light.length
    // Only an LED tube's size is a tube length; a model belongs to its kind.
    const size = kind === 'strip' ? (strip ? light.size : DEFAULT_TUBE) : strip ? null : light.size
    updateLight(light.id, { kind, length, size, model: '' })
  }

  const setTemp = (v: string) => updateLight(light.id, { temp: v === '' ? null : v === 'tri' ? 'tri' : Number(v) })

  return (
    <div className="stack">
      <div className="row between">
        <h2>{info.label}</h2>
        <span className="muted">{room?.room.name}</span>
      </div>
      <Field label="Type">
        <select value={light.kind} onChange={(e) => changeKind(e.target.value as LightKind)}>
          {LIGHT_KINDS.map((k) => (
            <option key={k.value} value={k.value}>
              {k.label}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Model" hint="For the report; it isn’t drawn on the plan.">
        <input
          value={light.model}
          placeholder={fan ? 'Brand and model of the fan' : 'Brand and model of the light or bulb'}
          list="light-models"
          onChange={(e) => updateLight(light.id, { model: e.target.value })}
        />
        <datalist id="light-models">
          {models.map((m) => (
            <option key={m} value={m} />
          ))}
        </datalist>
      </Field>
      {light.kind === 'pendant' && (
        <Field label="Shape">
          <Segmented
            value={light.length > 0 ? 'linear' : 'round'}
            options={[
              { value: 'linear', label: 'Linear' },
              { value: 'round', label: 'Round' },
            ]}
            onChange={(v) => updateLight(light.id, { length: v === 'round' ? 0 : DEFAULT_LENGTH.pendant })}
          />
        </Field>
      )}
      {linear && (
        <Field label={strip ? 'Run length' : 'Length'} hint="Or drag either end on the plan.">
          <LengthInput
            value={light.length}
            onChange={(mm) => mm != null && mm >= 50 && updateLight(light.id, { length: Math.round(mm) })}
            unit={unit}
          />
        </Field>
      )}
      {isRound(light) && (
        <Field
          label="Size"
          hint={
            light.kind === 'pendant'
              ? 'Across the shade.'
              : light.kind === 'surface'
                ? 'Across the fitting.'
                : `The ceiling cut-out${light.kind === 'downlight' ? `, e.g. ${formatLength(150, unit)} for a 6″ downlight` : ''}.`
          }
        >
          <LengthInput
            value={light.size}
            onChange={(mm) =>
              (mm == null || mm >= 20) && updateLight(light.id, { size: mm == null ? null : Math.round(mm) })
            }
            unit={unit}
          />
        </Field>
      )}
      {fan && (
        <Field
          label="Size"
          hint={
            room && suggested
              ? `Blade sweep. ${suggested.inches}″ is usual for a room of ${formatArea(room.area)}.`
              : 'Blade sweep.'
          }
        >
          <select value={light.length} onChange={(e) => updateLight(light.id, { length: Number(e.target.value) })}>
            {!FAN_SIZES.some((s) => s.mm === light.length) && (
              <option value={light.length}>{formatLength(light.length, unit)}</option>
            )}
            {FAN_SIZES.map((s) => (
              <option key={s.inches} value={s.mm}>
                {s.inches}″ · {formatLength(s.mm, unit)}
              </option>
            ))}
          </select>
        </Field>
      )}
      {tips != null &&
        (tips < FAN_CLEARANCE ? (
          <div className="callout warn">
            {tips < 0
              ? 'The blades reach past a wall.'
              : `The blade tips are only ${formatLength(Math.round(tips), unit)} from a wall.`}{' '}
            Keep them at least {formatLength(FAN_CLEARANCE, unit)} away: move the fan or pick a smaller one.
          </div>
        ) : (
          <p className="muted small">
            The blade tips are {formatLength(Math.round(tips), unit)} from the nearest wall.
          </p>
        ))}
      {strip && (
        <Field label="Tube" hint={tubeHint}>
          <select value={tubeLength} onChange={(e) => updateLight(light.id, { size: Number(e.target.value) })}>
            {!tube && <option value={tubeLength}>{formatLength(tubeLength, unit)}</option>}
            {TUBE_SIZES.map((s) => (
              <option key={s.feet} value={s.mm}>
                {s.feet}ft · {formatLength(s.mm, unit)}
              </option>
            ))}
          </select>
        </Field>
      )}
      <Field
        label="Power"
        hint={
          strip
            ? light.watt != null
              ? `Each tube, so ${formatWatts(light.watt * tubes)} for this run.`
              : 'Each tube.'
            : fan
              ? 'The motor, and its light if it has one.'
              : undefined
        }
      >
        <NumberInput
          value={light.watt}
          onChange={(w) => updateLight(light.id, { watt: w })}
          unit="W"
          list="usual-watts"
        />
        <datalist id="usual-watts">
          {(tube ? tube.watts : WATTS[light.kind]).map((w) => (
            <option key={w} value={w} />
          ))}
        </datalist>
      </Field>
      <Field label={fan ? 'Light' : 'Colour temperature'}>
        <select value={light.temp ?? ''} onChange={(e) => setTemp(e.target.value)}>
          <option value="">{fan ? 'None' : 'Not set'}</option>
          {light.temp != null && !LIGHT_TEMPS.some((t) => t.value === light.temp) && (
            <option value={light.temp}>{tempLabel(light.temp)}</option>
          )}
          {LIGHT_TEMPS.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
      </Field>
      <p className="muted small">New {info.plural} start with the model and settings of the last one placed.</p>
      {sameKind.length > 1 && differ && (
        <button
          className="btn small"
          onClick={() =>
            updateLights(
              sameKind.map((l) => l.id),
              specsOf(light),
            )
          }
        >
          Use for all {sameKind.length} {info.plural}
        </button>
      )}
      {light.kind === 'eyeball' && <p className="muted small">Drag the dot at the tip of the arrow to aim it.</p>}
      {(light.kind === 'eyeball' || linear) && (
        <div className="row">
          <button className="btn small" onClick={() => updateLight(light.id, { angle: normDeg(light.angle - 90) })}>
            ↺ 90°
          </button>
          <button className="btn small" onClick={() => updateLight(light.id, { angle: normDeg(light.angle + 90) })}>
            ↻ 90°
          </button>
        </div>
      )}
      <p className="muted small">
        Drag it to move it. It lines up with other lights and fans and with the middle of the room; hold Shift to place
        it freely. The dashed lines show how far {fan ? 'its blade tips are' : 'it is'} from each wall.
      </p>
      <div className="row">
        <button className="btn primary" onClick={onDone}>
          Done
        </button>
        <button className="btn danger" onClick={onDelete}>
          Delete
        </button>
      </div>
    </div>
  )
}

function LightingOverview() {
  const rooms = useStore((s) => s.project.rooms)
  const lights = useStore((s) => s.project.lights)
  const rows = lightSchedule(rooms, lights)
  const total = (k: LightKind) => rows.reduce((sum, r) => sum + r.count[k], 0)
  const tubeTotal = rows.reduce((sum, r) => sum + r.tubes, 0)
  const wattTotal = rows.reduce((sum, r) => sum + r.watts, 0)
  const unrated = rows.some((r) => r.unrated > 0)
  const cell = (n: number) => (n ? n : <span className="muted">–</span>)
  // A + where some have no power set, so the total is at least this.
  const watts = (w: number, some: boolean) => (w ? `${fmtInt(w)}${some ? '+' : ''}` : <span className="muted">–</span>)
  return (
    <div className="stack">
      <h2>Lighting &amp; fan</h2>
      <p>Pick a light or a fan above the plan, then tap inside a room to place it. Tap one to select it.</p>
      <ul className="light-key">
        {LIGHT_KINDS.map((k) => (
          <li key={k.value}>
            <LightIcon kind={k.value} />
            <span>
              <strong>{k.label}</strong> <span className="muted">{HINT[k.value]}</span>
            </span>
          </li>
        ))}
      </ul>
      <h3>Schedule</h3>
      {rows.length === 0 ? (
        <p className="muted">No lights yet.</p>
      ) : (
        <div className="table-wrap">
          <table className="table light-schedule">
            <thead>
              <tr>
                <th>Room</th>
                {LIGHT_KINDS.map((k) => (
                  <th
                    key={k.value}
                    className="num"
                    title={k.value === 'strip' ? 'LED tubes, counted by the tube' : k.label}
                    aria-label={k.label}
                  >
                    <LightIcon kind={k.value} />
                  </th>
                ))}
                <th className="num" title="Watts in all">
                  W
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.room.id}>
                  <td>{r.room.name}</td>
                  {LIGHT_KINDS.map((k) => (
                    <td key={k.value} className="num">
                      {cell(k.value === 'strip' ? r.tubes : r.count[k.value])}
                    </td>
                  ))}
                  <td className="num">{watts(r.watts, r.unrated > 0)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td>Total</td>
                {LIGHT_KINDS.map((k) => (
                  <td key={k.value} className="num">
                    {k.value === 'strip' ? tubeTotal : total(k.value)}
                  </td>
                ))}
                <td className="num">{watts(wattTotal, unrated)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
      {rows.length > 0 && unrated && wattTotal > 0 && (
        <p className="muted small">+ Some lights or fans have no power set yet, so the watts are at least this.</p>
      )}
    </div>
  )
}
