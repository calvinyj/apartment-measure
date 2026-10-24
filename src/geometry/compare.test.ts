import { describe, expect, it } from 'vitest'
import { compareRoom, compareWalls } from './compare'
import { solveProject } from './solve'
import { DEFAULT_SETTINGS, type Edge, type Project, type Room, type Settings } from '../types'

// Drawn at 1 px = 10 mm, along the inside faces unless said otherwise.
function project(pts: [number, number][], measured: (number | null)[], open: number[] = [], settings: Partial<Settings> = {}): Project {
  const edges: Edge[] = pts.map((_, i) => ({
    id: `e${i}`,
    kind: open.includes(i) ? 'open' : 'wall',
    measured: measured[i],
    thickness: null,
    side: 'auto',
    openings: [],
  }))
  const room: Room = {
    id: 'r',
    name: 'Bedroom',
    type: 'bedroom',
    points: pts.map(([x, y]) => ({ x, y })),
    edges,
    height: null,
    acZone: '',
    ac: null,
    sunny: null,
  }
  return {
    version: 3,
    name: 't',
    image: null,
    calibration: { a: { x: 0, y: 0 }, b: { x: 100, y: 0 }, mm: 1000 },
    rooms: [room],
    settings: { ...DEFAULT_SETTINGS, traceMode: 'inside', ...settings },
    advertised: null,
    north: null,
    lights: [],
    plugs: [],
    cabinets: [],
    furniture: [],
  }
}

const RECT: [number, number][] = [[0, 0], [400, 0], [400, 300], [0, 300]]

function compare(pts: [number, number][], measured: (number | null)[]) {
  const s = solveProject(project(pts, measured)).rooms[0]
  return compareRoom(s, DEFAULT_SETTINGS.closureTolerance)
}

describe('compareRoom', () => {
  it('passes a room measured as planned', () => {
    const walls = compare(RECT, [4005, 3000, 3995, 2990])
    expect(walls.map((w) => w.verdict)).toEqual(['ok', 'ok', 'ok', 'ok'])
    expect(walls[0].plan).toBeCloseTo(4000)
    expect(walls[0].others).toBeCloseTo(3995, 0)
  })

  it('picks out a misread: the wall across and the plan agree', () => {
    const walls = compare(RECT, [4000, 3000, 3850, 3000])
    expect(walls[2].verdict).toBe('recheck')
    expect(walls[2].others).toBeCloseTo(4000, 0)
    expect(walls[0].verdict).toBe('ok')
  })

  it('tells a room built smaller than drawn from a misread', () => {
    const walls = compare(RECT, [3850, 3000, 3850, 3000])
    expect(walls[0].verdict).toBe('differs')
    expect(walls[2].verdict).toBe('differs')
    expect(walls[1].verdict).toBe('ok')
  })

  it('flags two walls that disagree when neither stands out from the plan', () => {
    const walls = compare(RECT, [4040, 3000, 3960, 3000])
    expect(walls[0].verdict).toBe('conflict')
    expect(walls[2].verdict).toBe('conflict')
  })

  it('leaves a wall off the plan unchecked while the wall across is unmeasured', () => {
    const walls = compare(RECT, [3850, 3000, null, 3000])
    expect(walls.map((w) => w.n)).toEqual([1, 2, 4])
    expect(walls[0].verdict).toBe('unchecked')
    expect(walls[0].others).toBeNull()
    // The skipped wall runs across the other two, so it doesn't stop them checking each other.
    expect(walls[1].others).toBeCloseTo(3000, 0)
  })

  it('checks a wall of an L-shaped room against the two walls across it', () => {
    // 4 × 3 m, with a 2 × 1 m corner out of it.
    const L: [number, number][] = [[0, 0], [400, 0], [400, 200], [200, 200], [200, 300], [0, 300]]
    const walls = compare(L, [4000, 2000, 2000, 1000, 1850, 3000])
    expect(walls[4].verdict).toBe('recheck')
    expect(walls[4].others).toBeCloseTo(2000, 0)
    // The others are as planned, and the misread throws off what their walls across make them.
    expect(walls[0].verdict).toBe('ok')
    expect(walls[2].verdict).toBe('ok')
  })

  it('sees a room that closes once its open side is flush with the wall beside it', () => {
    // Traced on wall centres: the top is open for its first half, then a 200 mm wall whose face is 100 mm in.
    const pts: [number, number][] = [[0, 0], [200, 0], [400, 0], [400, 300], [0, 300]]
    const p = project(pts, [null, 1900, 2800, 3800, 2800], [0], { traceMode: 'centre', externalThickness: 200 })
    const walls = compareRoom(solveProject(p).rooms[0], DEFAULT_SETTINGS.closureTolerance)
    const left = walls.find((w) => w.group[0] === 4)!
    expect(left.plan).toBeCloseTo(2900)
    expect(left.others).toBeCloseTo(2900, 0)
    expect(left.flush).toBeCloseTo(2800, 0)
    expect(left.verdict).toBe('step')
    expect(walls.find((w) => w.group[0] === 2)!.verdict).toBe('ok')
  })

  it('compares a straight wall traced in parts as one wall', () => {
    const pts: [number, number][] = [[0, 0], [200, 0], [400, 0], [400, 300], [0, 300]]
    const walls = compare(pts, [1925, 1925, 3000, 4000, 3000])
    expect(walls[0].group).toEqual([0, 1])
    expect(walls[0].plan).toBeCloseTo(4000)
    expect(walls[0].verdict).toBe('recheck')
    expect(walls[0].others).toBeCloseTo(4000, 0)
  })

  it('goes through every room', () => {
    const p = project(RECT, [4000, 3000, 3850, 3000])
    const walls = compareWalls(solveProject(p), DEFAULT_SETTINGS.closureTolerance)
    expect(walls).toHaveLength(4)
    expect(walls.every((w) => w.roomId === 'r')).toBe(true)
  })
})
