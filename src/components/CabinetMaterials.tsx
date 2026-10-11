import { allBoard, innerBoard, outerBoard, sheetsFor, type CabinetMaterials } from '../cabinets/materials'
import type { ApplianceKind, CutoutKind } from '../types'
import { APPLIANCE_LABEL, CUTOUT_LABEL } from './CabinetDrawings'

export const fmtM2 = (mm2: number) => `${(mm2 / 1e6).toFixed(2)} m²`
export const fmtM = (mm: number) => `${(mm / 1000).toFixed(2)} m`
export const fmtFt = (mm: number) => `${(mm / 304.8).toFixed(1)} ft`

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

/** e.g. "1 sink, 1 hob" */
export const cutoutsText = (c: Partial<Record<CutoutKind, number>>) =>
  (Object.entries(c) as [CutoutKind, number][]).map(([k, n]) => `${n} ${CUTOUT_LABEL[k].toLowerCase()}`).join(', ')

/** e.g. "oven, 2 dishwashers" */
export const appliancesText = (a: Partial<Record<ApplianceKind, number>>) =>
  (Object.entries(a) as [ApplianceKind, number][])
    .map(([k, n]) => (n === 1 ? APPLIANCE_LABEL[k].toLowerCase() : `${n} ${APPLIANCE_LABEL[k].toLowerCase()}s`))
    .join(', ')

/** e.g. "4 doors · 6 drawers · oven" */
export function frontsText(m: CabinetMaterials) {
  return [m.doors && plural(m.doors, 'door'), m.drawers && plural(m.drawers, 'drawer'), appliancesText(m.appliances)].filter(Boolean).join(' · ')
}

/** Board, stone and hardware a cabinet (or several) takes. */
export function MaterialsTable({ m }: { m: CabinetMaterials }) {
  const b = m.board
  const row = (label: string, mm2: number) =>
    mm2 > 0 ? (
      <tr>
        <td className="indent">{label}</td>
        <td className="num">{fmtM2(mm2)}</td>
        <td />
      </tr>
    ) : null
  const count = (label: string, n: number, extra?: string) =>
    n > 0 ? (
      <tr>
        <td className="indent">{label}</td>
        <td className="num" colSpan={2}>
          {n}
          {extra && <span className="muted"> {extra}</span>}
        </td>
      </tr>
    ) : null
  return (
    <div className="table-wrap">
      <table className="table compact materials">
        <thead>
          <tr>
            <th>Board</th>
            <th className="num">Area</th>
            <th className="num">8×4 ft sheets</th>
          </tr>
        </thead>
        <tbody>
          {row('Box: ends, top and bottom', b.shell)}
          {row('Backs', b.back)}
          {row('Doors, drawer fronts and panels', b.fronts)}
          {row('Plinth', b.plinth)}
          <tr className="subtotal">
            <td>Without the inside</td>
            <td className="num">{fmtM2(outerBoard(b))}</td>
            <td className="num">{sheetsFor(outerBoard(b))}</td>
          </tr>
          {row('Dividers and fixed shelves', b.dividers)}
          {row('Adjustable shelves', b.shelves)}
          {row('Drawer boxes', b.drawerBoxes)}
          {innerBoard(b) > 0 && (
            <tr className="subtotal">
              <td>The inside</td>
              <td className="num">{fmtM2(innerBoard(b))}</td>
              <td className="num">{sheetsFor(innerBoard(b))}</td>
            </tr>
          )}
          <tr className="subtotal total">
            <td>All board</td>
            <td className="num">{fmtM2(allBoard(b))}</td>
            <td className="num">{sheetsFor(allBoard(b))}</td>
          </tr>
        </tbody>
        {m.top && (
          <tbody>
            <tr>
              <th colSpan={3}>Top</th>
            </tr>
            <tr>
              <td className="indent">Area (cut-outs included)</td>
              <td className="num" colSpan={2}>
                {fmtM2(m.top.area)}
              </td>
            </tr>
            <tr>
              <td className="indent">Length along the walls</td>
              <td className="num" colSpan={2}>
                {fmtM(m.top.length)} <span className="muted">({fmtFt(m.top.length)})</span>
              </td>
            </tr>
            <tr>
              <td className="indent">Front edge</td>
              <td className="num" colSpan={2}>
                {fmtM(m.top.frontEdge)}
              </td>
            </tr>
            {m.top.upstand > 0 && (
              <tr>
                <td className="indent">Upstand</td>
                <td className="num" colSpan={2}>
                  {fmtM2(m.top.upstand)}
                </td>
              </tr>
            )}
            {Object.keys(m.top.cutouts).length > 0 && (
              <tr>
                <td className="indent">Cut-outs</td>
                <td className="num" colSpan={2}>
                  {cutoutsText(m.top.cutouts)}
                </td>
              </tr>
            )}
          </tbody>
        )}
        <tbody>
          <tr>
            <th colSpan={3}>Fittings</th>
          </tr>
          {count('Doors', m.doors, m.slidingDoors ? `(${m.slidingDoors} sliding)` : undefined)}
          {count('Hinges', m.hinges)}
          {count('Lift-up stays', m.liftUps)}
          {count('Drawers (pairs of runners)', m.drawers)}
          {count('Handles', m.handles)}
          {count('Adjustable shelves', m.shelves)}
          {count('Hanging rails', m.rails)}
          {m.plinthLength > 0 && (
            <tr>
              <td className="indent">Plinth length</td>
              <td className="num" colSpan={2}>
                {fmtM(m.plinthLength)}
              </td>
            </tr>
          )}
          {Object.keys(m.appliances).length > 0 && (
            <tr>
              <td className="indent">Spaces for</td>
              <td className="num" colSpan={2}>
                {appliancesText(m.appliances)}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  )
}
