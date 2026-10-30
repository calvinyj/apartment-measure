import type { Content, ContentTable, CustomTableLayout, TableCell, TDocumentDefinitions } from 'pdfmake/interfaces'
import { acZones } from '../ac'
import { cabinetWarnings } from '../cabinets/checks'
import { addMaterials, allBoard, innerBoard, outerBoard, sheetsFor, type CabinetMaterials } from '../cabinets/materials'
import { cabinetRows, cabinetSummary, finishText, placeText } from '../components/CabinetReport'
import { appliancesText, cutoutsText, fmtFt, fmtM, fmtM2 } from '../components/CabinetMaterials'
import { PLAN_NOTE } from '../components/ReportPlan'
import { formatPrice, furnitureList, itemHref, linkSite, sizeLabel, statusTotals } from '../furniture'
import { formatFacing, roomFacing } from '../geometry/facing'
import { fixtureList } from '../geometry/lights'
import { OPENING_LABELS, openingList } from '../geometry/openings'
import { bySize, plugSchedule } from '../geometry/plugs'
import type { Solved, SolvedRoom } from '../geometry/solve'
import {
  addTally,
  fixtureQty,
  fixtureRooms,
  fixtureRuns,
  fixtureSpec,
  installedLabel,
  openingSide,
  openingTotals,
  paintArea,
  pct,
  plural,
  reportCaveats,
  REPORT_SECTIONS,
  suggestedLabel,
  tallyLabel,
  type ReportSection,
} from '../report'
import { lightKindInfo, ORDER_STATUSES, type PlugPoint, type Project } from '../types'
import { formatArea, formatLength, formatLengthValue, formatSqft, fmtInt, M2_TO_SQFT, m2 } from '../units'
import type { Png } from './raster'

const INK = '#1f2933'
const MUTED = '#6b7280'
const LINE = '#e2e2dd'
const ACCENT = '#2563eb'
const OK = '#15803d'
const BAD = '#b91c1c'
const WARN_BG = '#fff4e0'
const WARN_INK = '#7c3d06'

/** A4, less the margins, pt. */
const MARGIN = 40
const PAGE_W = 595.28 - 2 * MARGIN

/** The drawings, made from the page beforehand (there's no DOM to draw them here). */
export interface PdfImages {
  plan: Png | null
  /** each cabinet's front and top views, by its id */
  cabinets: Map<string, { front: Png | null; top: Png | null }>
}

const TABLE: CustomTableLayout = {
  hLineWidth: (i) => (i === 0 ? 0 : 0.5),
  vLineWidth: () => 0,
  hLineColor: () => LINE,
  paddingLeft: (i) => (i === 0 ? 0 : 6),
  paddingRight: (i, node) => (i === (node.table.widths?.length ?? 0) - 1 ? 0 : 6),
  paddingTop: () => 3.5,
  paddingBottom: () => 3.5,
}

/** A table with a header row, numbers right-aligned in the `num` columns, and optionally a bold totals row. */
function table(
  head: string[],
  rows: TableCell[][],
  { widths, num = [], foot }: { widths: (string | number)[]; num?: number[]; foot?: TableCell[] },
): ContentTable {
  const align = (cells: TableCell[]) => cells.map((c, i) => (num.includes(i) ? withProps(c, { alignment: 'right' }) : c))
  return {
    table: {
      headerRows: 1,
      dontBreakRows: true,
      widths,
      body: [
        align(head.map((h) => ({ text: h, style: 'th' }))),
        ...rows.map(align),
        ...(foot ? [align(foot.map((c) => withProps(c, { bold: true })))] : []),
      ],
    },
    layout: TABLE,
  }
}

/** A cell with these settings added, making a string into a text cell. */
const withProps = (c: TableCell, props: { alignment?: 'right'; bold?: boolean }): TableCell =>
  typeof c === 'string' || typeof c === 'number' ? { text: String(c), ...props } : ({ ...(c as object), ...props } as TableCell)

/** A cell's text with a smaller grey line or two under it. */
const withSub = (main: Content, ...subs: (string | false | null | undefined)[]): Content => {
  const lines = subs.filter((s): s is string => !!s)
  return lines.length ? { stack: [main, ...lines.map((s) => ({ text: s, style: 'sub' }))] } : main
}

/** Nothing set. A new one each time: pdfmake lays out each object once, so a shared one would show in one cell only. */
const dash = (): Content => ({ text: '–', color: MUTED })
const heading = (text: string): Content => ({ text, style: 'h', headlineLevel: 1 })
const note = (text: string): Content => ({ text, style: 'note', margin: [0, 6, 0, 0] })
const warnBox = (lines: string[]): Content => ({
  table: { widths: ['*'], body: [[{ stack: lines.map((text) => ({ text, color: WARN_INK })), fillColor: WARN_BG }]] },
  layout: { hLineWidth: () => 0, vLineWidth: () => 0, paddingLeft: () => 8, paddingRight: () => 8, paddingTop: () => 6, paddingBottom: () => 6 },
  margin: [0, 4, 0, 4],
})

/** On the page it's ✓ or ⚠, which the PDF's font doesn't have. */
function roomStatus(r: SolvedRoom): Content {
  if (r.status === 'empty') return 'not measured'
  if (r.status === 'partial') return `${r.measuredCount}/${r.wallCount} walls`
  if (r.closure.checkable === 'none') return 'unverified'
  return r.closureOk ? { text: 'OK', color: OK } : { text: `${Math.round(r.closure.measuredError)} mm off`, color: BAD }
}

/** A plug point as on its badge, e.g. "[2] TV". */
const badges = (plugs: PlugPoint[]): Content =>
  plugs.length ? plugs.map((p) => `[${p.count}]${p.note.trim() ? ` ${p.note.trim()}` : ''}`).join(', ') : dash()

function materialsTable(m: CabinetMaterials): Content {
  const b = m.board
  const rows: TableCell[][] = []
  const sub = (label: string) => rows.push([{ text: label, style: 'th', colSpan: 3 }, '', ''])
  const area = (label: string, mm2: number) => mm2 > 0 && rows.push([{ text: label, margin: [8, 0, 0, 0] }, fmtM2(mm2), ''])
  const total = (label: string, mm2: number) => rows.push([{ text: label, bold: true }, { text: fmtM2(mm2), bold: true }, { text: String(sheetsFor(mm2)), bold: true }])
  const value = (label: string, v: string | number | false) =>
    v !== false && v !== 0 && v !== '' && rows.push([{ text: label, margin: [8, 0, 0, 0] }, { text: String(v), colSpan: 2 }, ''])
  area('Box: ends, top and bottom', b.shell)
  area('Backs', b.back)
  area('Doors, drawer fronts and panels', b.fronts)
  area('Plinth', b.plinth)
  total('Without the inside', outerBoard(b))
  area('Dividers and fixed shelves', b.dividers)
  area('Adjustable shelves', b.shelves)
  area('Drawer boxes', b.drawerBoxes)
  if (innerBoard(b) > 0) total('The inside', innerBoard(b))
  total('All board', allBoard(b))
  if (m.top) {
    sub('Top')
    value('Area (cut-outs included)', fmtM2(m.top.area))
    value('Length along the walls', `${fmtM(m.top.length)} (${fmtFt(m.top.length)})`)
    value('Front edge', fmtM(m.top.frontEdge))
    value('Upstand', m.top.upstand > 0 && fmtM2(m.top.upstand))
    value('Cut-outs', cutoutsText(m.top.cutouts))
  }
  sub('Fittings')
  value('Doors', m.doors && `${m.doors}${m.slidingDoors ? ` (${m.slidingDoors} sliding)` : ''}`)
  value('Hinges', m.hinges)
  value('Lift-up stays', m.liftUps)
  value('Drawers (pairs of runners)', m.drawers)
  value('Handles', m.handles)
  value('Adjustable shelves', m.shelves)
  value('Hanging rails', m.rails)
  value('Plinth length', m.plinthLength > 0 && fmtM(m.plinthLength))
  value('Spaces for', appliancesText(m.appliances))
  return table(['Board', 'Area', '8×4 ft sheets'], rows, { widths: ['*', 90, 90], num: [1, 2] })
}

/** A drawing in a thin frame, as on the page. */
const framed = (png: Png | null | undefined, width: number): Content =>
  png
    ? {
        table: { widths: [width - 2], body: [[{ image: png.url, width: width - 2 }]] },
        layout: { hLineWidth: () => 0.5, vLineWidth: () => 0.5, hLineColor: () => LINE, vLineColor: () => LINE, paddingLeft: () => 0, paddingRight: () => 0, paddingTop: () => 0, paddingBottom: () => 0 },
      }
    : ''

/** Each chosen section, as on the Report tab. */
function sections(project: Project, solved: Solved, chosen: ReportSection[], images: PdfImages): Partial<Record<ReportSection, Content[]>> {
  const settings = project.settings
  const unit = settings.inputUnit
  const out: Partial<Record<ReportSection, Content[]>> = {}
  const want = (id: ReportSection) => chosen.includes(id)

  if (want('plan') && images.plan) {
    out.plan = [{ image: images.plan.url, fit: [PAGE_W, 600], alignment: 'center' }, note(PLAN_NOTE)]
  }

  if (want('area')) {
    const adv = project.advertised
    const advMm2 = adv ? (adv.unit === 'sqft' ? adv.value / M2_TO_SQFT : adv.value) * 1e6 : null
    const stat = (label: string, value: string, sub: string): Content => ({
      stack: [{ text: label, style: 'sub' }, { text: value, fontSize: 15, bold: true, margin: [0, 1, 0, 1] }, { text: sub, style: 'sub' }],
    })
    const pillars = solved.rooms.some((r) => r.pillarArea > 0)
    out.area = [
      {
        columns: [
          stat('Net (carpet) area', formatArea(solved.netArea), `${formatSqft(solved.netArea)} · inside the walls${pillars ? ', less pillars' : ''}`),
          ...(solved.rooms.some((r) => r.room.type === 'balcony')
            ? [stat('Net, excluding balcony', formatArea(solved.netIndoorArea), formatSqft(solved.netIndoorArea))]
            : []),
          stat('Estimated built-up', formatArea(solved.grossArea), `${formatSqft(solved.grossArea)} · incl. walls (${fmtInt(settings.externalShare * 100)}% of external)`),
        ],
        columnGap: 12,
      },
      ...(advMm2
        ? [
            {
              margin: [0, 10, 0, 0],
              ...table(
                ['', 'm²', 'ft²', ''],
                [
                  ['Advertised', formatArea(advMm2), formatSqft(advMm2), ''],
                  [
                    'Estimated built-up',
                    formatArea(solved.grossArea),
                    formatSqft(solved.grossArea),
                    { text: pct(solved.grossArea / advMm2 - 1), color: solved.grossArea < advMm2 * 0.97 ? BAD : INK },
                  ],
                  ['Net (usable)', formatArea(solved.netArea), formatSqft(solved.netArea), `${((solved.netArea / advMm2) * 100).toFixed(0)}% of advertised`],
                ],
                { widths: ['*', 70, 60, 110], num: [1, 2, 3] },
              ),
            } as Content,
          ]
        : []),
      note(
        'Developers usually advertise built-up area, which includes the walls and often balconies and yards. Compare it with the built-up estimate; the net figure is what you can actually furnish. Methods differ on external walls: change how much of them counts in Settings to see the range.',
      ),
    ]
  }

  if (want('rooms')) {
    out.rooms = [
      table(
        ['Room', 'm²', 'ft²', 'Ceiling', 'Wall paint area', 'Status'],
        solved.rooms.map((r) => {
          const facing = roomFacing(solved, r)
          return [
            withSub(r.room.name, facing.length > 0 && `faces ${formatFacing(facing)}`, r.pillarArea > 0 && `less ${formatArea(r.pillarArea)} of pillars`),
            m2(r.area).toFixed(2),
            String(Math.round(m2(r.area) * M2_TO_SQFT)),
            formatLength(r.height),
            `${m2(paintArea(r)).toFixed(1)} m²`,
            roomStatus(r),
          ]
        }),
        {
          widths: ['*', 50, 40, 60, 80, 80],
          num: [1, 2, 3, 4],
          foot: ['Total', m2(solved.netArea).toFixed(2), String(Math.round(m2(solved.netArea) * M2_TO_SQFT)), '', '', ''],
        },
      ),
    ]
  }

  const openings = openingList(solved)
  if (want('openings') && openings.length) {
    out.openings = [
      table(
        ['Room', 'Wall', 'Type', 'Size (W × H)', 'Sill', 'From corner A'],
        openings.map((o) => [
          o.room.name,
          withSub(`wall ${o.wallNo}`, openingSide(o)),
          OPENING_LABELS[o.opening.kind],
          `${formatLengthValue(o.opening.width, unit)} × ${formatLengthValue(o.opening.height, unit)} ${unit}`,
          o.opening.sill > 0 ? formatLength(o.opening.sill, unit) : dash(),
          formatLength(o.from, unit),
        ]),
        { widths: ['*', 100, 50, 85, 55, 70], num: [4, 5], foot: ['Total', { text: openingTotals(openings), colSpan: 5 }, '', '', '', ''] },
      ),
      note('As entered on each wall of the Measure tab, where the walls are numbered. The sill is from the floor to the bottom, and the position is from the wall’s corner A to the near side. A door between two rooms is listed in the room it was entered in.'),
    ]
  }

  const zones = acZones(solved, settings)
  if (want('aircon') && zones.length) {
    out.aircon = [
      table(
        ['Space', 'Area', 'Avg ceiling', 'Needed', 'Unit'],
        zones.map((z) => [
          withSub(z.name, z.rooms.length > 1 && z.rooms.map((r) => r.room.name).join(' + '), z.sunny && 'afternoon sun'),
          `${Math.round(m2(z.area) * M2_TO_SQFT)} ft²`,
          formatLength(z.volume / z.area),
          `${fmtInt(z.btu)} BTU/h`,
          z.enough == null
            ? withSub({ text: [{ text: suggestedLabel(z), bold: true }, { text: ` (${fmtInt(z.units.btu)} BTU)`, color: MUTED }] }, 'suggested')
            : withSub(
                {
                  text: [
                    { text: installedLabel(z), bold: true },
                    { text: ` (${fmtInt(z.installedBtu)} BTU) `, color: MUTED },
                    { text: z.enough ? 'enough' : 'may be too small', color: z.enough ? OK : BAD },
                  ],
                },
                `installed${z.rooms.length > 1 ? ` in ${z.installed.map((u) => u.room).join(', ')}` : ''}${
                  z.enough ? '' : ` · ${fmtInt(z.btu - z.installedBtu)} BTU/h short; ${suggestedLabel(z)} would cover it`
                }`,
              ),
        ]),
        { widths: ['*', 55, 60, 75, 170], num: [1, 2, 3] },
      ),
      note(
        `Rule of thumb: ${settings.acBtuPerSqft} BTU/h per ft², scaled for ceilings above/below ${formatLength(settings.acRefHeight)}, +${Math.round((settings.acSunnyFactor - 1) * 100)}% for rooms with afternoon sun${
          project.north == null ? ' (set north on the Plan tab to work these out)' : ' (outside walls facing SW, W or NW)'
        }. Good for budgeting and shortlisting; ask the installer to confirm, especially for west-facing glass, top floors or open kitchens. A unit that’s already installed counts as enough if the estimate is no more than ${Math.round(settings.acShortfall * 100)}% above its rating.`,
      ),
    ]
  }

  const fixtures = fixtureList(project.rooms, project.lights)
  if (want('lighting') && fixtures.length) {
    const watts = fixtures.reduce((sum, f) => sum + f.watts, 0)
    const unrated = fixtures.some((f) => f.watt == null)
    out.lighting = [
      table(
        ['Light or fan', 'Model', 'Size, power and colour', 'Qty', 'Rooms', 'Watts'],
        fixtures.map((f) => [
          lightKindInfo(f.kind).label,
          f.model || { text: 'not set', color: MUTED },
          fixtureSpec(f, unit) || dash(),
          withSub(String(fixtureQty(f)), fixtureRuns(f)),
          fixtureRooms(f),
          f.watt == null ? dash() : fmtInt(f.watts),
        ]),
        {
          widths: [65, 80, '*', 50, 110, 40],
          num: [3, 5],
          foot: [{ text: 'Total', colSpan: 5 }, '', '', '', '', watts ? `${fmtInt(watts)}${unrated ? '+' : ''}` : dash()],
        },
      ),
      note(`Lights that match in type, model, size, power and colour share a row.${unrated && watts > 0 ? ' + Some have no power set yet, so the total is at least this.' : ''}`),
    ]
  }

  const plugRows = plugSchedule(project.rooms, project.plugs)
  if (want('plugs') && plugRows.length) {
    const none = { points: 0, sockets: 0 }
    const existing = plugRows.reduce((t, r) => addTally(t, r.existing), none)
    const toAdd = plugRows.reduce((t, r) => addTally(t, r.toAdd), none)
    const toAddBySize = bySize(plugRows.flatMap((r) => r.toAddPlugs.map((p) => p.count)))
    out.plugs = [
      table(
        ['Room', 'Existing', 'New'],
        plugRows.map((r) => [r.room.name, badges(r.existingPlugs), badges(r.toAddPlugs)]),
        { widths: [110, '*', '*'], foot: ['Total', existing.points ? tallyLabel(existing) : dash(), toAdd.points ? tallyLabel(toAdd) : dash()] },
      ),
      note(
        `Each [n] is one point on the wall, with how many sockets it has (2 for a twin socket) and its remark.${
          toAddBySize.length ? ` New points by size: ${toAddBySize.map(([count, n]) => `${n} × [${count}]`).join(', ')}.` : ''
        }`,
      ),
    ]
  }

  if (want('cabinets') && project.cabinets.length) {
    const rows = cabinetRows(project, solved)
    const total = addMaterials(rows.flatMap((r) => (r.m ? [r.m] : [])))
    const frontW = (PAGE_W - 8) * (2 / 3)
    out.cabinets = [
      ...rows.map((row): Content => {
        const { c, p } = row
        const drawings = images.cabinets.get(c.id)
        const warnings = p ? cabinetWarnings(solved, c, p, unit) : []
        return {
          unbreakable: true,
          margin: [0, 0, 0, 10],
          stack: [
            { columns: [{ text: c.name, bold: true }, { text: placeText(p), style: 'sub', alignment: 'right' }] },
            { text: cabinetSummary(row), margin: [0, 2, 0, 0] },
            { text: finishText(c), style: 'sub', margin: [0, 1, 0, 4] },
            ...(drawings
              ? [{ columns: [framed(drawings.front, frontW), framed(drawings.top, PAGE_W - 8 - frontW)], columnGap: 8 } as Content]
              : []),
            ...(warnings.length ? [warnBox(warnings)] : []),
          ],
        }
      }),
      { text: 'Materials, all cabinets', bold: true, margin: [0, 4, 0, 4], headlineLevel: 1 },
      materialsTable(total),
      note('Approximate: board by area with nothing added for offcuts, as if each straight run were one box with dividers. “Without the inside” is the box, backs, fronts and plinth; the inside is dividers, shelves and drawer boxes.'),
    ]
  }

  const furniture = furnitureList(project.rooms, project.furniture)
  if (want('furniture') && furniture.length) {
    const totals = statusTotals(furniture.map((x) => x.item))
    const all = totals.reduce((sum, t) => sum + t.price, 0)
    const unpriced = totals.some((t) => t.unpriced > 0)
    const label = (v: string) => ORDER_STATUSES.find((s) => s.value === v)!.label
    out.furniture = [
      {
        // Seven columns: a size smaller, so they wrap less.
        fontSize: 8,
        ...table(
          ['Item', 'Model', 'Size', 'Room', 'Price', 'Status', 'Link'],
          furniture.map(({ item: f, room }) => {
            const href = itemHref(f.url)
            return [
              f.name.trim() || { text: 'Unnamed', color: MUTED },
              f.model.trim() || dash(),
              sizeLabel(f, unit) || dash(),
              room.name,
              f.price != null ? formatPrice(f.price) : dash(),
              label(f.status),
              href ? { text: linkSite(f.url), link: href, color: ACCENT } : f.url.trim() || dash(),
            ]
          }),
          { widths: ['*', '*', 68, 58, 50, 42, 78], num: [4] },
        ),
      },
      {
        margin: [0, 8, 0, 0],
        ...table(
          ['', 'Price'],
          totals.map((t) => [`${t.count} ${label(t.status).toLowerCase()}`, t.price > 0 ? `${formatPrice(t.price)}${t.unpriced ? '+' : ''}` : dash()]),
          { widths: [120, 80], num: [1], foot: ['Total', all > 0 ? `${formatPrice(all)}${unpriced ? '+' : ''}` : dash()] },
        ),
      } as Content,
      note(`Prices are for reference, as you entered them.${unpriced && all > 0 ? ' + Some have no price set yet, so it comes to at least this.' : ''}`),
    ]
  }

  return out
}

/** The report as a PDF: its title, what to keep in mind, then the chosen sections in the Report tab's order. */
export function buildReportPdf({
  project,
  solved,
  chosen,
  images,
  date,
}: {
  project: Project
  solved: Solved
  chosen: ReportSection[]
  images: PdfImages
  date: Date
}): TDocumentDefinitions {
  const name = project.name || 'Apartment'
  const parts = sections(project, solved, chosen, images)
  const caveats = reportCaveats(solved, project.settings)
  return {
    pageSize: 'A4',
    pageMargins: [MARGIN, MARGIN, MARGIN, 48],
    info: { title: `Report · ${name}` },
    defaultStyle: { font: 'Roboto', fontSize: 9, color: INK, lineHeight: 1.15 },
    styles: {
      title: { fontSize: 17, bold: true },
      h: { fontSize: 12, bold: true, margin: [0, 18, 0, 6] },
      th: { fontSize: 8, bold: true, color: MUTED },
      sub: { fontSize: 7.5, color: MUTED },
      note: { fontSize: 7.5, color: MUTED },
    },
    content: [
      { text: `Report · ${name}`, style: 'title' },
      {
        text: `${date.toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })} · ${plural(solved.rooms.length, 'room')}`,
        style: 'sub',
        margin: [0, 2, 0, 6],
      },
      ...(caveats.length ? [warnBox(caveats)] : []),
      ...REPORT_SECTIONS.flatMap((s) => (parts[s.id] ? [heading(s.label), ...parts[s.id]!] : [])),
    ],
    footer: (page, pages) => ({
      columns: [
        { text: name, style: 'note' },
        { text: `Page ${page} of ${pages}`, style: 'note', alignment: 'right' },
      ],
      margin: [MARGIN, 20, MARGIN, 0],
    }),
    // Keep a heading with what follows it: a table whose first rows go over still counts as on this page, so
    // one this near the bottom goes over too.
    pageBreakBefore: (node, queries) =>
      node.headlineLevel === 1 &&
      (queries.getFollowingNodesOnPage().length === 0 || node.startPosition.verticalRatio > 0.88),
  }
}

type PdfMake = typeof import('pdfmake/build/pdfmake')

/** Makes the PDF and saves it as `fileName`. pdfmake (with its font) is loaded only now, as it's large. */
export async function savePdf(doc: TDocumentDefinitions, fileName: string) {
  const [mod, fonts] = await Promise.all([import('pdfmake/build/pdfmake'), import('pdfmake/build/vfs_fonts')])
  const pdfMake = (mod as PdfMake & { default?: PdfMake }).default ?? mod
  pdfMake.addVirtualFileSystem(fonts.default)
  await pdfMake.createPdf(doc).download(fileName)
}
