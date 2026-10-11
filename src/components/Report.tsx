import { useState } from 'react'
import { acZones, hpLabel, type AcZone } from '../ac'
import { formatFacing, roomFacing } from '../geometry/facing'
import { FAN_SIZES, fixtureList, formatWatts, TUBE_SIZES, type FixtureRow } from '../geometry/lights'
import { bySize, plugSchedule, type PlugTally } from '../geometry/plugs'
import { downloadFile, useStore } from '../store'
import { lightKindInfo, roomTypeInfo, type LengthUnit, type PlugPoint } from '../types'
import { formatArea, formatLength, formatSqft, fmtInt, M2_TO_SQFT, m2 } from '../units'
import { cabinetCsv, CabinetsReport } from './CabinetReport'
import { useSolved } from './common'
import { LightIcon } from './Lights'
import { PlugBadge } from './Plugs'

const pct = (x: number) => `${x >= 0 ? '+' : ''}${(x * 100).toFixed(1)}%`
const installedLabel = (z: AcZone) => z.installed.map((u) => hpLabel(u.hp)).join(' + ')
const suggestedLabel = (z: AcZone) => `${z.units.count > 1 ? `${z.units.count} × ` : ''}${hpLabel(z.units.hp)}`

/** A row of the lighting list's size, power and colour, e.g. "150 mm · 12W · 3000K"; '' when none are set. */
function fixtureSpec(f: FixtureRow, unit: LengthUnit) {
  const fanSize = f.kind === 'fan' && FAN_SIZES.find((s) => s.mm === f.size)
  const tube = f.kind === 'strip' && TUBE_SIZES.find((s) => s.mm === f.size)
  const size =
    f.size == null
      ? null
      : f.kind === 'strip'
        ? `${tube ? `${tube.feet}ft` : formatLength(f.size, unit)} tube`
        : fanSize
          ? `${fanSize.inches}″`
          : `${formatLength(f.size, unit)}${f.linear ? ' long' : ''}`
  const temp =
    f.temp == null ? null : f.temp === 'tri' ? 'tri-colour' : f.temp === 'rgb' ? 'RGB full colour' : `${f.temp}K`
  const colour = f.kind === 'fan' ? (temp ? `${temp} light` : 'no light') : temp
  return [size, f.watt == null ? null : formatWatts(f.watt), colour].filter(Boolean).join(' · ')
}

/** How many to buy; for LED tube, the tubes, and the runs they light (e.g. "1 run, 2.96 m"). */
const fixtureQty = (f: FixtureRow) => (f.kind === 'strip' ? f.tubes : f.count)
const fixtureRuns = (f: FixtureRow) =>
  f.kind === 'strip' ? `${f.count} run${f.count > 1 ? 's' : ''}, ${(f.length / 1000).toFixed(2)} m` : null

const fixtureRooms = (f: FixtureRow) =>
  f.rooms.map((r) => (r.count > 1 ? `${r.room.name} ×${r.count}` : r.room.name)).join(', ')

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`
/** "3 points, 6 sockets" */
const tallyLabel = (t: PlugTally) => `${plural(t.points, 'point')}, ${plural(t.sockets, 'socket')}`
const addTally = (a: PlugTally, b: PlugTally) => ({ points: a.points + b.points, sockets: a.sockets + b.sockets })

/** Each plug point as its badge, with its remark. */
function PlugBadges({ plugs }: { plugs: PlugPoint[] }) {
  if (!plugs.length) return <span className="muted">–</span>
  return (
    <span className="plug-badges">
      {plugs.map((p) => (
        <span key={p.id} className="plug-item">
          <PlugBadge count={p.count} existing={p.existing} />
          {p.note.trim() && ` ${p.note.trim()}`}
        </span>
      ))}
    </span>
  )
}

/** A room's remarks for the CSV, e.g. "TV (new, 2 sockets); Fridge (existing, 1 socket)". */
const plugRemarks = (plugs: PlugPoint[]) =>
  plugs
    .filter((p) => p.note.trim())
    .map((p) => `${p.note.trim()} (${p.existing ? 'existing' : 'new'}, ${plural(p.count, 'socket')})`)
    .join('; ')

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
  const fixtures = fixtureList(project.rooms, project.lights)
  const fixtureWatts = fixtures.reduce((sum, f) => sum + f.watts, 0)
  // A + where some have no power set, so the total is at least this.
  const unrated = fixtures.some((f) => f.watt == null)
  const unit = settings.inputUnit
  const plugRows = plugSchedule(project.rooms, project.plugs)
  const none = { points: 0, sockets: 0 }
  const plugsExisting = plugRows.reduce((t, r) => addTally(t, r.existing), none)
  const plugsToAdd = plugRows.reduce((t, r) => addTally(t, r.toAdd), none)
  // The points to add by how many sockets each has, for the electrician's quote.
  const toAddBySize = bySize(plugRows.flatMap((r) => r.toAddPlugs.map((p) => p.count)))

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
      ['Aircon zone', 'Rooms', 'Afternoon sun', 'Area (ft2)', 'BTU/h', 'Installed', 'Installed BTU/h', 'Installed enough', 'Suggested'],
      ...zones.map((z) => [
        z.name,
        z.rooms.map((r) => r.room.name).join(' + '),
        z.sunny ? 'yes' : 'no',
        (m2(z.area) * M2_TO_SQFT).toFixed(0),
        Math.round(z.btu),
        installedLabel(z),
        z.installed.length ? z.installedBtu : '',
        z.enough == null ? '' : z.enough ? 'yes' : 'no',
        suggestedLabel(z),
      ]),
      ...(fixtures.length
        ? [
            [],
            ['Light or fan', 'Model', 'Size, power and colour', 'Quantity', 'Rooms', 'Watts'],
            ...fixtures.map((f) => [
              lightKindInfo(f.kind).label,
              f.model,
              fixtureSpec(f, unit),
              fixtureRuns(f) ? `${fixtureQty(f)} (${fixtureRuns(f)})` : fixtureQty(f),
              fixtureRooms(f),
              f.watt == null ? '' : Math.round(f.watts),
            ]),
          ]
        : []),
      ...(plugRows.length
        ? [
            [],
            ['Room', 'Existing plug points', 'Existing sockets', 'New plug points', 'New sockets', 'Remarks'],
            ...plugRows.map((r) => [
              r.room.name,
              r.existing.points,
              r.existing.sockets,
              r.toAdd.points,
              r.toAdd.sockets,
              plugRemarks([...r.existingPlugs, ...r.toAddPlugs]),
            ]),
            ['Total', plugsExisting.points, plugsExisting.sockets, plugsToAdd.points, plugsToAdd.sockets],
            ...(toAddBySize.length
              ? [['New plug points by size', toAddBySize.map(([c, n]) => `${n} × ${plural(c, 'socket')}`).join(', ')]]
              : []),
          ]
        : []),
      ...cabinetCsv(project, solved),
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
                  <th>Unit</th>
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
                      {z.enough == null ? (
                        <>
                          <strong>{suggestedLabel(z)}</strong> <span className="muted">({fmtInt(z.units.btu)} BTU)</span>
                          <div className="muted small">suggested</div>
                        </>
                      ) : (
                        <>
                          <strong>{installedLabel(z)}</strong> <span className="muted">({fmtInt(z.installedBtu)} BTU)</span>{' '}
                          <span className={`badge ${z.enough ? 'ok' : 'bad'}`}>{z.enough ? 'enough' : 'may be too small'}</span>
                          <div className="muted small">
                            installed{z.rooms.length > 1 && ` in ${z.installed.map((u) => u.room).join(', ')}`}
                            {!z.enough && ` · ${fmtInt(z.btu - z.installedBtu)} BTU/h short; ${suggestedLabel(z)} would cover it`}
                          </div>
                        </>
                      )}
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
          kitchens. Group open-plan rooms with an aircon zone on the Plan tab. A unit that’s already installed counts as
          enough if the estimate is no more than {Math.round(settings.acShortfall * 100)}% above its rating.
        </p>
      </section>

      <section className="card">
        <h3>Lighting &amp; fans</h3>
        {fixtures.length === 0 ? (
          <p className="muted">
            No lights or fans yet. Place them on the{' '}
            <button className="link" onClick={() => setTab('lighting')}>
              Electrical
            </button>{' '}
            tab.
          </p>
        ) : (
          <>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Light or fan</th>
                    <th>Model</th>
                    <th>Size, power and colour</th>
                    <th className="num">Qty</th>
                    <th>Rooms</th>
                    <th className="num">Watts</th>
                  </tr>
                </thead>
                <tbody>
                  {fixtures.map((f, i) => (
                    <tr key={i}>
                      <td>
                        <span className="fixture">
                          <LightIcon kind={f.kind} />
                          {lightKindInfo(f.kind).label}
                        </span>
                      </td>
                      <td>{f.model || <span className="muted">not set</span>}</td>
                      <td>{fixtureSpec(f, unit) || <span className="muted">–</span>}</td>
                      <td className="num">
                        {fixtureQty(f)}
                        {fixtureRuns(f) && <div className="muted small">{fixtureRuns(f)}</div>}
                      </td>
                      <td>{fixtureRooms(f)}</td>
                      <td className="num">{f.watt == null ? <span className="muted">–</span> : fmtInt(f.watts)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={5}>Total</td>
                    <td className="num">
                      {fixtureWatts ? (
                        `${fmtInt(fixtureWatts)}${unrated ? '+' : ''}`
                      ) : (
                        <span className="muted">–</span>
                      )}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
            <p className="muted small">
              Lights that match in type, model, size, power and colour share a row.
              {unrated && fixtureWatts > 0 && ' + Some have no power set yet, so the total is at least this.'} Set
              models and settings on the{' '}
              <button className="link" onClick={() => setTab('lighting')}>
                Electrical
              </button>{' '}
              tab.
            </p>
          </>
        )}
      </section>

      <section className="card">
        <h3>Plug points</h3>
        {plugRows.length === 0 ? (
          <p className="muted">
            No plug points yet. Mark the ones already there and plan new ones on the{' '}
            <button className="link" onClick={() => setTab('lighting')}>
              Electrical
            </button>{' '}
            tab.
          </p>
        ) : (
          <>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Room</th>
                    <th>Existing</th>
                    <th>New</th>
                  </tr>
                </thead>
                <tbody>
                  {plugRows.map((r) => (
                    <tr key={r.room.id}>
                      <td>{r.room.name}</td>
                      <td>
                        <PlugBadges plugs={r.existingPlugs} />
                      </td>
                      <td>
                        <PlugBadges plugs={r.toAddPlugs} />
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td>Total</td>
                    <td>{plugsExisting.points ? tallyLabel(plugsExisting) : <span className="muted">–</span>}</td>
                    <td>{plugsToAdd.points ? tallyLabel(plugsToAdd) : <span className="muted">–</span>}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
            <p className="muted small">
              Each badge is one point on the wall, with how many sockets it has (2 for a twin socket) and its remark.
              {toAddBySize.length > 0 && (
                <>
                  {' '}
                  New points by size:{' '}
                  {toAddBySize.map(([count, n], i) => (
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
        )}
      </section>

      <section className="card">
        <h3>Cabinets</h3>
        {project.cabinets.length === 0 ? (
          <p className="muted">
            No cabinets yet. Plan them on the{' '}
            <button className="link" onClick={() => setTab('cabinets')}>
              Cabinets
            </button>{' '}
            tab.
          </p>
        ) : (
          <CabinetsReport solved={solved} />
        )}
      </section>
    </div>
  )
}
