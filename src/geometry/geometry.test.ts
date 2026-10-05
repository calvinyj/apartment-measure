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
    sunny: false,
  }
}

describe('solveProject', () => {
  // Two 3×3 m rooms side by side, drawn at 1 px = 10 mm with a 15 px (150 mm) wall between.
  const project: Project = {
    version: 2,
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
