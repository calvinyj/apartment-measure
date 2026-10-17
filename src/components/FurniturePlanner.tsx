import { useEffect, useMemo, useRef, useState } from 'react'
import {
  FURNITURE_NAMES,
  formatPrice,
  furnitureList,
  furnitureSpot,
  furnitureSpots,
  itemHref,
  linkSite,
  sizeLabel,
  spotKey,
  statusTotals,
} from '../furniture'
import { offsetFrom, roomAnchors, roomAt } from '../geometry/lights'
import { add, dist, scale, sub } from '../geometry/vec'
import { useStore } from '../store'
import { ORDER_STATUSES, type FurnitureItem, type Vec2 } from '../types'
import { CabinetLayer, placeCabinets } from './CabinetLayer'
import { Field, LengthInput, NumberInput, PlanImageToggle, Segmented, useRememberedCheck, useSolved, useWidth } from './common'
import { FloorPlan, useFloorPlan } from './FloorPlan'
import { cardAside, cardWidth, furnitureBoxes, FurnitureLayer, planPoints, StatusIcon, StatusSummary } from './Furniture'
import { PlanView, type PointerInfo } from './PlanView'

type Tool = 'select' | 'add'

/** A spot's mark (`fs:<spot key>`) or an item's card (`fc:<id>`) under a pointer, from its `data-handle`. */
function parseHandle(handle: string | null): { kind: 'spot' | 'card'; id: string } | null {
  const m = handle?.match(/^(fs|fc):(.+)$/)
  return m ? { kind: m[1] === 'fs' ? 'spot' : 'card', id: m[2] } : null
}

export function FurniturePlanner() {
  const project = useStore((s) => s.project)
  const { addFurniture, updateFurniture, removeFurniture } = useStore.getState()
  const solved = useSolved()
  const plan = useFloorPlan(solved)
  const anchors = useMemo(() => roomAnchors(solved), [solved])
  const spots = useMemo(() => furnitureSpots(anchors, project.furniture), [anchors, project.furniture])
  const points = useMemo(() => (plan ? planPoints(plan, solved) : []), [plan, solved])
  const placedCabinets = useMemo(() => placeCabinets(project.cabinets, solved), [project.cabinets, solved])
  const [tool, setTool] = useState<Tool>('select')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  /** the item just added, whose name to type */
  const [fresh, setFresh] = useState<string | null>(null)
  const [labels, setLabels] = useState(true)
  const [dims, setDims] = useState(false)
  const [cabinets, setCabinets] = useRememberedCheck('furniture:cabinets', true)
  const [error, setError] = useState<string | null>(null)
  const [canvasRef, canvasWidth] = useWidth()
  const keRef = useRef(1)
  // The items being dragged (all those at a spot, or one by its card), and where the pointer was from them.
  const drag = useRef<{ ids: string[]; grab: Vec2 | null } | null>(null)

  const mmPerPx = solved.mmPerPx
  const selected = project.furniture.find((f) => f.id === selectedId) ?? null

  const remove = (id: string) => {
    removeFurniture(id)
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

  const place = (at: Pick<FurnitureItem, 'roomId' | 'x' | 'y'>) => {
    const id = addFurniture({
      ...at,
      name: '',
      model: '',
      url: '',
      width: null,
      depth: null,
      height: null,
      price: null,
      status: 'pending',
    })
    setSelectedId(id)
    setFresh(id)
  }

  const onTap = (raw: Vec2, info: PointerInfo) => {
    setError(null)
    const hit = parseHandle(info.handle)
    if (hit?.kind === 'card') return setSelectedId(hit.id)
    if (hit?.kind === 'spot') {
      const spot = spots.find((s) => s.key === hit.id)
      if (!spot) return
      // Another item at the same spot, e.g. a TV on its console.
      const f = spot.items[0]
      if (tool === 'add') return place({ roomId: f.roomId, x: f.x, y: f.y })
      // Tapping again goes on to the next item there.
      const i = spot.items.findIndex((x) => x.id === selectedId)
      return setSelectedId(spot.items[(i + 1) % spot.items.length].id)
    }
    if (tool === 'select') return setSelectedId(null)
    const p = toMm(raw)
    const r = roomAt(solved, p)
    if (!r) return setError('Tap inside a room to place it.')
    place({ roomId: r.room.id, ...offsetFrom(anchors.get(r.room.id)!, p) })
  }

  const onHandleDown = (handle: string) => {
    const hit = parseHandle(handle)
    if (hit?.kind === 'spot') {
      const spot = spots.find((s) => s.key === hit.id)
      if (!spot) return false
      drag.current = { ids: spot.items.map((f) => f.id), grab: null }
      return true
    }
    // A card drags only once its item is selected (pressing on another pans, as on the plan), and takes
    // just that item to where the pointer is.
    if (hit?.kind !== 'card' || hit.id !== selectedId) return false
    drag.current = { ids: [hit.id], grab: { x: 0, y: 0 } }
    return true
  }

  const onDrag = (raw: Vec2, info: PointerInfo) => {
    const d = drag.current
    const first = d && useStore.getState().project.furniture.find((f) => d.ids.includes(f.id))
    const at = first && furnitureSpot(anchors, first)
    if (!d || !first || !at) return
    const p = toMm(raw)
    d.grab ??= sub(at, p)
    const q = add(p, d.grab)
    // Dropped on another spot, it shares it (hold Shift to place it freely).
    if (!info.shiftKey && !info.altKey) {
      const near = spots
        .filter((s) => !s.items.every((f) => d.ids.includes(f.id)) && dist(s.at, q) < 12 / keRef.current)
        .sort((a, b) => dist(a.at, q) - dist(b.at, q))[0]
      if (near) {
        const { roomId, x, y } = near.items[0]
        if (spotKey(first) !== near.key) updateFurniture(d.ids, { roomId, x, y })
        return
      }
    }
    // Dragged into another room, it belongs there now.
    const r = roomAt(solved, q) ?? solved.byId.get(first.roomId)
    if (r) updateFurniture(d.ids, { roomId: r.room.id, ...offsetFrom(anchors.get(r.room.id)!, q) })
  }

  const onDragEnd = () => {
    drag.current = null
  }

  const pickTool = (t: Tool) => {
    setTool(t)
    setError(null)
  }

  const cardW = cardWidth(canvasWidth || 1000)

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
            <button
              className={tool === 'add' ? 'on' : ''}
              onClick={() => pickTool('add')}
              role="radio"
              aria-checked={tool === 'add'}
              title="Tap where it goes in a room, or a dot to add another item at that spot"
            >
              + New item
            </button>
          </div>
          <label className="check small">
            <input type="checkbox" checked={labels} onChange={(e) => setLabels(e.target.checked)} /> Labels
          </label>
          <label className="check small">
            <input type="checkbox" checked={dims} onChange={(e) => setDims(e.target.checked)} /> Dimensions
          </label>
          {project.cabinets.length > 0 && (
            <label className="check small">
              <input type="checkbox" checked={cabinets} onChange={(e) => setCabinets(e.target.checked)} /> Cabinets
            </label>
          )}
          <PlanImageToggle />
        </div>
        <div className="band-canvas" ref={canvasRef}>
          <PlanView
            image={project.image}
            showImage={project.settings.showPlanImage}
            fit={plan.fit}
            fitKey="furniture"
            // Room for the cards from the start, so the plan doesn't jump when the first is added.
            fitAside={cardAside(cardW)}
            cursor={tool === 'add' ? 'crosshair' : 'default'}
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
                    avoid={furnitureBoxes(spots, ke)}
                    onFloor={cabinets && <CabinetLayer placed={placedCabinets} />}
                  />
                  <FurnitureLayer
                    spots={spots}
                    points={points}
                    ke={ke}
                    unit={project.settings.inputUnit}
                    cardW={cardW}
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
          <FurnitureInspector
            key={selected.id}
            item={selected}
            fresh={fresh === selected.id}
            onAddHere={() => place({ roomId: selected.roomId, x: selected.x, y: selected.y })}
            onDone={() => setSelectedId(null)}
            onDelete={() => remove(selected.id)}
          />
        ) : (
          <FurnitureOverview onSelect={setSelectedId} />
        )}
      </aside>
    </div>
  )
}

function FurnitureInspector({
  item,
  fresh,
  onAddHere,
  onDone,
  onDelete,
}: {
  item: FurnitureItem
  /** just added: its name is typed first */
  fresh: boolean
  onAddHere: () => void
  onDone: () => void
  onDelete: () => void
}) {
  const unit = useStore((s) => s.project.settings.inputUnit)
  const furniture = useStore((s) => s.project.furniture)
  const room = useStore((s) => s.project.rooms.find((r) => r.id === item.roomId))
  const updateFurniture = useStore((s) => s.updateFurniture)
  const set = (patch: Partial<FurnitureItem>) => updateFurniture(item.id, patch)
  // Names already used, then the usual ones, each once whatever its case.
  const names = [...furniture.map((f) => f.name.trim()).filter(Boolean), ...FURNITURE_NAMES].filter(
    (u, i, all) => all.findIndex((v) => v.toLowerCase() === u.toLowerCase()) === i,
  )
  const others = furniture.filter((f) => f.id !== item.id && spotKey(f) === spotKey(item))
  const href = itemHref(item.url)
  const size = (key: 'width' | 'depth' | 'height') => (mm: number | null) => {
    if (mm != null && mm < 10) return
    const patch: Partial<FurnitureItem> = {}
    patch[key] = mm == null ? null : Math.round(mm)
    set(patch)
  }
  return (
    <div className="stack">
      <div className="row between">
        <h2>{item.name.trim() || 'New item'}</h2>
        <span className="muted">{room?.name}</span>
      </div>
      <Field label="Name">
        <input
          value={item.name}
          placeholder="e.g. Sofa, fridge"
          list="furniture-names"
          autoFocus={fresh}
          onChange={(e) => set({ name: e.target.value })}
        />
        <datalist id="furniture-names">
          {names.map((n) => (
            <option key={n} value={n} />
          ))}
        </datalist>
      </Field>
      <Field label="Status">
        <Segmented value={item.status} options={ORDER_STATUSES} onChange={(status) => set({ status })} />
      </Field>
      <Field label="Model" hint="Optional.">
        <input value={item.model} placeholder="Brand and model" onChange={(e) => set({ model: e.target.value })} />
      </Field>
      <Field
        label="Link"
        hint={
          href ? (
            <a href={href} target="_blank" rel="noopener noreferrer">
              Open on {linkSite(item.url)} ↗
            </a>
          ) : item.url.trim() ? (
            'That isn’t a web address.'
          ) : (
            'Optional: where to see or buy it.'
          )
        }
      >
        <input
          type="url"
          inputMode="url"
          autoComplete="off"
          value={item.url}
          placeholder="https://…"
          onChange={(e) => set({ url: e.target.value })}
        />
      </Field>
      <div className="grid3">
        <Field label="Width">
          <LengthInput value={item.width} onChange={size('width')} unit={unit} />
        </Field>
        <Field label="Depth">
          <LengthInput value={item.depth} onChange={size('depth')} unit={unit} />
        </Field>
        <Field label="Height">
          <LengthInput value={item.height} onChange={size('height')} unit={unit} />
        </Field>
      </div>
      <p className="field-hint">Optional: across, front to back, and high, from its spec sheet.</p>
      <Field label="Reference price" hint="Optional. The report adds them up.">
        <NumberInput value={item.price} onChange={(price) => set({ price })} unit="RM" />
      </Field>
      {others.length > 0 && (
        <p className="muted small">
          Shares its spot with {others.map((f) => f.name.trim() || 'an unnamed item').join(', ')}. Drag its card to
          move it on its own.
        </p>
      )}
      <p className="muted small">
        Drag its dot to move it{others.length > 0 && ', with everything at that spot'}. Drop it on another dot to
        share that spot (hold Shift to place it freely).
      </p>
      <div className="row wrap">
        <button className="btn primary" onClick={onDone}>
          Done
        </button>
        <button className="btn" onClick={onAddHere} title="Another item at the same spot, e.g. a TV on its console">
          Add another here
        </button>
        <button className="btn danger" onClick={onDelete}>
          Delete
        </button>
      </div>
    </div>
  )
}

/** What there is room by room, and what it comes to. */
function FurnitureOverview({ onSelect }: { onSelect: (id: string) => void }) {
  const rooms = useStore((s) => s.project.rooms)
  const furniture = useStore((s) => s.project.furniture)
  const unit = useStore((s) => s.project.settings.inputUnit)
  const list = furnitureList(rooms, furniture)
  const totals = statusTotals(furniture)
  return (
    <div className="stack">
      <h2>Furniture &amp; appliances</h2>
      <p>
        Pick <strong>New item</strong> above the plan, then tap where it goes in a room. Tap a dot or a card to open
        it. Several items can share a spot, e.g. a TV on its console: with <strong>New item</strong>, tap the dot
        that’s there.
      </p>
      <ul className="light-key">
        {ORDER_STATUSES.map((s) => (
          <li key={s.value}>
            <StatusIcon status={s.value} />
            <span>
              <strong>{s.label}</strong>{' '}
              <span className="muted">
                {s.value === 'pending' ? 'Still to order.' : s.value === 'ordered' ? 'Ordered, not here yet.' : 'Here.'}
              </span>
            </span>
          </li>
        ))}
      </ul>
      {list.length === 0 ? (
        <p className="muted">No furniture or appliances yet.</p>
      ) : (
        <>
          <div className="table-wrap">
            <table className="table furniture-list">
              <thead>
                <tr>
                  <th>Item</th>
                  <th>Room</th>
                  <th className="num">Price</th>
                </tr>
              </thead>
              <tbody>
                {list.map(({ item, room }) => (
                  <tr key={item.id} className="clickable" onClick={() => onSelect(item.id)}>
                    <td>
                      <span className="furniture-item">
                        <StatusIcon status={item.status} />
                        {item.name.trim() || <span className="muted">Unnamed</span>}
                      </span>
                      {(item.model.trim() || sizeLabel(item, unit)) && (
                        <div className="muted small">
                          {[item.model.trim(), sizeLabel(item, unit)].filter(Boolean).join(' · ')}
                        </div>
                      )}
                    </td>
                    <td>{room.name}</td>
                    <td className="num">{item.price != null ? formatPrice(item.price) : <span className="muted">–</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <StatusSummary totals={totals} />
        </>
      )}
    </div>
  )
}
