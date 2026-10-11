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
import { bySize, inDoorway, plugSchedule, plugSpot, wallSpot, type WallSpot } from '../geometry/plugs'
import type { SolvedRoom } from '../geometry/solve'
import { add, dist, len, lerp, norm, outward, scale, sub } from '../geometry/vec'
import { useStore } from '../store'
import {
  LIGHT_KINDS,
  LIGHT_TEMPS,
  lightKindInfo,
  type LengthUnit,
  type Light,
  type LightKind,
  type PlugPoint,
  type Vec2,
} from '../types'
import { fmtInt, formatArea, formatLength } from '../units'
import { Field, LengthInput, NumberInput, PlanImageToggle, Segmented, useSolved } from './common'
import { FloorPlan, roomLabelBoxes, useFloorPlan } from './FloorPlan'
import { LightIcon, lightBoxes, LightLayer } from './Lights'
import { PlanView, type PointerInfo } from './PlanView'
import { placePlugs, PlugBadge, plugBoxes, PlugIcon, PlugLayer } from './Plugs'

type PlugTool = 'plug-existing' | 'plug-new'
type Tool = 'select' | LightKind | PlugTool
type Part = 'body' | 'aim' | 'e0' | 'e1' | 'plug'

const PARTS: Record<string, Part> = { l: 'body', a: 'aim', e0: 'e0', e1: 'e1', p: 'plug' }

/** The light or plug point, and the part of it, under a pointer, from its `data-handle`. */
function parseHandle(handle: string | null): { id: string; part: Part } | null {
  const m = handle?.match(/^(l|a|e0|e1|p):(.+)$/)
  return m ? { id: m[2], part: PARTS[m[1]] } : null
}

const PLUG_TOOLS: { value: PlugTool; label: string; name: string; existing: boolean; hint: string }[] = [
  {
    value: 'plug-existing',
    label: 'Existing plug',
    name: 'Existing plug point',
    existing: true,
    hint: 'Already there. The number is how many sockets it has, e.g. 2 for a twin socket.',
  },
  { value: 'plug-new', label: 'New plug', name: 'New plug point', existing: false, hint: 'One to add.' },
]

const SOCKETS = [1, 2, 3, 4, 5, 6]

/** What plug points are often for, offered as you type a remark (after the ones already used). */
const PLUG_USES = [
  'TV',
  'Fridge',
  'Oven',
  'Microwave',
  'Hob',
  'Cooker hood',
  'Kettle',
  'Washing machine',
  'Dryer',
  'Water heater',
  'Bedside',
  'Desk',
  'Router',
  'Vacuum',
]

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
  const { addLight, updateLight, removeLight, addPlug, updatePlug, removePlug } = useStore.getState()
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
  // Where the light was when the drag started, so the pointer keeps its grip and a fixed end stays put
  // (for a plug point, where on the wall it was).
  const drag = useRef<{
    id: string
    part: Part
    start: { c: Vec2; ends: [Vec2, Vec2]; grab: Vec2 } | null
    grab?: Vec2
  } | null>(null)

  const mmPerPx = solved.mmPerPx
  const selected = project.lights.find((l) => l.id === selectedId) ?? null
  const selectedPlug = project.plugs.find((x) => x.id === selectedId) ?? null

  const remove = (id: string) => {
    if (project.plugs.some((x) => x.id === id)) removePlug(id)
    else removeLight(id)
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
    if (tool === 'plug-existing' || tool === 'plug-new') {
      // On the nearest wall, with as many sockets as the last one placed.
      const s = r && wallSpot(r, p)
      if (!r) return setError('Tap inside a room, by the wall to put it on.')
      if (!s) return setError('This room has no walls to put it on.')
      const count = project.plugs.at(-1)?.count ?? 1
      const at = offsetFrom(anchors.get(r.room.id)!, s.at)
      return setSelectedId(addPlug({ roomId: r.room.id, ...at, count, existing: tool === 'plug-existing', note: '' }))
    }
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
    if (d?.part === 'plug') return dragPlug(d, toMm(raw))
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

  // Along its wall, or onto another wall of the room the pointer is in (across a wall, that's the next room).
  const dragPlug = (d: NonNullable<typeof drag.current>, p: Vec2) => {
    const plug = useStore.getState().project.plugs.find((x) => x.id === d.id)
    const spot = plug && plugSpot(solved, anchors, plug)
    if (!plug || !spot) return
    d.grab ??= sub(spot.at, p)
    const r = roomAt(solved, p) ?? solved.byId.get(plug.roomId)
    const s = r && wallSpot(r, add(p, d.grab))
    if (r && s) updatePlug(plug.id, { roomId: r.room.id, ...offsetFrom(anchors.get(r.room.id)!, s.at) })
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
  const plugRoom = selectedPlug && solved.byId.get(selectedPlug.roomId)
  const plugAt = selectedPlug && plugSpot(solved, anchors, selectedPlug)

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
          <div className="segmented tool-palette" role="radiogroup" aria-label="Plug points">
            {PLUG_TOOLS.map((t) => (
              <button
                key={t.value}
                className={tool === t.value ? 'on' : ''}
                onClick={() => pickTool(t.value)}
                role="radio"
                aria-checked={tool === t.value}
                aria-label={t.name}
                title={`${t.name}: tap by a wall to put one there`}
              >
                <PlugIcon existing={t.existing} />
                <span className="tool-label">{t.label}</span>
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
              const roomLabels = labels ? roomLabelBoxes(plan, ke) : []
              const plugs = placePlugs(project.plugs, solved, anchors, ke, 0, [
                ...roomLabels,
                ...lightBoxes(project.lights, anchors, ke),
              ])
              return (
                <g transform={`scale(${1 / mmPerPx})`}>
                  <FloorPlan
                    plan={plan}
                    solved={solved}
                    ke={ke}
                    labels={labels}
                    dims={dims}
                    unit={project.settings.inputUnit}
                    avoid={plugBoxes(plugs)}
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
                  {plugAt && <AlongWall s={plugAt} ke={ke} unit={project.settings.inputUnit} />}
                  <LightLayer
                    lights={project.lights}
                    anchors={anchors}
                    ke={ke}
                    specs={specs}
                    avoid={[...roomLabels, ...plugBoxes(plugs)]}
                    outlines={outlines}
                    selectedId={selectedId}
                    interactive
                  />
                  <PlugLayer placed={plugs} ke={ke} selectedId={selectedId} interactive />
                </g>
              )
            }}
          </PlanView>
        </div>
      </div>
      <aside className="panel">
        {error && <div className="callout warn">{error}</div>}
        {selectedPlug ? (
          <PlugInspector
            key={selectedPlug.id}
            plug={selectedPlug}
            room={plugRoom ?? null}
            spot={plugAt ?? null}
            doorway={!!plugRoom && !!plugAt && inDoorway(solved, plugRoom, plugAt)}
            onDone={() => setSelectedId(null)}
            onDelete={() => remove(selectedPlug.id)}
          />
        ) : selected ? (
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

/** Dashed lines along the wall from a plug point to each end of the wall, with how far each is. */
function AlongWall({ s, ke, unit }: { s: WallSpot; ke: number; unit: LengthUnit }) {
  const fs = 10.5 / ke
  const inward = scale(outward(s.dir), -1)
  const off = scale(inward, 3 / ke)
  const angle = angleOf(s.dir)
  const upright = angle > 90 || angle <= -90 ? angle + 180 : angle
  return (
    <g pointerEvents="none">
      {[s.a, s.b].map((end, i) => {
        const gap = dist(s.at, end)
        // Too short on screen to hold a label.
        if (gap * ke < 40) return null
        const p0 = add(s.at, off)
        const p1 = add(end, off)
        const at = add(lerp(p0, p1, 0.5), scale(inward, fs * 0.9))
        return (
          <g key={i}>
            <line x1={p0.x} y1={p0.y} x2={p1.x} y2={p1.y} className="dist-line" vectorEffect="non-scaling-stroke" />
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

function PlugInspector({
  plug,
  room,
  spot,
  doorway,
  onDone,
  onDelete,
}: {
  plug: PlugPoint
  room: SolvedRoom | null
  spot: WallSpot | null
  doorway: boolean
  onDone: () => void
  onDelete: () => void
}) {
  const unit = useStore((s) => s.project.settings.inputUnit)
  const plugs = useStore((s) => s.project.plugs)
  const updatePlug = useStore((s) => s.updatePlug)
  // Remarks already used, then the usual ones, each once whatever its case.
  const uses = [...plugs.map((p) => p.note.trim()).filter(Boolean), ...PLUG_USES].filter(
    (u, i, all) => all.findIndex((v) => v.toLowerCase() === u.toLowerCase()) === i,
  )
  return (
    <div className="stack">
      <div className="row between">
        <h2>Plug point</h2>
        <span className="muted">{room?.room.name}</span>
      </div>
      <Field label="Status" hint={plug.existing ? 'Already there.' : 'One to add.'}>
        <Segmented
          value={plug.existing ? 'existing' : 'new'}
          options={[
            { value: 'existing', label: 'Existing' },
            { value: 'new', label: 'New' },
          ]}
          onChange={(v) => updatePlug(plug.id, { existing: v === 'existing' })}
        />
      </Field>
      <Field label="Sockets" hint="How many at this point, e.g. 2 for a twin socket.">
        <Segmented
          value={String(plug.count)}
          options={SOCKETS.map((n) => ({ value: String(n), label: String(n) }))}
          onChange={(v) => updatePlug(plug.id, { count: Number(v) })}
        />
      </Field>
      <Field
        label="Remark"
        hint="What it’s for, so you don’t forget (up to 25 characters). It’s shown beside it on the plan and in the report."
      >
        <input
          value={plug.note}
          placeholder="e.g. TV, oven"
          maxLength={25}
          list="plug-uses"
          onChange={(e) => updatePlug(plug.id, { note: e.target.value })}
        />
        <datalist id="plug-uses">
          {uses.map((u) => (
            <option key={u} value={u} />
          ))}
        </datalist>
      </Field>
      {doorway && (
        <div className="callout warn">It’s in a doorway, or an opening down to the floor. Drag it along the wall.</div>
      )}
      {spot && (
        <p className="muted small">
          {formatLength(Math.round(dist(spot.at, spot.a)), unit)} from one end of the wall and{' '}
          {formatLength(Math.round(dist(spot.at, spot.b)), unit)} from the other.
        </p>
      )}
      <p className="muted small">
        Drag it along the wall, or onto another wall or into the next room. The dashed lines show how far it is from
        each end of the wall. New plug points start with as many sockets as the last one placed.
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

  const setTemp = (v: string) =>
    updateLight(light.id, { temp: v === '' ? null : v === 'tri' || v === 'rgb' ? v : Number(v) })

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
      <h2>Electrical</h2>
      <p>
        Pick a light, a fan or a plug point above the plan, then tap inside a room to place it (a plug point goes on the
        nearest wall). Tap one to select it.
      </p>
      <ul className="light-key">
        {LIGHT_KINDS.map((k) => (
          <li key={k.value}>
            <LightIcon kind={k.value} />
            <span>
              <strong>{k.label}</strong> <span className="muted">{HINT[k.value]}</span>
            </span>
          </li>
        ))}
        {PLUG_TOOLS.map((t) => (
          <li key={t.value}>
            <PlugIcon existing={t.existing} />
            <span>
              <strong>{t.name}</strong> <span className="muted">{t.hint}</span>
            </span>
          </li>
        ))}
      </ul>
      <h3>Lighting &amp; fan</h3>
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
      <h3>Plug points</h3>
      <PlugSchedule />
    </div>
  )
}

/** Sockets room by room, existing and new, and the new points by how many sockets each has. */
function PlugSchedule() {
  const rooms = useStore((s) => s.project.rooms)
  const plugs = useStore((s) => s.project.plugs)
  const rows = plugSchedule(rooms, plugs)
  if (!rows.length) return <p className="muted">No plug points yet.</p>
  const sum = (f: (r: (typeof rows)[number]) => number) => rows.reduce((a, r) => a + f(r), 0)
  const cell = (n: number, points: number) =>
    n ? <span title={`${points} point${points > 1 ? 's' : ''}`}>{n}</span> : <span className="muted">–</span>
  const toAdd = bySize(rows.flatMap((r) => r.toAddPlugs.map((p) => p.count)))
  return (
    <>
      <div className="table-wrap">
        <table className="table light-schedule">
          <thead>
            <tr>
              <th>Room</th>
              <th className="num">Existing</th>
              <th className="num">New</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.room.id}>
                <td>{r.room.name}</td>
                <td className="num">{cell(r.existing.sockets, r.existing.points)}</td>
                <td className="num">{cell(r.toAdd.sockets, r.toAdd.points)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td>Total</td>
              <td className="num">{sum((r) => r.existing.sockets)}</td>
              <td className="num">{sum((r) => r.toAdd.sockets)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
      <p className="muted small">
        Counted by the socket, so a <PlugBadge count={2} existing /> counts as 2.
        {toAdd.length > 0 && (
          <>
            {' '}
            To add:{' '}
            {toAdd.map(([count, n], i) => (
              <span key={count} className="nowrap">
                {i > 0 && ', '}
                {n} × <PlugBadge count={count} existing={false} />
              </span>
            ))}
            .
          </>
        )}
      </p>
    </>
  )
}
