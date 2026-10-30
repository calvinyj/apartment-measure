import { acZones, hpLabel, type AcZone } from './ac'
import { furnitureList } from './furniture'
import { FAN_SIZES, fixtureList, formatWatts, TUBE_SIZES, type FixtureRow } from './geometry/lights'
import { openingList, type OpeningRow } from './geometry/openings'
import { wallFaceLength } from './geometry/pillars'
import { plugSchedule, type PlugTally } from './geometry/plugs'
import type { Solved, SolvedRoom } from './geometry/solve'
import type { LengthUnit, PlugPoint, Project, Settings } from './types'
import { formatLength } from './units'

/** The report's sections, in the order they're shown. */
export const REPORT_SECTIONS = [
  { id: 'plan', label: 'Floor plan' },
  { id: 'area', label: 'Floor area' },
  { id: 'rooms', label: 'Rooms' },
  { id: 'openings', label: 'Doors & windows' },
  { id: 'aircon', label: 'Aircon sizing' },
  { id: 'lighting', label: 'Lighting & fans' },
  { id: 'plugs', label: 'Plug points' },
  { id: 'cabinets', label: 'Cabinets' },
  { id: 'furniture', label: 'Furniture & appliances' },
] as const

export type ReportSection = (typeof REPORT_SECTIONS)[number]['id']

/** The sections with something in them; the rest only say there's nothing yet. */
export function filledSections(project: Project, solved: Solved): ReportSection[] {
  const has: Record<ReportSection, boolean> = {
    plan: true,
    area: true,
    rooms: true,
    openings: openingList(solved).length > 0,
    aircon: acZones(solved, project.settings).length > 0,
    lighting: fixtureList(project.rooms, project.lights).length > 0,
    plugs: plugSchedule(project.rooms, project.plugs).length > 0,
    cabinets: project.cabinets.length > 0,
    furniture: furnitureList(project.rooms, project.furniture).length > 0,
  }
  return REPORT_SECTIONS.flatMap((s) => (has[s.id] ? [s.id] : []))
}

/** What to keep in mind before relying on the figures: rooms not fully measured, or whose measurements don't close. */
export function reportCaveats(solved: Solved, settings: Settings): string[] {
  const complete = solved.rooms.filter((r) => r.status === 'complete').length
  const unmeasured = solved.rooms.filter((r) => r.status !== 'complete')
  const shaky = solved.rooms.filter((r) => r.status !== 'empty' && r.closure.checkable !== 'none' && !r.closureOk)
  return [
    unmeasured.length > 0 &&
      `${complete} of ${solved.rooms.length} rooms fully measured. Not finished: ${unmeasured.map((r) => r.room.name).join(', ')} — their figures partly rely on the plan’s scale.`,
    shaky.length > 0 &&
      `Measurements don’t close in ${shaky.map((r) => r.room.name).join(', ')} (over ${settings.closureTolerance} mm). Re-check before relying on the totals.`,
  ].filter((c): c is string => !!c)
}

export const pct = (x: number) => `${x >= 0 ? '+' : ''}${(x * 100).toFixed(1)}%`
export const installedLabel = (z: AcZone) => z.installed.map((u) => hpLabel(u.hp)).join(' + ')
export const suggestedLabel = (z: AcZone) => `${z.units.count > 1 ? `${z.units.count} × ` : ''}${hpLabel(z.units.hp)}`

/** A room's wall faces to paint, less its doors and windows; pillars' faces are painted too, and hide the wall behind them. */
export function paintArea(r: SolvedRoom) {
  const openings = r.room.edges.reduce(
    (sum, e) => sum + (e.kind === 'wall' ? e.openings.reduce((a, o) => a + o.width * o.height, 0) : 0),
    0,
  )
  return wallFaceLength(r) * r.height - openings
}

/** A row of the lighting list's size, power and colour, e.g. "150 mm · 12W · 3000K"; '' when none are set. */
export function fixtureSpec(f: FixtureRow, unit: LengthUnit) {
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
export const fixtureQty = (f: FixtureRow) => (f.kind === 'strip' ? f.tubes : f.count)
export const fixtureRuns = (f: FixtureRow) =>
  f.kind === 'strip' ? `${f.count} run${f.count > 1 ? 's' : ''}, ${(f.length / 1000).toFixed(2)} m` : null

export const fixtureRooms = (f: FixtureRow) =>
  f.rooms.map((r) => (r.count > 1 ? `${r.room.name} ×${r.count}` : r.room.name)).join(', ')

export const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`
/** "3 points, 6 sockets" */
export const tallyLabel = (t: PlugTally) => `${plural(t.points, 'point')}, ${plural(t.sockets, 'socket')}`
export const addTally = (a: PlugTally, b: PlugTally) => ({ points: a.points + b.points, sockets: a.sockets + b.sockets })

/** A room's remarks for the CSV, e.g. "TV (new, 2 sockets); Fridge (existing, 1 socket)". */
export const plugRemarks = (plugs: PlugPoint[]) =>
  plugs
    .filter((p) => p.note.trim())
    .map((p) => `${p.note.trim()} (${p.existing ? 'existing' : 'new'}, ${plural(p.count, 'socket')})`)
    .join('; ')

/** Drawn in these colours on the Measure tab's plan. */
export const OPENING_COLORS = { door: '#a16207', window: '#0ea5e9', opening: '#a16207' }
/** What's on the other side of an opening's wall, e.g. "to Kitchen · faces W" or "outside". */
export const openingSide = (o: OpeningRow) =>
  [o.beyond ? `to ${o.beyond.name}` : 'outside', o.faces && `faces ${o.faces}`].filter(Boolean).join(' · ')
/** "3 doors, 5 windows, 1 opening" */
export const openingTotals = (rows: OpeningRow[]) =>
  (['door', 'window', 'opening'] as const)
    .map((k) => [k, rows.filter((o) => o.opening.kind === k).length] as const)
    .filter(([, n]) => n > 0)
    .map(([k, n]) => plural(n, k))
    .join(', ')
