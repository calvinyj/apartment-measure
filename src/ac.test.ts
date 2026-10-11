import { describe, expect, it } from 'vitest'
import { acZones, pickUnits } from './ac'
import { solveProject } from './geometry/solve'
import { DEFAULT_SETTINGS, type Edge, type Project, type Room, type RoomType } from './types'

function room(id: string, x: number, w: number, h: number, extra: Partial<Room> = {}): Room {
  const pts: [number, number][] = [[x, 0], [x + w, 0], [x + w, h], [x, h]]
  const edges: Edge[] = pts.map((_, i) => ({ id: `${id}-${i}`, kind: 'wall', measured: null, thickness: null, side: 'auto', openings: [] }))
  return { id, name: id, type: 'bedroom' as RoomType, points: pts.map(([x, y]) => ({ x, y })), edges, height: 2700, acZone: '', ac: null, sunny: null, ...extra }
}

function zones(rooms: Room[]) {
  const project: Project = {
    version: 3,
    north: null,
    lights: [],
    plugs: [],
    cabinets: [],
    name: 't',
    image: null,
    // 1 px = 10 mm
    calibration: { a: { x: 0, y: 0 }, b: { x: 100, y: 0 }, mm: 1000 },
    rooms,
    settings: { ...DEFAULT_SETTINGS, traceMode: 'inside' },
    advertised: null,
  }
  return acZones(solveProject(project), project.settings)
}

describe('pickUnits', () => {
  it('picks the smallest unit that covers the load', () => {
    expect(pickUnits(5900)).toMatchObject({ hp: 1, count: 1 })
    expect(pickUnits(11400)).toMatchObject({ hp: 1.5, count: 1 })
  })
  it('splits big open spaces across several units', () => {
    expect(pickUnits(30000)).toMatchObject({ hp: 2, count: 2 })
  })
})

describe('installed aircon', () => {
  // At 60 BTU/ft² and the reference ceiling: 3×3 m ≈ 5,800, 5×4 m ≈ 12,900, 6×4 m ≈ 15,500 BTU/h.
  it('suggests a unit when nothing is installed', () => {
    const [z] = zones([room('bed', 0, 300, 300)])
    expect(z.installed).toEqual([])
    expect(z.enough).toBeNull()
    expect(z.units).toMatchObject({ hp: 1 })
  })

  it('is enough when the unit covers the estimate, allowing 10% short', () => {
    const [big, close] = zones([room('big', 0, 300, 300, { acInstalled: 1 }), room('close', 1000, 500, 400, { acInstalled: 1.5 })])
    expect(big.enough).toBe(true)
    expect(close.btu).toBeGreaterThan(12000)
    expect(close.enough).toBe(true)
  })

  it('is not enough beyond the allowance', () => {
    const [z] = zones([room('living', 0, 600, 400, { acInstalled: 1.5 })])
    expect(z.installedBtu).toBe(12000)
    expect(z.enough).toBe(false)
    expect(z.units).toMatchObject({ hp: 2, count: 1 })
  })

  it('adds up the units in all rooms of a zone', () => {
    const [z] = zones([
      room('living', 0, 600, 400, { acZone: 'Open plan', acInstalled: 1.5 }),
      room('dining', 1000, 300, 300, { acZone: 'Open plan', acInstalled: 1 }),
    ])
    expect(z.installed.map((u) => u.room)).toEqual(['living', 'dining'])
    expect(z.installedBtu).toBe(21000)
    expect(z.enough).toBe(true)
  })

  it('counts a room with a unit as cooled, unless it is marked as not needing aircon', () => {
    const kitchen = room('kitchen', 0, 300, 300, { type: 'kitchen', acInstalled: 1 })
    expect(zones([kitchen]).map((z) => z.name)).toEqual(['kitchen'])
    expect(zones([{ ...kitchen, ac: false }])).toEqual([])
  })
})
