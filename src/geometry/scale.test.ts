import { describe, expect, it } from 'vitest'
import { fitScale, withScale } from './scale'
import { DEFAULT_SETTINGS, type Edge, type Project, type Room, type Settings } from '../types'

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

/** Rooms drawn at 1 px = 10 mm, with the scale line saying 1 px = `k` mm. */
function project(rooms: Room[], k: number, settings: Partial<Settings> = {}): Project {
  return {
    version: 3,
    north: null,
    lights: [],
    plugs: [],
    cabinets: [],
    name: 'scale',
    image: null,
    calibration: { a: { x: 0, y: 0 }, b: { x: 100, y: 0 }, mm: 100 * k },
    rooms,
    settings: { ...DEFAULT_SETTINGS, internalThickness: 100, externalThickness: 200, ...settings },
    advertised: null,
  }
}

describe('fitScale', () => {
  // Two 3 m rooms traced on their inside faces, a 150 mm wall between them.
  const a = (m: (number | null)[]) => room('a', [[0, 0], [300, 0], [300, 300], [0, 300]], m)
  const b = (m: (number | null)[]) => room('b', [[315, 0], [615, 0], [615, 300], [315, 300]], m)
  const all = [3000, 3000, 3000, 3000]

  it('needs at least one measured wall', () => {
    expect(fitScale(project([a([null, null, null, null])], 9.5))).toBeNull()
  })

  it('finds the real scale when the plan was drawn too small', () => {
    const p = project([a(all), b(all)], 9.5)
    const fit = fitScale(p)!
    expect(fit.mmPerPx).toBeCloseTo(10, 4)
    expect(fit.factor).toBeCloseTo(10 / 9.5, 4)
    expect(fit.used).toBe(8)
    expect(fit.outliers).toBe(0)
    // Applying it leaves nothing more to fit.
    const again = fitScale({ ...p, calibration: withScale(p.calibration!, fit.mmPerPx) })!
    expect(again.factor).toBeCloseTo(1, 6)
  })

  it('leaves out a reading far off the plan', () => {
    const fit = fitScale(project([a([3000, 3000, 300, 3000]), b(all)], 9.5))!
    expect(fit.mmPerPx).toBeCloseTo(10, 4)
    expect(fit.used).toBe(7)
    expect(fit.outliers).toBe(1)
  })

  it('allows for the wall thickness between centre lines and inside faces', () => {
    // Traced down the middle of each wall: inside faces are 2850 × 2800 mm.
    const c = room('a', [[0, 0], [300, 0], [300, 300], [0, 300]], [2850, 2800, 2850, 2800])
    const d = room('b', [[300, 0], [600, 0], [600, 300], [300, 300]], [2850, 2800, 2850, 2800])
    expect(fitScale(project([c, d], 10.5))!.mmPerPx).toBeCloseTo(10, 4)
  })

  it('settles when the gap between rooms changes with the scale', () => {
    // A 100 mm gap on the plan for a 150 mm wall: 25 mm of it sits inside each room.
    const c = room('a', [[0, 0], [300, 0], [300, 300], [0, 300]], [2975, 3000, 2975, 3000])
    const d = room('b', [[310, 0], [610, 0], [610, 300], [310, 300]], [2975, 3000, 2975, 3000])
    expect(fitScale(project([c, d], 9, { internalThickness: 150 }))!.mmPerPx).toBeCloseTo(10, 4)
  })
})
