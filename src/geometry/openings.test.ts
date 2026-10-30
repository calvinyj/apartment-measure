import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS, type Edge, type Opening, type Project, type Room } from '../types'
import { openingList } from './openings'
import { solveProject } from './solve'

// 1 px = 10 mm, traced along the inside faces. A is 4 m by 3 m; B is next to it, past a 150 mm wall.
function room(id: string, pts: [number, number][]): Room {
  const edges: Edge[] = pts.map((_, i) => ({ id: `${id}${i}`, kind: 'wall', measured: null, thickness: null, side: 'auto', openings: [] }))
  return { id, name: id, type: 'bedroom', points: pts.map(([x, y]) => ({ x, y })), edges, height: 2700, acZone: '', ac: null, sunny: null }
}
const A = () => room('A', [[0, 0], [400, 0], [400, 300], [0, 300]])
const B = () => room('B', [[415, 0], [715, 0], [715, 300], [415, 300]])

function list(rooms: Room[], north: number | null = 0) {
  const project: Project = {
    version: 3,
    north,
    lights: [],
    plugs: [],
    cabinets: [],
    furniture: [],
    name: 't',
    image: null,
    calibration: { a: { x: 0, y: 0 }, b: { x: 100, y: 0 }, mm: 1000 },
    rooms,
    settings: { ...DEFAULT_SETTINGS, traceMode: 'inside' },
    advertised: null,
  }
  return openingList(solveProject(project))
}

const door = (id: string, offset: number): Opening => ({ id, kind: 'door', offset, width: 900, height: 2100, sill: 0 })
const window_ = (id: string, offset: number): Opening => ({ id, kind: 'window', offset, width: 1200, height: 1200, sill: 900 })

describe('openingList', () => {
  it('lists each with its wall, the room beyond and the way it faces, wall by wall', () => {
    const a = A()
    a.edges[3].openings = [window_('w', 1000)]
    a.edges[1].openings = [door('d', 1000)]
    a.edges[0].openings = [window_('n', 500)]
    const rows = list([a, B()])
    expect(rows.map((o) => [o.opening.id, o.wallNo, o.beyond?.id ?? null, o.faces, Math.round(o.from)])).toEqual([
      ['n', 1, null, 'N', 500],
      ['d', 2, 'B', null, 1000],
      ['w', 4, null, 'W', 1000],
    ])
  })

  it('leaves out which way it faces until north is set', () => {
    const a = A()
    a.edges[3].openings = [window_('w', 1000)]
    expect(list([a], null)[0].faces).toBeNull()
  })

  it('places one on a straight wall traced in parts from corner A, in order along it', () => {
    const a = room('A', [[0, 0], [200, 0], [400, 0], [400, 300], [0, 300]])
    a.edges[0].openings = [door('far', 2500)]
    a.edges[1].openings = [door('near', 100)]
    const rows = list([a])
    expect(rows.map((o) => [o.opening.id, o.wallNo, Math.round(o.from)])).toEqual([
      ['near', 1, 2100],
      ['far', 1, 2500],
    ])
  })

  it('leaves out one on a side with no wall', () => {
    const a = A()
    a.edges[1].openings = [door('d', 1000)]
    a.edges[1].kind = 'open'
    expect(list([a])).toEqual([])
  })
})
