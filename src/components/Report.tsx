import { useState } from 'react'
import { acZones } from '../ac'
import { formatFacing, roomFacing } from '../geometry/facing'
import { downloadFile, useStore } from '../store'
import { roomTypeInfo } from '../types'
import { formatArea, formatLength, formatSqft, fmtInt, M2_TO_SQFT, m2 } from '../units'
import { useSolved } from './common'

const pct = (x: number) => `${x >= 0 ? '+' : ''}${(x * 100).toFixed(1)}%`

export function Report() {
  const project = useStore((s) => s.project)
  const setAdvertised = useStore((s) => s.setAdvertised)
  const setTab = useStore((s) => s.setTab)
  const solved = useSolved()
  const settings = project.settings
  const zones = acZones(solved, settings)
  const [advText, setAdvText] = useState(project.advertised ? String(project.advertised.value) : '')

  if (!solved.rooms.length || !solved.mmPerPx) {
    return (
      <div className="empty">
        <h2>No rooms yet</h2>
        <p>Set the scale and trace rooms on the Plan tab, then measure them.</p>
      </div>
    )
  }

  const complete = solved.rooms.filter((r) => r.status === 'complete').length
  const unmeasured = solved.rooms.filter((r) => r.status !== 'complete')
  const shaky = solved.rooms.filter((r) => r.status !== 'empty' && r.closure.checkable !== 'none' && !r.closureOk)
  const adv = project.advertised
  const advMm2 = adv ? (adv.unit === 'sqft' ? adv.value / M2_TO_SQFT : adv.value) * 1e6 : null
  const hasBalcony = solved.rooms.some((r) => r.room.type === 'balcony')

  const exportCsv = () => {
    const rows = [
      ['Room', 'Type', 'Faces', 'Net area (m2)', 'Net area (ft2)', 'Ceiling (mm)', 'Volume (m3)', 'Walls measured', 'Closure error (mm)'],
      ...solved.rooms.map((r) => [
        r.room.name,
        roomTypeInfo(r.room.type).label,
        formatFacing(roomFacing(solved, r)),
        m2(r.area).toFixed(2),
        (m2(r.area) * M2_TO_SQFT).toFixed(1),
        Math.round(r.height),
        ((r.area * r.height) / 1e9).toFixed(2),
        `${r.measuredCount}/${r.wallCount}`,
        r.status === 'empty' ? '' : Math.round(r.closure.measuredError),
      ]),
      [],
      ['Total net', '', '', m2(solved.netArea).toFixed(2), (m2(solved.netArea) * M2_TO_SQFT).toFixed(1)],
      ['Estimated built-up (incl. walls)', '', '', m2(solved.grossArea).toFixed(2), (m2(solved.grossArea) * M2_TO_SQFT).toFixed(1)],
      [],
      ['Aircon zone', 'Rooms', 'Afternoon sun', 'Area (ft2)', 'BTU/h', 'Suggested'],
      ...zones.map((z) => [
        z.name,
        z.rooms.map((r) => r.room.name).join(' + '),
        z.sunny ? 'yes' : 'no',
        (m2(z.area) * M2_TO_SQFT).toFixed(0),
        Math.round(z.btu),
        `${z.units.count > 1 ? `${z.units.count} × ` : ''}${z.units.hp}`,
      ]),
    ]
    const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n')
    downloadFile(`${project.name || 'apartment'}-areas.csv`, csv, 'text/csv')
  }

  return (
    <div className="page">
      <div className="row between">
        <h2>Report · {project.name}</h2>
        <button className="btn" onClick={exportCsv}>
          Export CSV
        </button>
      </div>

      {(unmeasured.length > 0 || shaky.length > 0) && (
        <div className="callout warn">
          {unmeasured.length > 0 && (
            <div>
              {complete} of {solved.rooms.length} rooms fully measured. Not finished:{' '}
              {unmeasured.map((r) => r.room.name).join(', ')} — their figures partly rely on the plan’s scale.
            </div>
          )}
          {shaky.length > 0 && (
            <div>
              Measurements don’t close in {shaky.map((r) => r.room.name).join(', ')} (over {settings.closureTolerance} mm). Re-check
              before relying on the totals.
            </div>
          )}
        </div>
      )}

      <section className="card">
        <h3>Floor area</h3>
        <div className="stat-row">
          <div className="stat">
            <span className="stat-label">Net (carpet) area</span>
            <span className="stat-value">{formatArea(solved.netArea)}</span>
            <span className="muted">{formatSqft(solved.netArea)} · inside the walls</span>
          </div>
          {hasBalcony && (
            <div className="stat">
              <span className="stat-label">Net, excluding balcony</span>
              <span className="stat-value">{formatArea(solved.netIndoorArea)}</span>
              <span className="muted">{formatSqft(solved.netIndoorArea)}</span>
            </div>
          )}
          <div className="stat">
            <span className="stat-label">Estimated built-up</span>
            <span className="stat-value">{formatArea(solved.grossArea)}</span>
            <span className="muted">
              {formatSqft(solved.grossArea)} · incl. walls ({fmtInt(settings.externalShare * 100)}% of external)
            </span>
          </div>
        </div>

        <div className="advertised">
          <label className="field inline">
            <span className="field-label">Advertised area</span>
            <input
              inputMode="decimal"
              value={advText}
              placeholder="e.g. 1,050"
              onChange={(e) => {
                setAdvText(e.target.value)
                const v = parseFloat(e.target.value.replace(/,/g, ''))
                setAdvertised(Number.isFinite(v) && v > 0 ? { value: v, unit: adv?.unit ?? 'sqft' } : null)
              }}
            />
            <select
              value={adv?.unit ?? 'sqft'}
              onChange={(e) => adv && setAdvertised({ ...adv, unit: e.target.value as 'sqft' | 'm2' })}
            >
              <option value="sqft">ft²</option>
              <option value="m2">m²</option>
            </select>
          </label>
          {advMm2 && (
            <table className="table compare">
              <tbody>
                <tr>
                  <td>Advertised</td>
                  <td>{formatArea(advMm2)}</td>
                  <td>{formatSqft(advMm2)}</td>
                  <td />
                </tr>
                <tr>
                  <td>Estimated built-up</td>
                  <td>{formatArea(solved.grossArea)}</td>
                  <td>{formatSqft(solved.grossArea)}</td>
                  <td className={solved.grossArea < advMm2 * 0.97 ? 'neg' : ''}>{pct(solved.grossArea / advMm2 - 1)}</td>
                </tr>
                <tr>
                  <td>Net (usable)</td>
                  <td>{formatArea(solved.netArea)}</td>
                  <td>{formatSqft(solved.netArea)}</td>
                  <td>{((solved.netArea / advMm2) * 100).toFixed(0)}% of advertised</td>
                </tr>
              </tbody>
            </table>
          )}
          <p className="muted small">
            Developers usually advertise built-up area, which includes the walls and often balconies and yards. Compare it with
            the built-up estimate; the net figure is what you can actually furnish. Methods differ on external walls — change
            how much of them counts in <button className="link" onClick={() => setTab('settings')}>Settings</button> to see the range.
          </p>
        </div>
      </section>

      <section className="card">
        <h3>Rooms</h3>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Room</th>
                <th className="num">m²</th>
                <th className="num">ft²</th>
                <th className="num">Ceiling</th>
                <th className="num">Wall paint area</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {solved.rooms.map((r) => {
                const openings = r.room.edges.reduce(
                  (sum, e) => sum + (e.kind === 'wall' ? e.openings.reduce((a, o) => a + o.width * o.height, 0) : 0),
                  0,
                )
                const paint = r.wallLength * r.height - openings
                const facing = roomFacing(solved, r)
                return (
                  <tr key={r.room.id}>
                    <td>
                      <span className="swatch" style={{ background: roomTypeInfo(r.room.type).color }} />
                      {r.room.name}
                      {facing.length > 0 && <div className="muted small">faces {formatFacing(facing)}</div>}
                    </td>
                    <td className="num">{m2(r.area).toFixed(2)}</td>
                    <td className="num">{Math.round(m2(r.area) * M2_TO_SQFT)}</td>
                    <td className="num">{formatLength(r.height)}</td>
                    <td className="num">{m2(paint).toFixed(1)} m²</td>
                    <td>
                      {r.status === 'empty'
                        ? 'not measured'
                        : r.status === 'partial'
                          ? `${r.measuredCount}/${r.wallCount} walls`
                          : r.closure.checkable === 'none'
                            ? 'unverified'
                            : r.closureOk
                              ? '✓'
                              : `⚠ ${Math.round(r.closure.measuredError)} mm`}
                    </td>
                  </tr>
                )
              })}
            </tbody>
            <tfoot>
              <tr>
                <td>Total</td>
                <td className="num">{m2(solved.netArea).toFixed(2)}</td>
                <td className="num">{Math.round(m2(solved.netArea) * M2_TO_SQFT)}</td>
                <td colSpan={3} />
              </tr>
            </tfoot>
          </table>
        </div>
      </section>

      <section className="card">
        <h3>Aircon sizing</h3>
        {zones.length === 0 ? (
          <p className="muted">No rooms marked as needing aircon.</p>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Space</th>
                  <th className="num">Area</th>
                  <th className="num">Avg ceiling</th>
                  <th className="num">Needed</th>
                  <th>Suggested unit</th>
                </tr>
              </thead>
              <tbody>
                {zones.map((z) => (
                  <tr key={z.name}>
                    <td>
                      {z.name}
                      {z.rooms.length > 1 && <div className="muted small">{z.rooms.map((r) => r.room.name).join(' + ')}</div>}
                      {z.sunny && <div className="muted small">afternoon sun</div>}
                    </td>
                    <td className="num">{Math.round(m2(z.area) * M2_TO_SQFT)} ft²</td>
                    <td className="num">{formatLength(z.volume / z.area)}</td>
                    <td className="num">{fmtInt(z.btu)} BTU/h</td>
                    <td>
                      <strong>
                        {z.units.count > 1 ? `${z.units.count} × ` : ''}
                        {z.units.hp}
                      </strong>{' '}
                      <span className="muted">({fmtInt(z.units.btu)} BTU)</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="muted small">
          Rule of thumb: {settings.acBtuPerSqft} BTU/h per ft², scaled for ceilings above/below{' '}
          {formatLength(settings.acRefHeight)}, +{Math.round((settings.acSunnyFactor - 1) * 100)}% for rooms with afternoon sun
          {project.north == null ? ' (set north on the Plan tab to work these out)' : ' (outside walls facing SW, W or NW)'}. Good
          for budgeting and shortlisting; ask the installer to confirm, especially for west-facing glass, top floors or open
          kitchens. Group open-plan rooms with an aircon zone on the Plan tab.
        </p>
      </section>
    </div>
  )
}
