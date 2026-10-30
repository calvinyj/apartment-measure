import { cabinetTop, cabinetWarnings } from '../cabinets/checks'
import { addMaterials, allBoard, cabinetMaterials, innerBoard, outerBoard, type CabinetMaterials } from '../cabinets/materials'
import { placeCabinet, shapeLabel, type Placement } from '../cabinets/placement'
import type { Solved } from '../geometry/solve'
import { useStore } from '../store'
import { cabinetKindInfo, STONE_MATERIALS, type Cabinet, type Project } from '../types'
import { Elevation, TopView } from './CabinetDrawings'
import { appliancesText, cutoutsText, fmtM2, frontsText, MaterialsTable } from './CabinetMaterials'

export interface CabinetRow {
  c: Cabinet
  p: Placement | null
  m: CabinetMaterials | null
}

/** Each cabinet placed and costed in materials, in room order; one whose walls are gone has neither. */
export function cabinetRows(project: Project, solved: Solved): CabinetRow[] {
  const order = new Map(project.rooms.map((r, i) => [r.id, i]))
  return [...project.cabinets]
    .sort((a, b) => (order.get(a.walls.roomId) ?? Infinity) - (order.get(b.walls.roomId) ?? Infinity))
    .map((c) => {
      const res = placeCabinet(solved, c)
      return res.ok ? { c, p: res.placement, m: cabinetMaterials(c, res.placement) } : { c, p: null, m: null }
    })
}

const topText = (c: Cabinet) =>
  c.top ? `${STONE_MATERIALS.find((s) => s.value === c.top!.material)?.label} ${c.top.thickness} mm${c.top.finish.name ? `, ${c.top.finish.name}` : ''}` : ''

export const finishText = (c: Cabinet) => `${c.fronts.name || c.fronts.color} fronts, ${c.carcass.name || c.carcass.color} carcass`

/** Where it is, e.g. "Kitchen, wall 2, 3". */
export const placeText = (p: Placement | null) => (p ? `${p.room.room.name}, wall ${p.legs.map((l) => l.wallNo).join(', ')}` : 'not on a wall')

/** e.g. "Base cabinet · L-shaped, 2,400 + 1,800 mm · 720 high × 560 deep, top at 870 mm · 4 doors · Quartz 20 mm with 1 sink · board 9.12 m²" */
export function cabinetSummary({ c, p, m }: CabinetRow) {
  const top = c.top && `${topText(c)}${m?.top && Object.keys(m.top.cutouts).length > 0 ? ` with ${cutoutsText(m.top.cutouts)}` : ''}`
  return [
    cabinetKindInfo(c.kind).label,
    p && `${shapeLabel(p.legs.length)}, ${p.legs.map((l) => Math.round(l.width).toLocaleString()).join(' + ')} mm`,
    `${c.height} high × ${c.depth} deep, top at ${cabinetTop(c)} mm`,
    m && frontsText(m),
    top,
    m && `board ${fmtM2(allBoard(m.board))}`,
  ]
    .filter(Boolean)
    .join(' · ')
}

/** CSV rows: one per cabinet, then the materials of all of them. */
export function cabinetCsv(project: Project, solved: Solved): (string | number)[][] {
  const rows = cabinetRows(project, solved)
  if (!rows.length) return []
  const total = addMaterials(rows.flatMap((r) => (r.m ? [r.m] : [])))
  const m2 = (mm2: number) => (mm2 / 1e6).toFixed(2)
  return [
    [],
    ['Cabinet', 'Room', 'Kind', 'Shape', 'Walls', 'Front widths (mm)', 'Height (mm)', 'Depth (mm)', 'Top from floor (mm)', 'Fronts', 'Top', 'Cut-outs', 'Finish'],
    ...rows.map(({ c, p, m }) => [
      c.name,
      p?.room.room.name ?? '',
      cabinetKindInfo(c.kind).label,
      p ? shapeLabel(p.legs.length) : '',
      p ? p.legs.map((l) => l.wallNo).join(' ') : 'not on a wall',
      p ? p.legs.map((l) => Math.round(l.width)).join(' + ') : '',
      c.height,
      c.depth,
      cabinetTop(c),
      m ? frontsText(m) : '',
      topText(c),
      m?.top ? cutoutsText(m.top.cutouts) : '',
      finishText(c),
    ]),
    [],
    ['Cabinet materials (all)', 'Quantity'],
    ['Board without the inside (m2)', m2(outerBoard(total.board))],
    ['Board, the inside (m2)', m2(innerBoard(total.board))],
    ['All board (m2)', m2(allBoard(total.board))],
    ...(total.top
      ? [
          ['Top (m2)', m2(total.top.area)],
          ['Top along the walls (m)', (total.top.length / 1000).toFixed(2)],
          ['Top front edge (m)', (total.top.frontEdge / 1000).toFixed(2)],
          ['Upstand (m2)', m2(total.top.upstand)],
          ['Cut-outs', cutoutsText(total.top.cutouts)],
        ]
      : []),
    ['Doors', total.doors],
    ['Hinges', total.hinges],
    ['Lift-up stays', total.liftUps],
    ['Drawers', total.drawers],
    ['Handles', total.handles],
    ['Adjustable shelves', total.shelves],
    ['Hanging rails', total.rails],
    ['Plinth (m)', (total.plinthLength / 1000).toFixed(2)],
    ['Spaces for', appliancesText(total.appliances)],
  ]
}

/** The report's cabinets: each one drawn, with what to check, then what they all take to build. */
export function CabinetsReport({ solved }: { solved: Solved }) {
  const project = useStore((s) => s.project)
  const unit = project.settings.inputUnit
  const setCabinetEdit = useStore((s) => s.setCabinetEdit)
  const setTab = useStore((s) => s.setTab)
  const rows = cabinetRows(project, solved)
  const total = addMaterials(rows.flatMap((r) => (r.m ? [r.m] : [])))
  const open = (c: Cabinet) => {
    setCabinetEdit({ id: c.id, step: 'review' })
    setTab('cabinets')
  }
  return (
    <>
      {rows.map(({ c, p, m }) => {
        const warnings = p ? cabinetWarnings(solved, c, p, unit) : []
        return (
          <div key={c.id} className="cab-report">
            <div className="row between">
              <b>
                <button className="link" onClick={() => open(c)}>
                  {c.name}
                </button>
              </b>
              <span className="muted small">{placeText(p)}</span>
            </div>
            <p className="small">{cabinetSummary({ c, p, m })}</p>
            <p className="small muted">
              <span className="swatch" style={{ background: c.fronts.color }} />
              {finishText(c)}
            </p>
            {p && (
              <div className="cab-report-drawings">
                <Elevation cabinet={c} placement={p} />
                <TopView solved={solved} cabinet={c} placement={p} />
              </div>
            )}
            {warnings.length > 0 && (
              <div className="callout warn">
                {warnings.map((w, i) => (
                  <div key={i}>{w}</div>
                ))}
              </div>
            )}
          </div>
        )
      })}
      <h3>Materials, all cabinets</h3>
      <MaterialsTable m={total} />
      <p className="muted small">
        Approximate: board by area with nothing added for offcuts, as if each straight run were one box with dividers. “Without
        the inside” is the box, backs, fronts and plinth; the inside is dividers, shelves and drawer boxes.
      </p>
    </>
  )
}
