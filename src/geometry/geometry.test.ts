import { describe, expect, it } from 'vitest'
import { closeRoom } from './closure'
import { area, offsetPolygon, signedArea } from './polygon'
import { solveProject } from './solve'
import { DEFAULT_SETTINGS, type Edge, type Project, type Room, type Vec2 } from '../types'

const R = { x: 1, y: 0 }
const D = { x: 0, y: 1 }
const L = { x: -1, y: 0 }
const U = { x: 0, y: -1 }

describe('closeRoom', () => {
  it('leaves a perfectly measured rectangle untouched', () => {
    const r = closeRoom([
      { dir: R, length: 4000, measured: true },
      { dir: D, length: 3000, measured: true },
      { dir: L, length: 4000, measured: true },
      { dir: U, length: 3000, measured: true },
    ])
    expect(r.measuredError).toBeCloseTo(0)
    r.lengths.forEach((l, i) => expect(l).toBeCloseTo([4000, 3000, 4000, 3000][i]))
    expect(r.checkable).toBe('full')
  })

  it('splits a 10 mm disagreement between opposite walls', () => {
    const r = closeRoom([
      { dir: R, length: 4000, measured: true },
      { dir: D, length: 3010, measured: true },
      { dir: L, length: 4000, measured: true },
      { dir: U, length: 3000, measured: true },
    ])
    expect(r.measuredError).toBeCloseTo(10, 0)
    expect(r.lengths[1]).toBeCloseTo(3005, 0)
    expect(r.lengths[3]).toBeCloseTo(3005, 0)
  })

  it('derives a single skipped wall from the others', () => {
    const r = closeRoom([
      { dir: R, length: 4000, measured: true },
      { dir: D, length: 3000, measured: true },
      { dir: L, length: 3800, measured: false }, // plan guess is wrong
      { dir: U, length: 3000, measured: true },
    ])
    expect(r.lengths[2]).toBeCloseTo(4000, 0)
    expect(r.determined).toBe(true)
    expect(r.checkable).toBe('partial')
  })

  it('flags parallel skipped walls as undetermined', () => {
    const r = closeRoom([
      { dir: R, length: 4000, measured: false },
      { dir: D, length: 3000, measured: true },
      { dir: L, length: 4000, measured: false },
      { dir: U, length: 3000, measured: true },
    ])
    expect(r.determined).toBe(false)
  })
})

describe('polygon', () => {
  const sq: Vec2[] = [
    { x: 0, y: 0 },
    { x: 1000, y: 0 },
    { x: 1000, y: 1000 },
    { x: 0, y: 1000 },
  ]
  it('treats clockwise-on-screen as positive', () => {
    expect(signedArea(sq)).toBe(1_000_000)
  })
  it('offsets outward with mitred corners', () => {
    const o = offsetPolygon(sq, [100, 100, 100, 100])
    expect(area(o)).toBeCloseTo(1200 * 1200)
  })
})

function room(id: string, pts: [number, number][], measured: (number | null)[]): Room {
  const edges: Edge[] = pts.map((_, i) => ({
    id: `${id}-${i}`,
    kind: 'wall',
    measured: measured[i],
    thickness: null,
    side: 'auto',
    openings: [],
  }))
  return {
    id,
    name: id,
    type: 'bedroom',
    points: pts.map(([x, y]) => ({ x, y })),
    edges,
    height: null,
    acZone: '',
    ac: null,
    sunny: null,
  }
}

describe('solveProject', () => {
  // Two 3×3 m rooms side by side, drawn at 1 px = 10 mm with a 15 px (150 mm) wall between.
  const project: Project = {
    version: 3,
    north: null,
    lights: [],
    plugs: [],
    cabinets: [],
    name: 't',
    image: null,
    calibration: { a: { x: 0, y: 0 }, b: { x: 100, y: 0 }, mm: 1000 },
    rooms: [
      room('a', [[0, 0], [300, 0], [300, 300], [0, 300]], [3000, 3000, 3000, 3000]),
      room('b', [[315, 0], [615, 0], [615, 300], [315, 300]], [3000, 3000, 3000, 3000]),
    ],
    settings: { ...DEFAULT_SETTINGS, internalThickness: 100, externalThickness: 200, externalShare: 1 },
    advertised: null,
  }

  it('classifies the shared wall as internal and the rest as external', () => {
    const s = solveProject(project)
    const a = s.byId.get('a')!
    expect(a.edgeInfo[1].side).toBe('internal')
    expect(a.edgeInfo[1].planGap).toBeCloseTo(150)
    expect(a.edgeInfo[0].side).toBe('external')
  })

  it('places rooms one measured wall thickness apart and sums the footprint', () => {
    const s = solveProject(project)
    const a = s.byId.get('a')!
    const b = s.byId.get('b')!
    const gap = b.outline[0].x - a.outline[1].x
    expect(gap).toBeCloseTo(100, 0)
    expect(s.netArea / 1e6).toBeCloseTo(18)
    // outer box: (3000*2 + 100 + 200*2) × (3000 + 200*2)
    expect(s.grossArea / 1e6).toBeCloseTo((6500 * 3400) / 1e6, 2)
  })
})

describe('rooms traced on wall centre lines', () => {
  // Two 3 m squares sharing the line x = 3000 mm, as if tracing down the middle of each wall.
  const project: Project = {
    version: 3,
    north: null,
    lights: [],
    plugs: [],
    cabinets: [],
    name: 'c',
    image: null,
    calibration: { a: { x: 0, y: 0 }, b: { x: 100, y: 0 }, mm: 1000 },
    rooms: [
      room('a', [[0, 0], [300, 0], [300, 300], [0, 300]], [null, null, null, null]),
      room('b', [[300, 0], [600, 0], [600, 300], [300, 300]], [null, null, null, null]),
    ],
    settings: { ...DEFAULT_SETTINGS, internalThickness: 100, externalThickness: 200, externalShare: 1 },
    advertised: null,
  }
  const s = solveProject(project)
  const a = s.byId.get('a')!
  const b = s.byId.get('b')!

  it('detects centre-line tracing and finds the inside faces', () => {
    expect(s.traceMode).toBe('centre')
    expect(a.edgeInfo[1].side).toBe('internal')
    // Inside faces: 100 mm in from outer centre lines (half of 200), 50 mm from the shared one.
    expect(a.estimates[0]).toBeCloseTo(3000 - 100 - 50)
    expect(a.estimates[1]).toBeCloseTo(3000 - 100 - 100)
  })

  it('keeps rooms where they were traced, one wall apart', () => {
    expect(a.outline[0].x).toBeCloseTo(100, 0)
    expect(a.outline[0].y).toBeCloseTo(100, 0)
    expect(b.outline[0].x - a.outline[1].x).toBeCloseTo(100, 0)
  })

  it('does not count walls in the net area, and counts them once in built-up', () => {
    expect(s.netArea / 1e6).toBeCloseTo((2 * 2850 * 2800) / 1e6, 3)
    // Outer faces sit half an external wall beyond the traced lines.
    expect(s.grossArea / 1e6).toBeCloseTo((6200 * 3200) / 1e6, 3)
  })
})

describe('a straight wall shared by several rooms', () => {
  // Living over dining (open between them) share the outside wall x = 0. To their right,
  // a study and a bath, then a store spanning both. The study measures 100 mm wider than
  // the plan, which pushes the living room left; the outside wall must stay straight.
  const living = room('living', [[0, 0], [300, 0], [300, 200], [0, 200]], [null, null, null, null])
  living.edges[2].kind = 'open'
  const dining = room('dining', [[0, 200], [300, 200], [300, 400], [0, 400]], [null, null, null, null])
  dining.edges[0].kind = 'open'
  const project: Project = {
    version: 3,
    north: null,
    lights: [],
    plugs: [],
    cabinets: [],
    name: 'flush',
    image: null,
    calibration: { a: { x: 0, y: 0 }, b: { x: 100, y: 0 }, mm: 1000 },
    rooms: [
      living,
      dining,
      room('study', [[315, 0], [500, 0], [500, 185], [315, 185]], [1950, 1850, 1950, 1850]),
      room('bath', [[315, 200], [500, 200], [500, 400], [315, 400]], [null, null, null, null]),
      room('store', [[515, 0], [700, 0], [700, 400], [515, 400]], [null, null, null, null]),
    ],
    settings: { ...DEFAULT_SETTINGS, traceMode: 'inside', internalThickness: 150 },
    advertised: null,
  }
  const s = solveProject(project)

  it('keeps the outside wall straight across the rooms', () => {
    const livingWall = s.byId.get('living')!.starts[3].x
    const diningWall = s.byId.get('dining')!.starts[3].x
    expect(Math.abs(livingWall - diningWall)).toBeLessThan(2)
  })
})
