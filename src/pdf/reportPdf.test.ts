import { describe, expect, it } from 'vitest'
import { solveProject } from '../geometry/solve'
import { filledSections } from '../report'
import { DEFAULT_SETTINGS, type Edge, type Project } from '../types'
import { buildReportPdf } from './reportPdf'

// 1 px = 10 mm: one 4 m by 3 m bedroom, with a window, a light, a plug point and a bed.
function project(): Project {
  const pts: [number, number][] = [[0, 0], [400, 0], [400, 300], [0, 300]]
  const edges: Edge[] = pts.map((_, i) => ({ id: `e${i}`, kind: 'wall', measured: null, thickness: null, side: 'auto', openings: [] }))
  edges[0].openings = [{ id: 'w', kind: 'window', offset: 1000, width: 1200, height: 1200, sill: 900 }]
  return {
    version: 3,
    north: null,
    name: 'Test',
    image: null,
    calibration: { a: { x: 0, y: 0 }, b: { x: 100, y: 0 }, mm: 1000 },
    rooms: [{ id: 'A', name: 'Bedroom', type: 'bedroom', points: pts.map(([x, y]) => ({ x, y })), edges, height: 2700, acZone: '', ac: null, sunny: null }],
    settings: { ...DEFAULT_SETTINGS, traceMode: 'inside' },
    advertised: { value: 150, unit: 'sqft' },
    lights: [{ id: 'l', kind: 'downlight', roomId: 'A', x: 0, y: 0, angle: 0, length: 0, size: 150, watt: 12, temp: 3000, model: '' }],
    plugs: [{ id: 'p', roomId: 'A', x: 0, y: 1400, count: 2, existing: false, note: 'TV' }],
    cabinets: [],
    furniture: [{ id: 'f', roomId: 'A', x: 0, y: 0, name: 'Bed', model: '', url: '', width: null, depth: null, height: null, price: null, status: 'pending' }],
  }
}

const pdf = (p: Project, chosen = filledSections(p, solveProject(p))) =>
  buildReportPdf({ project: p, solved: solveProject(p), chosen, images: { plan: null, cabinets: new Map() }, date: new Date(2026, 9, 31) })

/** The section headings, in order. */
const headings = (doc: ReturnType<typeof pdf>) =>
  (doc.content as { style?: string; text?: string }[]).filter((c) => c.style === 'h').map((c) => c.text)

describe('report PDF', () => {
  it('has the sections with something in them, in the Report tab’s order', () => {
    const p = project()
    expect(filledSections(p, solveProject(p))).toEqual(['plan', 'area', 'rooms', 'openings', 'aircon', 'lighting', 'plugs', 'furniture'])
    // The plan is left out without its drawing, which is made from the page.
    expect(headings(pdf(p))).toEqual(['Floor area', 'Rooms', 'Doors & windows', 'Aircon sizing', 'Lighting & fans', 'Plug points', 'Furniture & appliances'])
    const empty = { ...project(), lights: [], plugs: [], furniture: [] }
    empty.rooms[0].edges[0].openings = []
    expect(filledSections(empty, solveProject(empty))).toEqual(['plan', 'area', 'rooms', 'aircon'])
  })

  it('has only the sections picked', () => {
    expect(headings(pdf(project(), ['rooms', 'plugs']))).toEqual(['Rooms', 'Plug points'])
  })

  it('uses each object once, as pdfmake shows a shared one in only one place', () => {
    const seen = new Map<object, string>()
    const walk = (v: unknown, path: string) => {
      if (typeof v !== 'object' || v === null) return
      expect(seen.get(v), path).toBeUndefined()
      seen.set(v, path)
      // A table's layout is only its lines and padding, shared like pdfmake's own named layouts.
      Object.entries(v).forEach(([k, x]) => k !== 'layout' && walk(x, `${path}.${k}`))
    }
    walk(pdf(project()).content, 'content')
  })

  it('has no characters its font lacks', () => {
    expect(JSON.stringify(pdf(project()).content)).not.toMatch(/[✓⚠↗→]/)
  })
})
