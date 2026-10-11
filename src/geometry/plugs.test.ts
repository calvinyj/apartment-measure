import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS, type Edge, type Opening, type PlugPoint, type Project, type Room } from '../types'
import { roomAnchors } from './lights'
import { bySize, inDoorway, plugSchedule, plugSpot, wallSpot } from './plugs'
import { solveProject } from './solve'

function room(id: string, pts: [number, number][]): Room {
  const edges: Edge[] = pts.map((_, i) => ({
    id: `${id}-${i}`,
    kind: 'wall',
    measured: null,
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
    height: 2700,
    acZone: '',
    ac: null,
    sunny: null,
  }
}

// 1 px = 10 mm. Room A is 4 m × 3 m, room B (3 m × 3 m) beyond a 100 mm wall to its right.
function project(rooms: Room[]): Project {
  return {
    version: 3,
    north: null,
    lights: [],
    plugs: [],
    cabinets: [],
    name: 't',
    image: null,
    calibration: { a: { x: 0, y: 0 }, b: { x: 100, y: 0 }, mm: 1000 },
    rooms,
    settings: { ...DEFAULT_SETTINGS, internalThickness: 100 },
    advertised: null,
  }
}
const rect = (id: string, x0: number, x1: number) =>
  room(id, [
    [x0, 0],
    [x1, 0],
    [x1, 300],
    [x0, 300],
  ])
const door = (offset: number, patch: Partial<Opening> = {}): Opening => ({
  id: 'd',
  kind: 'door',
  offset,
  width: 900,
  height: 2100,
  sill: 0,
  ...patch,
})
const plug = (patch: Partial<PlugPoint>): PlugPoint => ({
  id: 'p',
  roomId: 'a',
  x: 0,
  y: 0,
  count: 2,
  existing: true,
  note: '',
  ...patch,
})

describe('plug points', () => {
  const solved = solveProject(project([rect('a', 0, 400), rect('b', 410, 710)]))
  const A = solved.byId.get('a')!

  it('goes on the nearest wall, at the foot of the point', () => {
    const s = wallSpot(A, { x: 2000, y: 300 })!
    expect(s.edge).toBe(0)
    expect(s.at.x).toBeCloseTo(2000)
    expect(s.at.y).toBeCloseTo(0)
    expect(s.a).toEqual(A.starts[0])
    expect(s.b).toEqual(A.ends[0])
  })

  it('skips open sides, and a room with no walls has nowhere to put one', () => {
    const open = rect('a', 0, 400)
    open.edges[0].kind = 'open'
    const r = solveProject(project([open])).byId.get('a')!
    const s = wallSpot(r, { x: 1000, y: 300 })!
    expect(s.edge).toBe(3) // the left wall, 1000 mm away, rather than the open top 300 mm away
    expect(s.at.x).toBeCloseTo(0)
    open.edges.forEach((e) => (e.kind = 'open'))
    expect(wallSpot(solveProject(project([open])).byId.get('a')!, { x: 1000, y: 300 })).toBeNull()
  })

  it('stays on its wall as measurements change the room', () => {
    const anchors = roomAnchors(solved)
    const p = plug({ x: 0, y: -1500 }) // the middle of the top wall
    const longer = rect('a', 0, 400)
    longer.edges[0].measured = 4400
    longer.edges[2].measured = 4400
    longer.edges[1].measured = 3000
    const after = solveProject(project([longer, rect('b', 410, 710)]))
    const s = plugSpot(after, roomAnchors(after), p)!
    expect(s.edge).toBe(0)
    const top = after.byId.get('a')!
    expect(s.at.y).toBeCloseTo(top.starts[0].y)
    expect(s.at.x).toBeCloseTo((top.starts[0].x + top.ends[0].x) / 2)
    expect(plugSpot(solved, anchors, plug({ roomId: 'gone' }))).toBeNull()
  })

  it('knows when it’s in a doorway, from either side of the wall', () => {
    const a = rect('a', 0, 400)
    a.edges[0].openings = [door(1000)]
    // B's left wall runs up from its bottom corner: 1000–1900 mm up from the bottom is y 2000–1100.
    const b = rect('b', 410, 710)
    b.edges[3].openings = [door(1000)]
    const s = solveProject(project([a, b]))
    const r = s.byId.get('a')!
    const at = (x: number, y: number) => inDoorway(s, r, wallSpot(r, { x, y })!)
    expect(at(1400, 200)).toBe(true)
    expect(at(2500, 200)).toBe(false)
    expect(at(3800, 1500)).toBe(true) // B's door, on A's right wall
    expect(at(3800, 600)).toBe(false)
    a.edges[0].openings = [door(1000, { kind: 'window', sill: 900, height: 1200 })]
    const w = solveProject(project([a]))
    const rw = w.byId.get('a')!
    expect(inDoorway(w, rw, wallSpot(rw, { x: 1400, y: 200 })!)).toBe(false) // under a window is fine
  })

  it('counts points and sockets room by room, existing and new', () => {
    const rows = plugSchedule(
      [rect('a', 0, 400), rect('b', 410, 710), rect('c', 720, 900)],
      [
        plug({ id: '1', count: 2 }),
        plug({ id: '2', count: 1 }),
        plug({ id: '3', count: 2, existing: false }),
        plug({ id: '4', roomId: 'c', count: 3, existing: false }),
        plug({ id: '5', roomId: 'gone' }),
      ],
    )
    expect(rows.map((r) => r.room.id)).toEqual(['a', 'c'])
    expect(rows[0]).toMatchObject({ existing: { points: 2, sockets: 3 }, toAdd: { points: 1, sockets: 2 } })
    expect(rows[0].existingPlugs.map((p) => p.id)).toEqual(['1', '2'])
    expect(rows[0].toAddPlugs.map((p) => p.id)).toEqual(['3'])
    expect(rows[1]).toMatchObject({ existing: { points: 0, sockets: 0 }, toAdd: { points: 1, sockets: 3 } })
    expect(bySize([2, 1, 2, 3, 2])).toEqual([
      [1, 1],
      [2, 3],
      [3, 1],
    ])
  })
})
