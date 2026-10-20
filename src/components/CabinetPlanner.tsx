import { useEffect, useMemo, useState } from 'react'
import { besideCorner, cabinetTop, cabinetWarnings, cellUnder } from '../cabinets/checks'
import { applyTemplate, createCabinet, freshName, frontsEdited, tapWall, withWalls } from '../cabinets/edit'
import { cabinetMaterials, doorLeaves } from '../cabinets/materials'
import { cornerOf, legPoint, outline, placeCabinet, shapeLabel, type Placement } from '../cabinets/placement'
import {
  doorSpace,
  hasFixed,
  insideSpace,
  isSplit,
  layOut,
  movePart,
  putBehindDoors,
  removeAt,
  samePath,
  sectionAt,
  setPartSize,
  SHELF_GAP,
  shelfSpacing,
  splitAt,
  updateCell,
} from '../cabinets/sections'
import { CUTOUT_SIZES, defaultTemplate, newWorktop, templatesFor, type CabinetTemplate } from '../cabinets/templates'
import { roomAt } from '../geometry/lights'
import { wallSpot } from '../geometry/plugs'
import type { Solved } from '../geometry/solve'
import { add, scale } from '../geometry/vec'
import { uid, useStore, type CabinetStep } from '../store'
import {
  CABINET_KINDS,
  cabinetKindInfo,
  STONE_MATERIALS,
  type ApplianceKind,
  type Cabinet,
  type CabinetFront,
  type CabinetKind,
  type CabinetCorner,
  type CabinetSection,
  type CutoutKind,
  type DoorHinge,
  type Finish,
  type HandleStyle,
  type CabinetMount,
  type Vec2,
  type Worktop,
} from '../types'
import { formatLength } from '../units'
import { APPLIANCE_LABEL, CUTOUT_LABEL, Elevation, isCornerRef, TopView, type CellRef, type CornerRef } from './CabinetDrawings'
import { fmtM, frontsText, MaterialsTable } from './CabinetMaterials'
import { ColorInput, Field, LengthInput, PlanImageToggle, Segmented, useRememberedCheck, useSolved } from './common'
import { FloorPlan, useFloorPlan, type FloorPlanData } from './FloorPlan'
import { PlanView, type PointerInfo } from './PlanView'

const STEP_LABEL: Record<CabinetStep, string> = {
  walls: 'Walls',
  type: 'Type',
  size: 'Size',
  fronts: 'Compartments',
  top: 'Top & sink',
  finish: 'Finish',
  review: 'Review',
}

/** Kinds that usually have a top get the Top step; others only if they've been given one. */
const hasTopStep = (c: Cabinet) => c.top != null || c.kind === 'base' || c.kind === 'vanity' || c.kind === 'other'

const stepsOf = (c: Cabinet): CabinetStep[] => ['walls', 'type', 'size', 'fronts', ...(hasTopStep(c) ? ['top' as const] : []), 'finish', 'review']

const FRONTS: { value: CabinetFront; label: string }[] = [
  { value: 'door', label: 'Doors' },
  { value: 'drawers', label: 'Drawers' },
  { value: 'open', label: 'Open' },
  { value: 'appliance', label: 'Appliance' },
  { value: 'panel', label: 'Panel' },
]

const HINGES: { value: DoorHinge; label: string }[] = [
  { value: 'left', label: 'Left' },
  { value: 'right', label: 'Right' },
  { value: 'pair', label: 'Pair' },
  { value: 'lift', label: 'Lift-up' },
  { value: 'sliding', label: 'Sliding' },
]

const FIXED: { value: 'none' | 'left' | 'right'; label: string }[] = [
  { value: 'none', label: 'None' },
  { value: 'left', label: 'Left' },
  { value: 'right', label: 'Right' },
]

const SHELF_ALIGN: { value: 'even' | 'top' | 'bottom'; label: string }[] = [
  { value: 'even', label: 'Evenly' },
  { value: 'top', label: 'From the top' },
  { value: 'bottom', label: 'From the bottom' },
]

const MOUNTS: { value: CabinetMount; label: string }[] = [
  { value: 'plinth', label: 'On a plinth' },
  { value: 'legs', label: 'On legs' },
  { value: 'hung', label: 'Hung' },
]

const HANDLES: { value: HandleStyle; label: string }[] = [
  { value: 'bar', label: 'Bar' },
  { value: 'knob', label: 'Knob' },
  { value: 'profile', label: 'Profile' },
  { value: 'none', label: 'Push to open' },
]

const FRONT_LABEL: Record<CabinetFront, string> = { door: 'Doors', drawers: 'Drawers', open: 'Open', appliance: 'Appliance', panel: 'Panel' }

const mm = (n: number) => `${Math.round(n).toLocaleString()} mm`

/** "Kitchen base cabinet", the name a cabinet starts with. */
const autoName = (room: string, kind: CabinetKind) => `${room} ${cabinetKindInfo(kind).label.toLowerCase()}`

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

export function CabinetPlanner() {
  const project = useStore((s) => s.project)
  const edit = useStore((s) => s.cabinetEdit)
  const solved = useSolved()
  const plan = useFloorPlan(solved)
  const [sel, setSel] = useState<CellRef | CornerRef | null>(null)
  const [inside, setInside] = useRememberedCheck('cabinet-inside', true)
  // The cabinet whose walls taps on the plan change: one just added, or after Change walls. Others stay put.
  const [pickingId, setPickingId] = useState<string | null>(null)

  const cab = edit?.id ? (project.cabinets.find((c) => c.id === edit.id) ?? null) : null
  const step = edit?.step ?? null
  useEffect(() => setSel(null), [cab?.id])
  useEffect(() => {
    if (step !== 'walls') setPickingId(null)
  }, [step])
  const picking = !!cab && pickingId === cab.id
  const setPicking = (on: boolean) => setPickingId(on && cab ? cab.id : null)

  if (!plan || !solved.mmPerPx) {
    return (
      <div className="empty">
        <h2>Nothing to plan yet</h2>
        <p>Set the plan’s scale and trace at least one room on the Plan tab. Each cabinet stands along a wall.</p>
      </div>
    )
  }

  const placed = cab ? placeCabinet(solved, cab) : null
  const p = placed?.ok ? placed.placement : null
  const drawing = cab && p && step !== 'walls'

  return (
    <div className="split">
      {drawing ? (
        <div className="canvas-wrap banded">
          <div className="viewer-toolbar">
            <span className="muted small">{cab.name}</span>
            {step === 'fronts' && (
              <label className="check small">
                <input type="checkbox" checked={inside} onChange={(e) => setInside(e.target.checked)} /> Show inside
              </label>
            )}
          </div>
          <div className="band-canvas cab-drawings">
            <Elevation
              cabinet={cab}
              placement={p}
              selected={step === 'fronts' || step === 'top' ? sel : null}
              onSelect={step === 'fronts' || step === 'top' ? setSel : undefined}
              onChangeLeg={
                step === 'fronts' ? (k, front) => useStore.getState().updateCabinet(cab.id, { legs: cab.legs.map((l, i) => (i === k ? front : l)) }) : undefined
              }
              inside={step === 'fronts' && inside}
            />
            {(step === 'type' || step === 'top' || step === 'review') && <TopView solved={solved} cabinet={cab} placement={p} className="cab-drawing top" />}
          </div>
        </div>
      ) : (
        <CabinetPlan solved={solved} plan={plan} current={cab} picking={picking} onCreated={setPickingId} />
      )}
      <aside className="panel">
        {!edit || (edit.id && !cab) ? (
          <CabinetList solved={solved} />
        ) : !cab ? (
          <NewCabinet />
        ) : step === 'walls' || !p ? (
          <WallsStep c={cab} solved={solved} placed={placed!} picking={picking} setPicking={setPicking} />
        ) : step === 'type' ? (
          <TypeStep c={cab} solved={solved} />
        ) : step === 'size' ? (
          <SizeStep c={cab} solved={solved} p={p} />
        ) : step === 'fronts' ? (
          <FrontsStep c={cab} solved={solved} p={p} sel={sel} setSel={setSel} />
        ) : step === 'top' ? (
          <TopStep c={cab} solved={solved} p={p} sel={sel} />
        ) : step === 'finish' ? (
          <FinishStep c={cab} />
        ) : (
          <ReviewStep c={cab} solved={solved} p={p} />
        )}
      </aside>
    </div>
  )
}

/**
 * The floor plan with every cabinet on it, from above. Tap a cabinet to open it. Taps pick walls only for a
 * new cabinet, or after Change walls, so one already set up can't be moved by a stray tap.
 */
function CabinetPlan({
  solved,
  plan,
  current,
  picking,
  onCreated,
}: {
  solved: Solved
  plan: FloorPlanData
  current: Cabinet | null
  picking: boolean
  onCreated: (id: string) => void
}) {
  const project = useStore((s) => s.project)
  const edit = useStore((s) => s.cabinetEdit)
  const { addCabinet, updateCabinet, setCabinetEdit } = useStore.getState()
  const mmPerPx = solved.mmPerPx!
  const onWalls = edit?.step === 'walls'
  const live = onWalls && (!current || picking)
  const [error, setError] = useState<string | null>(null)

  const onTap = (raw: Vec2, info: PointerInfo) => {
    setError(null)
    const hit = info.handle?.startsWith('cab:') ? info.handle.slice(4) : null
    if (!live) {
      if (hit && hit !== current?.id) setCabinetEdit({ id: hit, step: 'review' })
      return
    }
    const pt = scale(raw, mmPerPx)
    const r = roomAt(solved, pt)
    const spot = r && wallSpot(r, pt)
    if (!r || !spot) return setError('Tap inside a room, by the wall the cabinet goes along.')
    if (!current) {
      const c = createCabinet(solved, r, spot.edge, project.cabinets)
      if (!c) return setError('That side is open (no wall). Pick a wall.')
      const id = addCabinet(c)
      setCabinetEdit({ id, step: 'walls' })
      onCreated(id)
      return
    }
    const patch = tapWall(solved, current, r, spot.edge)
    if (patch) updateCabinet(current.id, patch)
  }

  const room = current ? solved.byId.get(current.walls.roomId) : null
  return (
    <div className="canvas-wrap">
      <PlanView
        image={project.image}
        showImage={project.settings.showPlanImage}
        fit={plan.fit}
        fitKey="cabinets"
        cursor={live ? 'crosshair' : 'default'}
        onTap={onTap}
      >
        {(k) => {
          const ke = k / mmPerPx
          return (
            <g transform={`scale(${1 / mmPerPx})`}>
              <FloorPlan plan={plan} solved={solved} ke={ke} labels dims={false} unit={project.settings.inputUnit} />
              {project.cabinets.map((c) => (
                <Footprint key={c.id} c={c} solved={solved} on={c.id === current?.id} />
              ))}
              {onWalls && room && <WallNumbers r={room} ke={ke} current={current} solved={solved} />}
            </g>
          )
        }}
      </PlanView>
      <div className="canvas-toolbar">
        <PlanImageToggle />
      </div>
      {error && <div className="canvas-note callout warn">{error}</div>}
    </div>
  )
}

/** A cabinet seen from above on the plan; a wall cabinet only as a dashed outline. */
function Footprint({ c, solved, on }: { c: Cabinet; solved: Solved; on: boolean }) {
  const res = placeCabinet(solved, c)
  if (!res.ok) return null
  const pts = outline(res.placement, c.depth + (c.top?.overhang ?? 0))
  const hung = c.kind === 'wall'
  return (
    <polygon
      data-handle={`cab:${c.id}`}
      points={pts.map((q) => `${q.x},${q.y}`).join(' ')}
      fill={c.top ? c.top.finish.color : c.fronts.color}
      fillOpacity={hung ? 0.25 : 0.85}
      stroke={on ? '#2563eb' : '#3f4652'}
      strokeWidth={on ? 3 : 1}
      strokeDasharray={hung ? '6 4' : undefined}
      vectorEffect="non-scaling-stroke"
      style={{ cursor: 'pointer' }}
    />
  )
}

/** Each wall of a room numbered as on the Measure tab; the cabinet's own walls highlighted, its start corner marked. */
function WallNumbers({ r, ke, current, solved }: { r: Solved['rooms'][number]; ke: number; current: Cabinet | null; solved: Solved }) {
  const res = current ? placeCabinet(solved, current) : null
  const p: Placement | null = res?.ok ? res.placement : null
  const mine = new Set(p?.legs.map((l) => l.group[0]))
  const rad = 9 / ke
  return (
    <g pointerEvents="none">
      {r.groups.map((g, n) => {
        if (r.room.edges[g[0]].kind !== 'wall') return null
        const a = r.starts[g[0]]
        const b = r.ends[g[g.length - 1]]
        const d = r.dirs[g[0]]
        const mid = add(scale(add(a, b), 0.5), scale({ x: -d.y, y: d.x }, 22 / ke))
        const on = mine.has(g[0])
        return (
          <g key={g[0]}>
            {on && <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#2563eb" strokeWidth={5} strokeLinecap="round" vectorEffect="non-scaling-stroke" />}
            <circle cx={mid.x} cy={mid.y} r={rad} fill={on ? '#2563eb' : '#fff'} stroke="#2563eb" strokeWidth={1} vectorEffect="non-scaling-stroke" />
            <text x={mid.x} y={mid.y} fontSize={11 / ke} textAnchor="middle" dominantBaseline="central" fill={on ? '#fff' : '#2563eb'} fontWeight={600}>
              {n + 1}
            </text>
          </g>
        )
      })}
      {p && (() => {
        const c0 = legPoint(p.legs[0], 0)
        return <circle cx={c0.x} cy={c0.y} r={6 / ke} fill="#f97316" stroke="#fff" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
      })()}
    </g>
  )
}

function CabinetList({ solved }: { solved: Solved }) {
  const project = useStore((s) => s.project)
  const { setCabinetEdit, setTab } = useStore.getState()
  const groups = [
    ...project.rooms.map((room) => ({ key: room.id, title: room.name, list: project.cabinets.filter((c) => c.walls.roomId === room.id) })),
    { key: '', title: 'Not on a wall', list: project.cabinets.filter((c) => !project.rooms.some((r) => r.id === c.walls.roomId)) },
  ].filter((g) => g.list.length)
  return (
    <div className="stack">
      <h2>Cabinets</h2>
      <p>
        Plan built-in cabinets: kitchen cabinets, wardrobes, vanities. Each one stands along a wall, or turns a corner onto
        the next one or two (an L or a U).
      </p>
      <button className="btn primary" onClick={() => setCabinetEdit({ id: null, step: 'walls' })}>
        + New cabinet
      </button>
      {groups.map((g) => (
        <div key={g.key} className="stack tight">
          <h3>{g.title}</h3>
          <ul className="room-list">
            {g.list.map((c) => {
              const res = placeCabinet(solved, c)
              const warnings = res.ok ? cabinetWarnings(solved, c, res.placement, project.settings.inputUnit).length : 1
              const widths = res.ok ? res.placement.legs.map((l) => Math.round(l.width).toLocaleString()).join(' + ') : null
              return (
                <li key={c.id}>
                  <button onClick={() => setCabinetEdit({ id: c.id, step: res.ok ? 'review' : 'walls' })}>
                    <span>
                      <span className="swatch" style={{ background: c.fronts.color }} />
                      {c.name}
                      <span className="muted small block">
                        {cabinetKindInfo(c.kind).label}
                        {widths && ` · ${shapeLabel(c.legs.length)} · ${widths} mm`}
                      </span>
                    </span>
                    {warnings > 0 && <span className="badge warn">{plural(warnings, 'check')}</span>}
                  </button>
                </li>
              )
            })}
          </ul>
        </div>
      ))}
      {project.cabinets.length > 0 && (
        <p className="muted small">
          Tap a cabinet here or on the plan to open it. What they take to build, all together, is on the{' '}
          <button className="link" onClick={() => setTab('report')}>
            Report
          </button>{' '}
          tab.
        </p>
      )}
    </div>
  )
}

function NewCabinet() {
  const setCabinetEdit = useStore((s) => s.setCabinetEdit)
  return (
    <div className="stack">
      <h2>New cabinet</h2>
      <p>Tap the wall it stands along on the plan. It starts along all of that wall; next you can turn the corner onto the wall beside it, and set where it starts and ends.</p>
      <p className="muted">
        It starts as what the room usually has (a base cabinet in a kitchen, a wardrobe in a bedroom, a vanity in a bathroom),
        which you can change after.
      </p>
      <div className="wizard-nav">
        <button className="btn" onClick={() => setCabinetEdit(null)}>
          Cancel
        </button>
      </div>
    </div>
  )
}

function Steps({ c, step }: { c: Cabinet; step: CabinetStep }) {
  const setCabinetEdit = useStore((s) => s.setCabinetEdit)
  return (
    <div className="progress labelled">
      {stepsOf(c).map((s, i) => (
        <button key={s} className={s === step ? 'on' : ''} onClick={() => setCabinetEdit({ id: c.id, step: s })}>
          {i + 1}. {STEP_LABEL[s]}
        </button>
      ))}
    </div>
  )
}

function Nav({ c, step, canNext = true }: { c: Cabinet; step: CabinetStep; canNext?: boolean }) {
  const setCabinetEdit = useStore((s) => s.setCabinetEdit)
  const order = stepsOf(c)
  const i = order.indexOf(step)
  const prev = i > 0 ? order[i - 1] : null
  const next = i < order.length - 1 ? order[i + 1] : null
  return (
    <div className="wizard-nav">
      <button className="btn" onClick={() => setCabinetEdit(prev ? { id: c.id, step: prev } : null)}>
        ← {prev ? 'Back' : 'Cabinets'}
      </button>
      <button className="btn primary" disabled={!canNext} onClick={() => setCabinetEdit(next ? { id: c.id, step: next } : null)}>
        {next ? 'Next →' : 'Done'}
      </button>
    </div>
  )
}

function Warnings({ c, solved, p }: { c: Cabinet; solved: Solved; p: Placement }) {
  const unit = useStore((s) => s.project.settings.inputUnit)
  const list = cabinetWarnings(solved, c, p, unit)
  if (!list.length) return null
  return (
    <div className="callout warn">
      {list.map((w, i) => (
        <div key={i}>{w}</div>
      ))}
    </div>
  )
}

/** The steps, and the cabinet's name with Delete beside it (on every step, for one added by mistake). */
function Header({ c, step }: { c: Cabinet; step: CabinetStep }) {
  const removeCabinet = useStore((s) => s.removeCabinet)
  return (
    <>
      <Steps c={c} step={step} />
      <div className="row between">
        <h2>{c.name}</h2>
        <button className="link danger" onClick={() => confirm(`Delete ${c.name}?`) && removeCabinet(c.id)}>
          Delete
        </button>
      </div>
    </>
  )
}

function WallsStep({
  c,
  solved,
  placed,
  picking,
  setPicking,
}: {
  c: Cabinet
  solved: Solved
  placed: ReturnType<typeof placeCabinet>
  /** taps on the plan change its walls */
  picking: boolean
  setPicking: (on: boolean) => void
}) {
  const unit = useStore((s) => s.project.settings.inputUnit)
  const updateCabinet = useStore((s) => s.updateCabinet)
  const walls = c.walls
  const setWalls = (patch: Partial<Cabinet['walls']>) => updateCabinet(c.id, withWalls(solved, c, { ...walls, ...patch }))
  const p = placed.ok ? placed.placement : null
  const n = p?.legs.length ?? 0
  const first = p?.legs[0]
  const last = p?.legs[n - 1]
  return (
    <div className="stack">
      <Header c={c} step="walls" />
      {!placed.ok && <div className="callout warn">{placed.error}</div>}
      {p && (
        <p>
          <b>{shapeLabel(n)}</b> in {p.room.room.name}, along {n === 1 ? 'wall' : 'walls'} {p.legs.map((l) => l.wallNo).join(', ')}
        </p>
      )}
      {picking ? (
        <div className="callout">
          <div>
            Tap a wall on the plan to move it there. Tap the wall just past either end to turn the corner onto it (an L, then
            a U); tap an end wall again to take it off.
          </div>
          <button className="btn small" onClick={() => setPicking(false)}>
            Done changing walls
          </button>
        </div>
      ) : (
        <div className="row wrap">
          <button className="btn small" onClick={() => setPicking(true)}>
            Change walls
          </button>
          <span className="field-hint">To move it to another wall, or turn a corner onto the next.</span>
        </div>
      )}
      {p && first && last && (
        <>
          <Field
            label={`Starts from wall ${first.wallNo}’s left corner`}
            hint={
              <>
                Facing the wall from inside the room: the corner marked <span className="dot-mark" /> on the plan. 0 = right in the corner.
              </>
            }
          >
            <LengthInput value={walls.start} unit={unit} onChange={(v) => setWalls({ start: v ?? 0 })} />
          </Field>
          <Field
            label={n === 1 ? 'Length' : `Along wall ${last.wallNo}, from the corner`}
            hint={`Blank = to its right corner (${formatLength(n === 1 ? first.wallLength - walls.start : last.wallLength, unit)}).`}
          >
            <LengthInput
              value={walls.length}
              placeholder={n === 1 ? first.wallLength - walls.start : last.wallLength}
              unit={unit}
              onChange={(v) => setWalls({ length: v })}
            />
          </Field>
          {n === 1 && walls.length != null && (
            <div className="row wrap">
              <button className="btn small" onClick={() => setWalls({ start: 0 })}>
                Into the left corner
              </button>
              <button className="btn small" onClick={() => setWalls({ start: Math.max(0, Math.round((first.wallLength - walls.length!) / 2)) })}>
                Centre on the wall
              </button>
              <button className="btn small" onClick={() => setWalls({ start: Math.max(0, Math.round(first.wallLength - walls.length!)) })}>
                Into the right corner
              </button>
            </div>
          )}
          <div className="table-wrap">
            <table className="table compact">
              <thead>
                <tr>
                  <th>Wall</th>
                  <th className="num">Wall length</th>
                  <th className="num">Along it</th>
                  <th className="num">Front</th>
                </tr>
              </thead>
              <tbody>
                {p.legs.map((l, i) => (
                  <tr key={i}>
                    <td>{l.wallNo}</td>
                    <td className="num">{Math.round(l.wallLength).toLocaleString()}</td>
                    <td className="num">{Math.round(l.to - l.from).toLocaleString()}</td>
                    <td className="num">{Math.round(l.width).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {n > 1 && (
            <p className="muted small">
              At each corner, a front loses the depth of the other leg ({mm(c.depth)}). The corner is reached from the side, through one
              leg’s end compartment: set which, and shelves in it, under Compartments.
            </p>
          )}
          <Warnings c={c} solved={solved} p={p} />
        </>
      )}
      <Nav c={c} step="walls" canNext={!!p} />
    </div>
  )
}

function TypeStep({ c, solved }: { c: Cabinet; solved: Solved }) {
  const updateCabinet = useStore((s) => s.updateCabinet)
  const cabinets = useStore((s) => s.project.cabinets)
  const room = solved.byId.get(c.walls.roomId)?.room.name ?? ''
  const choose = (t: CabinetTemplate) => {
    if (frontsEdited(solved, c) && !confirm('Replace its compartments (and cut-outs) with this template’s?')) return
    const patch = applyTemplate(solved, c, t)
    // A name it started with follows the kind.
    const others = cabinets.filter((x) => x.id !== c.id).map((x) => x.name)
    const name = t.kind !== c.kind && c.name.startsWith(autoName(room, c.kind)) ? freshName(autoName(room, t.kind), others) : c.name
    updateCabinet(c.id, { ...patch, name })
  }
  return (
    <div className="stack">
      <Header c={c} step="type" />
      <Field label="Name">
        <input value={c.name} onChange={(e) => updateCabinet(c.id, { name: e.target.value })} />
      </Field>
      <div className="choice-grid">
        {CABINET_KINDS.map((k) => (
          <button key={k.value} className={`choice${c.kind === k.value ? ' on' : ''}`} onClick={() => k.value !== c.kind && choose(defaultTemplate(k.value))}>
            <b>{k.label}</b>
            <span>{k.hint}</span>
          </button>
        ))}
      </div>
      <h3>Template</h3>
      <p className="muted small">Its sizes and compartments, fitted to this cabinet’s walls. You can change everything after.</p>
      <div className="template-list">
        {templatesFor(c.kind).map((t) => (
          <TemplateCard key={t.id} t={t} c={c} solved={solved} on={t.id === c.template} onPick={() => choose(t)} />
        ))}
      </div>
      <Nav c={c} step="type" />
    </div>
  )
}

function TemplateCard({ t, c, solved, on, onPick }: { t: CabinetTemplate; c: Cabinet; solved: Solved; on: boolean; onPick: () => void }) {
  const preview = useMemo(() => ({ ...c, ...applyTemplate(solved, c, t) }) as Cabinet, [c, solved, t])
  const res = placeCabinet(solved, preview)
  return (
    <button className={`template${on ? ' on' : ''}`} onClick={onPick}>
      {res.ok && <Elevation cabinet={preview} placement={res.placement} dims={false} captions={false} className="cab-thumb" />}
      <span>
        <b>{t.name}</b>
        <span className="muted small block">{t.hint}</span>
      </span>
    </button>
  )
}

function SizeStep({ c, solved, p }: { c: Cabinet; solved: Solved; p: Placement }) {
  const unit = useStore((s) => s.project.settings.inputUnit)
  const updateCabinet = useStore((s) => s.updateCabinet)
  const set = (patch: Partial<Cabinet>) => updateCabinet(c.id, patch)
  const ceiling = p.room.height
  const setMount = (m: CabinetMount) =>
    set({
      mount: m,
      // Hanging it lifts it off the floor; standing it brings it back down.
      bottom: m === 'hung' && c.bottom < 300 ? (c.kind === 'wall' ? 1500 : 300) : m !== 'hung' && c.bottom > 300 ? 100 : c.bottom,
    })
  return (
    <div className="stack">
      <Header c={c} step="size" />
      <div className="grid2">
        <Field label="Height" hint="Of the carcass, without the plinth or top.">
          <LengthInput value={c.height} unit={unit} onChange={(v) => v && set({ height: v })} />
        </Field>
        <Field label="Depth" hint="From the wall to the fronts.">
          <LengthInput value={c.depth} unit={unit} onChange={(v) => v && set({ depth: v })} />
        </Field>
      </div>
      <Field label="Stands">
        <Segmented value={c.mount} options={MOUNTS} onChange={setMount} />
      </Field>
      <Field
        label={c.mount === 'plinth' ? 'Plinth height' : c.mount === 'legs' ? 'Leg height' : 'Hung at'}
        hint={c.mount === 'hung' ? 'From the floor to its underside.' : undefined}
      >
        <LengthInput value={c.bottom} unit={unit} onChange={(v) => set({ bottom: v ?? 0 })} />
      </Field>
      <Field label="Board thickness" hint="Of the carcass, for the drawer sizes.">
        <LengthInput value={c.board} unit={unit} onChange={(v) => v && set({ board: v })} />
      </Field>
      <p className="muted">
        Its top is {formatLength(cabinetTop(c), unit)} from the floor
        {c.top && `, with the ${c.top.thickness} mm top`}. The ceiling is at {formatLength(ceiling, unit)}.
      </p>
      {(c.kind === 'tall' || c.kind === 'wardrobe' || c.kind === 'wall') && (
        <div className="row">
          <button className="btn small" onClick={() => set({ height: Math.max(100, Math.round(ceiling - c.bottom - (c.top?.thickness ?? 0))) })}>
            Up to the ceiling
          </button>
        </div>
      )}
      <Warnings c={c} solved={solved} p={p} />
      <Nav c={c} step="size" />
    </div>
  )
}

function FrontsStep({
  c,
  solved,
  p,
  sel: picked,
  setSel,
}: {
  c: Cabinet
  solved: Solved
  p: Placement
  sel: CellRef | CornerRef | null
  setSel: (s: CellRef | CornerRef | null) => void
}) {
  const unit = useStore((s) => s.project.settings.inputUnit)
  const updateCabinet = useStore((s) => s.updateCabinet)
  if (picked && isCornerRef(picked) && picked.corner + 1 < p.legs.length)
    return <CornerFields c={c} solved={solved} p={p} k={picked.corner} done={() => setSel(null)} />
  const sel = picked && !isCornerRef(picked) ? picked : null
  const setLeg = (k: number, front: CabinetSection) => updateCabinet(c.id, { legs: c.legs.map((l, i) => (i === k ? front : l)) })
  const front = sel ? c.legs[sel.leg] : null
  const target = front && sel ? sectionAt(front, sel.path) : null
  const leg = sel ? p.legs[sel.leg] : null
  const laid = front && leg ? layOut(front, { x: 0, y: 0, w: leg.width, h: c.height }) : null
  const me = laid && sel ? laid.cells.find((l) => samePath(l.path, sel.path)) : null

  const reset = () => {
    if (frontsEdited(solved, c) && !confirm('Put its compartments (and cut-outs) back as its template made them?')) return
    const t = templatesFor(c.kind).find((x) => x.id === c.template) ?? defaultTemplate(c.kind)
    const patch = applyTemplate(solved, c, t)
    updateCabinet(c.id, { legs: patch.legs, corners: patch.corners, top: c.top && patch.top ? { ...c.top, cutouts: patch.top.cutouts } : c.top })
    setSel(null)
  }

  if (!sel || !front || !target || isSplit(target) || !me || !leg) {
    return (
      <div className="stack">
        <Header c={c} step="fronts" />
        <p>
          Tap a compartment on the drawing to change its front, or divide it. Drag the line between two compartments to resize them.
          {p.legs.length > 1 && ' Tap a corner to put shelves in it.'}
        </p>
        <p className="muted small">
          Sizes are to the middle of the divider either side. A compartment without a size shares what the others leave, so
          it grows or shrinks with the cabinet.
        </p>
        <div className="row">
          <button className="btn small" onClick={reset}>
            Reset to the template
          </button>
        </div>
        <Warnings c={c} solved={solved} p={p} />
        <Nav c={c} step="fronts" />
      </div>
    )
  }

  const cell = target
  const path = sel.path
  const parentPath = path.slice(0, -1)
  const parent = path.length ? sectionAt(front, parentPath) : null
  const split = parent && isSplit(parent) ? parent : null
  const i = path[path.length - 1]
  const size = split ? split.parts[i].size : null
  const shown = split?.split === 'across' ? me.rect.w : me.rect.h
  const space = doorSpace(cell, me.rect)
  const behind = insideSpace(cell, me.rect)
  const shelving = cell.front === 'door' || cell.front === 'open'
  const spacing = shelving ? shelfSpacing(cell, behind.above.h) : null
  const intoDoors =
    cell.front === 'drawers' && laid ? putBehindDoors(front, path, laid.splits.find((x) => samePath(x.path, parentPath))?.sizes ?? []) : null
  const patch = (x: Partial<typeof cell>) => setLeg(sel.leg, updateCell(front, path, x))
  const divide = (dir: 'across' | 'stack', n: number) => {
    setLeg(sel.leg, splitAt(front, path, dir, n))
    setSel({ leg: sel.leg, path: split?.split === dir ? path : [...path, 0] })
  }
  const remove = () => {
    setLeg(sel.leg, removeAt(front, path))
    setSel(null)
  }
  /** How deep the nearest split running `dir` is that holds this compartment; -1 if none. */
  const depthOf = (dir: 'across' | 'stack') => {
    for (let j = path.length - 1; j >= 0; j--) {
      const s = sectionAt(front, path.slice(0, j))
      if (s && isSplit(s) && s.split === dir) return j
    }
    return -1
  }
  const move = (dir: 'across' | 'stack', by: -1 | 1) => {
    const m = movePart(front, path, dir, by)
    if (!m || !laid) return
    // A cut-out over either of the two parts moves with it.
    let top = c.top
    const before = laid.splits.find((x) => samePath(x.path, m.split))
    const after = layOut(m.root, { x: 0, y: 0, w: leg.width, h: c.height }).splits.find((x) => samePath(x.path, m.split))
    if (top && dir === 'across' && before && after) {
      const startOf = (sp: typeof before, i: number) => sp.rect.x + sp.sizes.slice(0, i).reduce((a, b) => a + b, 0)
      const shift = (x: number) => {
        for (const [a, b] of [
          [m.from, m.to],
          [m.to, m.from],
        ]) {
          const x0 = startOf(before, a)
          if (x0 <= x && x <= x0 + before.sizes[a]) return x + startOf(after, b) - x0
        }
        return x
      }
      top = { ...top, cutouts: top.cutouts.map((x) => (x.leg === sel.leg ? { ...x, x: Math.round(shift(x.x)) } : x)) }
    }
    updateCabinet(c.id, { legs: c.legs.map((l, k) => (k === sel.leg ? m.root : l)), top })
    setSel({ leg: sel.leg, path: m.path })
  }
  const across = depthOf('across')
  const upDown = depthOf('stack')
  return (
    <div className="stack">
      <Header c={c} step="fronts" />
      <div className="row between">
        <h3>
          Compartment · wall {leg.wallNo}
        </h3>
        <button className="link" onClick={() => setSel(null)}>
          Done
        </button>
      </div>
      <p className="muted small">
        {mm(me.rect.w)} wide × {mm(me.rect.h)} high
      </p>
      {split && (
        <Field
          label={split.split === 'across' ? 'Width' : 'Height'}
          hint={size == null ? 'Shares what the others leave. Type a size to fix it.' : 'Clear it to share what the others leave instead.'}
        >
          <LengthInput value={size} placeholder={shown} unit={unit} onChange={(v) => setLeg(sel.leg, setPartSize(front, path, v))} />
        </Field>
      )}
      <Field label="Front">
        <Segmented value={cell.front} options={FRONTS} onChange={(f) => patch({ front: f })} />
      </Field>
      {cell.front === 'door' && (
        <Field label="Doors open">
          <Segmented value={cell.hinge} options={HINGES} onChange={(h) => patch({ hinge: h })} />
        </Field>
      )}
      {cell.front === 'door' && cell.hinge !== 'lift' && cell.hinge !== 'sliding' && (
        <Field label="Fixed panel" hint="Where there's only room for one side to open, that side can be a panel that doesn't. The door then hinges on the far side.">
          <Segmented
            value={hasFixed(cell) ? cell.fixed! : 'none'}
            options={FIXED}
            onChange={(f) => patch(f === 'none' ? { fixed: undefined } : { fixed: f, hinge: f === 'left' ? 'right' : 'left' })}
          />
        </Field>
      )}
      {space.fixed && (
        <Field
          label="Panel width"
          hint={`${cell.fixedWidth == null ? 'Half the compartment. ' : ''}Leaves ${mm(space.doors.w)} for the door${doorLeaves(cell, space.doors.w) > 1 ? 's' : ''}.`}
        >
          <LengthInput value={cell.fixedWidth ?? null} placeholder={space.fixed.w} unit={unit} onChange={(v) => patch({ fixedWidth: v })} />
        </Field>
      )}
      {cell.front === 'drawers' && (
        <Field label="Drawers">
          <select value={cell.drawers} onChange={(e) => patch({ drawers: Number(e.target.value) })}>
            {[1, 2, 3, 4, 5, 6].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </Field>
      )}
      {intoDoors && (
        <div className="stack tight">
          <div className="row">
            <button
              className="btn small"
              onClick={() => {
                setLeg(sel.leg, intoDoors.root)
                setSel({ leg: sel.leg, path: intoDoors.path })
              }}
            >
              Put them behind the doors above
            </button>
          </div>
          <span className="field-hint">The doors run down over them, so from outside it’s just doors, and the drawers go inside at the bottom.</span>
        </div>
      )}
      {shelving && (
        <div className="grid2">
          <Field label="Shelves">
            <select value={cell.shelves} onChange={(e) => patch({ shelves: Number(e.target.value) })}>
              {Array.from({ length: 11 }, (_, n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </Field>
          <label className="check">
            <input type="checkbox" checked={cell.rail} onChange={(e) => patch({ rail: e.target.checked })} /> Hanging rail
          </label>
        </div>
      )}
      {shelving && cell.shelves > 0 && (
        <Field label="Shelves spaced">
          <Segmented
            value={cell.shelfAlign ?? 'even'}
            options={SHELF_ALIGN}
            onChange={(a) => patch({ shelfAlign: a === 'even' ? undefined : a })}
          />
        </Field>
      )}
      {spacing && (
        <Field
          label="Space between them"
          hint={`From ${cell.shelfAlign === 'top' ? 'the top' : behind.drawers ? 'the drawers inside' : 'the bottom'} to the first shelf, and from each to the next. ${
            spacing.fits
              ? `Leaves ${mm(behind.above.h - cell.shelves * spacing.gap)} ${cell.shelfAlign === 'top' ? 'under the last' : 'over the top one'}.`
              : `${mm(cell.shelfGap ?? SHELF_GAP)} apart doesn’t fit ${cell.shelves}, so they’re ${mm(spacing.gap)} apart.`
          }`}
        >
          <LengthInput value={cell.shelfGap ?? null} placeholder={spacing.gap} unit={unit} onChange={(v) => patch({ shelfGap: v })} />
        </Field>
      )}
      {cell.front === 'door' && (
        <div className="grid2">
          <Field label="Drawers inside" hint="Behind the doors, at the bottom.">
            <select value={cell.insideDrawers ?? 0} onChange={(e) => patch({ insideDrawers: Number(e.target.value) || undefined })}>
              {[0, 1, 2, 3, 4, 5, 6].map((n) => (
                <option key={n} value={n}>
                  {n || 'None'}
                </option>
              ))}
            </select>
          </Field>
          {behind.drawers && (
            <Field label="Their height" hint={`All of them. ${mm(behind.drawers.h / behind.n)} each.`}>
              <LengthInput
                value={cell.insideDrawersHeight ?? null}
                placeholder={behind.drawers.h}
                unit={unit}
                onChange={(v) => patch({ insideDrawersHeight: v })}
              />
            </Field>
          )}
        </div>
      )}
      {cell.front === 'appliance' && (
        <Field label="Space for">
          <select value={cell.appliance} onChange={(e) => patch({ appliance: e.target.value as ApplianceKind })}>
            {(Object.keys(APPLIANCE_LABEL) as ApplianceKind[]).map((a) => (
              <option key={a} value={a}>
                {APPLIANCE_LABEL[a]}
              </option>
            ))}
          </select>
        </Field>
      )}
      <div className="stack tight">
        <span className="field-label">Divide it into</span>
        {(['across', 'stack'] as const).map((dir) => (
          <div key={dir} className="row divide">
            <span className="small">{dir === 'across' ? 'Side by side' : 'One above another'}</span>
            {[2, 3, 4].map((n) => (
              <button key={n} className="btn small" onClick={() => divide(dir, n)}>
                {n}
              </button>
            ))}
          </div>
        ))}
      </div>
      {(across >= 0 || upDown >= 0) && (
        <div className="stack tight">
          <span className="field-label">Move it</span>
          <div className="row wrap">
            {across >= 0 && (
              <>
                <button className="btn small" disabled={!movePart(front, path, 'across', -1)} onClick={() => move('across', -1)}>
                  ← Left
                </button>
                <button className="btn small" disabled={!movePart(front, path, 'across', 1)} onClick={() => move('across', 1)}>
                  Right →
                </button>
              </>
            )}
            {upDown >= 0 && (
              <>
                <button className="btn small" disabled={!movePart(front, path, 'stack', -1)} onClick={() => move('stack', -1)}>
                  ↑ Up
                </button>
                <button className="btn small" disabled={!movePart(front, path, 'stack', 1)} onClick={() => move('stack', 1)}>
                  Down ↓
                </button>
              </>
            )}
          </div>
          {(across >= 0 && across < path.length - 1) || (upDown >= 0 && upDown < path.length - 1) ? (
            <span className="field-hint">
              It swaps places with the one beside it, taking its size along.{' '}
              {across >= 0 && across < path.length - 1 ? 'Left and right move the whole column it’s in.' : 'Up and down move the whole row it’s in.'}
            </span>
          ) : (
            <span className="field-hint">It swaps places with the one beside it, taking its size along.</span>
          )}
        </div>
      )}
      {path.length > 0 && (
        <div className="row">
          <button className="btn small danger" onClick={remove}>
            Remove this compartment
          </button>
        </div>
      )}
      <Warnings c={c} solved={solved} p={p} />
      <Nav c={c} step="fronts" />
    </div>
  )
}

/** An inside corner, tapped on the drawing: the side it's reached from, and shelves in it. */
function CornerFields({ c, solved, p, k, done }: { c: Cabinet; solved: Solved; p: Placement; k: number; done: () => void }) {
  const unit = useStore((s) => s.project.settings.inputUnit)
  const updateCabinet = useStore((s) => s.updateCabinet)
  const corner = cornerOf(c, k)
  const a = p.legs[k]
  const b = p.legs[k + 1]
  const set = (patch: Partial<CabinetCorner>) =>
    updateCabinet(c.id, { corners: p.legs.slice(1).map((_, j) => (j === k ? { ...corner, ...patch } : cornerOf(c, j))) })
  const spacing = shelfSpacing(corner, c.height)
  const way = besideCorner(c, p, k).find((l) => l.cell.front === 'door' || l.cell.front === 'open')
  const end = corner.open === 'left' ? 'right' : 'left'
  return (
    <div className="stack">
      <Header c={c} step="fronts" />
      <div className="row between">
        <h3>
          Corner · walls {a.wallNo} and {b.wallNo}
        </h3>
        <button className="link" onClick={done}>
          Done
        </button>
      </div>
      <p className="muted small">
        {Math.round(b.cornerLeft).toLocaleString()} × {mm(c.depth)} from above, {mm(c.height)} high. It has no front: one leg’s box runs
        on into it, behind the end of the other.
      </p>
      <Field
        label="Reached from"
        hint={
          way
            ? `Through the ${mm(way.rect.w)} compartment at the ${end} end of wall ${(corner.open === 'left' ? a : b).wallNo}, round the side.`
            : `Its compartment at the ${end} end has no doors to reach in by.`
        }
      >
        <Segmented
          value={corner.open}
          options={[
            { value: 'left', label: `Wall ${a.wallNo} (left)` },
            { value: 'right', label: `Wall ${b.wallNo} (right)` },
          ]}
          onChange={(open) => set({ open })}
        />
      </Field>
      <Field label="Shelves">
        <select value={corner.shelves} onChange={(e) => set({ shelves: Number(e.target.value) })}>
          {Array.from({ length: 11 }, (_, n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      </Field>
      {corner.shelves > 0 && (
        <Field label="Shelves spaced" hint="To line them up with the shelves beside it, space both the same way.">
          <Segmented
            value={corner.shelfAlign ?? 'even'}
            options={SHELF_ALIGN}
            onChange={(a) => set({ shelfAlign: a === 'even' ? undefined : a })}
          />
        </Field>
      )}
      {spacing && (
        <Field
          label="Space between them"
          hint={`From ${corner.shelfAlign === 'top' ? 'the top' : 'the bottom'} to the first shelf, and from each to the next. ${
            spacing.fits
              ? `Leaves ${mm(c.height - corner.shelves * spacing.gap)} ${corner.shelfAlign === 'top' ? 'under the last' : 'over the top one'}.`
              : `${mm(corner.shelfGap ?? SHELF_GAP)} apart doesn’t fit ${corner.shelves}, so they’re ${mm(spacing.gap)} apart.`
          }`}
        >
          <LengthInput value={corner.shelfGap ?? null} placeholder={spacing.gap} unit={unit} onChange={(v) => set({ shelfGap: v })} />
        </Field>
      )}
      <Warnings c={c} solved={solved} p={p} />
      <Nav c={c} step="fronts" />
    </div>
  )
}

function TopStep({ c, solved, p, sel: picked }: { c: Cabinet; solved: Solved; p: Placement; sel: CellRef | CornerRef | null }) {
  const sel = picked && !isCornerRef(picked) ? picked : null
  const unit = useStore((s) => s.project.settings.inputUnit)
  const updateCabinet = useStore((s) => s.updateCabinet)
  const t = c.top
  const setTop = (patch: Partial<Worktop>) => t && updateCabinet(c.id, { top: { ...t, ...patch } })
  const setCut = (id: string, patch: Partial<Worktop['cutouts'][number]>) =>
    t && setTop({ cutouts: t.cutouts.map((x) => (x.id === id ? { ...x, ...patch } : x)) })
  /** The compartments along the top of a leg, left to right: what a cut-out can sit over. */
  const topCells = (k: number) =>
    c.legs[k]
      ? layOut(c.legs[k], { x: 0, y: 0, w: p.legs[k].width, h: c.height })
          .cells.filter((l) => l.rect.y < 1)
          .sort((a, b) => a.rect.x - b.rect.x)
      : []
  /** A new cut-out goes over the compartment tapped on the drawing, or in the middle of the first leg. */
  const addCut = (kind: CutoutKind) => {
    if (!t) return
    const leg = sel && p.legs[sel.leg] ? sel.leg : 0
    const front = c.legs[leg]
    const over = sel && front ? layOut(front, { x: 0, y: 0, w: p.legs[leg].width, h: c.height }).cells.find((l) => samePath(l.path, sel.path)) : null
    const x = over ? over.rect.x + over.rect.w / 2 : p.legs[leg].width / 2
    setTop({ cutouts: [...t.cutouts, { id: uid(), kind, leg, x: Math.round(x), ...CUTOUT_SIZES[kind], mount: kind === 'hob' ? 'top' : 'under' }] })
  }
  return (
    <div className="stack">
      <Header c={c} step="top" />
      <Field label="Top">
        <Segmented
          value={t ? 'stone' : 'none'}
          options={[
            { value: 'none', label: 'None' },
            { value: 'stone', label: 'Stone or other' },
          ]}
          onChange={(v) => updateCabinet(c.id, { top: v === 'none' ? null : newWorktop() })}
        />
      </Field>
      {t && (
        <>
          <div className="grid2">
            <Field label="Material">
              <select value={t.material} onChange={(e) => setTop({ material: e.target.value as Worktop['material'] })}>
                {STONE_MATERIALS.map((m) => (
                  <option key={m.value} value={m.value}>
                    {m.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Thickness">
              <LengthInput value={t.thickness} unit={unit} onChange={(v) => v && setTop({ thickness: v })} />
            </Field>
            <Field label="Overhang" hint="Past the fronts.">
              <LengthInput value={t.overhang} unit={unit} onChange={(v) => setTop({ overhang: v ?? 0 })} />
            </Field>
            <Field label="Upstand" hint="Up the wall behind; blank for none.">
              <LengthInput value={t.upstand || null} unit={unit} onChange={(v) => setTop({ upstand: v ?? 0 })} />
            </Field>
          </div>
          <FinishFields label="Colour" value={t.finish} onChange={(f) => setTop({ finish: f })} />
          <h3>Cut-outs</h3>
          <p className="muted small">
            For a sink, hob or basin: take the cut-out size from its spec sheet. Tap a compartment on the drawing first to
            add one centred over it.
          </p>
          {t.cutouts.map((x) => {
            const leg = p.legs[x.leg]
            const cells = leg ? topCells(x.leg) : []
            const under = leg ? cellUnder(c, p, x) : null
            const overIndex = cells.findIndex((l) => samePath(l.path, under?.path ?? null))
            return (
              <div key={x.id} className="opening">
                <div className="row between">
                  <b>{CUTOUT_LABEL[x.kind]}</b>
                  <button className="link danger" onClick={() => setTop({ cutouts: t.cutouts.filter((y) => y.id !== x.id) })}>
                    Remove
                  </button>
                </div>
                {p.legs.length > 1 && (
                  <Field label="Along">
                    <select value={x.leg} onChange={(e) => setCut(x.id, { leg: Number(e.target.value), x: Math.round(p.legs[Number(e.target.value)].width / 2) })}>
                      {p.legs.map((l, k) => (
                        <option key={k} value={k}>
                          Wall {l.wallNo}
                        </option>
                      ))}
                    </select>
                  </Field>
                )}
                {cells.length > 1 && (
                  <Field label="Centred over">
                    <select
                      value={overIndex}
                      onChange={(e) => {
                        const l = cells[Number(e.target.value)]
                        if (l) setCut(x.id, { x: Math.round(l.rect.x + l.rect.w / 2) })
                      }}
                    >
                      {overIndex < 0 && <option value={-1}>—</option>}
                      {cells.map((l, k) => (
                        <option key={k} value={k}>
                          {k + 1}. {FRONT_LABEL[l.cell.front]}, {Math.round(l.rect.w)} wide
                        </option>
                      ))}
                    </select>
                  </Field>
                )}
                <Field label="Centre, from the left end of the front">
                  <LengthInput value={x.x} unit={unit} onChange={(v) => v != null && setCut(x.id, { x: v })} />
                </Field>
                <div className="grid2">
                  <Field label="Width">
                    <LengthInput value={x.width} unit={unit} onChange={(v) => v && setCut(x.id, { width: v })} />
                  </Field>
                  <Field label="Front to back">
                    <LengthInput value={x.depth} unit={unit} onChange={(v) => v && setCut(x.id, { depth: v })} />
                  </Field>
                </div>
                {x.kind !== 'hob' && (
                  <Field label="Mounted">
                    <Segmented
                      value={x.mount}
                      options={[
                        { value: 'under', label: 'Under the top' },
                        { value: 'top', label: 'On top' },
                      ]}
                      onChange={(m) => setCut(x.id, { mount: m })}
                    />
                  </Field>
                )}
              </div>
            )
          })}
          <div className="row wrap">
            {(['sink', 'hob', 'basin'] as CutoutKind[]).map((k) => (
              <button key={k} className="btn small" onClick={() => addCut(k)}>
                + {CUTOUT_LABEL[k]}
              </button>
            ))}
          </div>
        </>
      )}
      <Warnings c={c} solved={solved} p={p} />
      <Nav c={c} step="top" />
    </div>
  )
}

/** Name or code and colour of a finish, with ones already used in this layout to pick from. */
function FinishFields({ label, value, onChange }: { label: string; value: Finish; onChange: (f: Finish) => void }) {
  const cabinets = useStore((s) => s.project.cabinets)
  const used = useMemo(() => {
    const seen = new Map<string, Finish>()
    for (const c of cabinets)
      for (const f of [c.fronts, c.carcass, c.top?.finish]) if (f) seen.set(`${f.name}|${f.color}`, f)
    return [...seen.values()]
  }, [cabinets])
  const others = used.filter((f) => f.name !== value.name || f.color !== value.color)
  return (
    <div className="stack tight">
      <span className="field-label">{label}</span>
      <div className="finish-row">
        <input placeholder="Name or code, e.g. Oak 3012" value={value.name} onChange={(e) => onChange({ ...value, name: e.target.value })} />
        <ColorInput value={value.color} onChange={(color) => onChange({ ...value, color })} />
      </div>
      {others.length > 0 && (
        <div className="row wrap">
          {others.map((f) => (
            <button key={`${f.name}|${f.color}`} className="chip" onClick={() => onChange(f)} title="Use this finish">
              <span className="swatch" style={{ background: f.color }} />
              {f.name || f.color}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function FinishStep({ c }: { c: Cabinet }) {
  const updateCabinet = useStore((s) => s.updateCabinet)
  return (
    <div className="stack">
      <Header c={c} step="finish" />
      <FinishFields label="Doors, drawer fronts and panels" value={c.fronts} onChange={(f) => updateCabinet(c.id, { fronts: f })} />
      <FinishFields label="Carcass (inside and edges)" value={c.carcass} onChange={(f) => updateCabinet(c.id, { carcass: f })} />
      <Field label="Handles" hint="Profile is a groove or J-pull along the top of the fronts.">
        <Segmented value={c.handle} options={HANDLES} onChange={(h) => updateCabinet(c.id, { handle: h })} />
      </Field>
      <Nav c={c} step="finish" />
    </div>
  )
}

function ReviewStep({ c, solved, p }: { c: Cabinet; solved: Solved; p: Placement }) {
  const unit = useStore((s) => s.project.settings.inputUnit)
  const cabinets = useStore((s) => s.project.cabinets)
  const { addCabinet, setCabinetEdit } = useStore.getState()
  const m = cabinetMaterials(c, p)
  const duplicate = () => {
    const names = cabinets.map((x) => x.name)
    let name = `${c.name} (copy)`
    for (let n = 2; names.includes(name); n++) name = `${c.name} (copy ${n})`
    const id = addCabinet({ ...c, name, top: c.top && { ...c.top, cutouts: c.top.cutouts.map((x) => ({ ...x, id: uid() })) } })
    setCabinetEdit({ id, step: 'walls' })
  }
  return (
    <div className="stack">
      <Header c={c} step="review" />
      <p className="muted">
        {cabinetKindInfo(c.kind).label} · {shapeLabel(p.legs.length)} in {p.room.room.name}, along {p.legs.length === 1 ? 'wall' : 'walls'}{' '}
        {p.legs.map((l) => l.wallNo).join(', ')}
      </p>
      <dl className="facts">
        <dt>Fronts</dt>
        <dd>
          {p.legs.map((l) => Math.round(l.width).toLocaleString()).join(' + ')} mm wide · {frontsText(m) || 'no doors or drawers'}
        </dd>
        <dt>Size</dt>
        <dd>
          {mm(c.height)} high, {mm(c.depth)} deep; top at {formatLength(cabinetTop(c), unit)}
        </dd>
        {c.top && (
          <>
            <dt>Top</dt>
            <dd>
              {STONE_MATERIALS.find((s) => s.value === c.top!.material)?.label} {c.top.thickness} mm
              {c.top.finish.name && `, ${c.top.finish.name}`}
              {m.top && ` · ${fmtM(m.top.length)} along the walls`}
            </dd>
          </>
        )}
        <dt>Finish</dt>
        <dd>
          <span className="swatch" style={{ background: c.fronts.color }} />
          {c.fronts.name || c.fronts.color} fronts, <span className="swatch" style={{ background: c.carcass.color }} />
          {c.carcass.name || c.carcass.color} carcass
        </dd>
      </dl>
      <Warnings c={c} solved={solved} p={p} />
      <h3>Materials</h3>
      <MaterialsTable m={m} />
      <p className="muted small">
        Board by area, with nothing added for offcuts: allow more when ordering. “Without the inside” is the box, backs, fronts
        and plinth; the inside is dividers, shelves and drawer boxes.
      </p>
      <div className="row wrap">
        <button className="btn small" onClick={duplicate}>
          Duplicate
        </button>
      </div>
      <Nav c={c} step="review" />
    </div>
  )
}
