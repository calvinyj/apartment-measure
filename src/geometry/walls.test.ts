import { describe, expect, it } from 'vitest'
import { pickUnits } from '../ac'
import { DEFAULT_SETTINGS, type Edge, type Project, type Room } from '../types'
import { solveProject } from './solve'
import { roomWallPieces } from './walls'

function room(id: string, pts: [number, number][]): Room {
  const edges: Edge[] = pts.map((_, i) => ({ id: `${id}-${i}`, kind: 'wall', measured: null, thickness: null, side: 'auto', openings: [] }))
  return { id, name: id, type: 'bedroom', points: pts.map(([x, y]) => ({ x, y })), edges, height: 2700, acZone: '', ac: null, sunny: false }
}

describe('roomWallPieces', () => {
  // 1 px = 10 mm; two 3 m rooms with a 100 mm wall between them.
  const a = room('a', [[0, 0], [300, 0], [300, 300], [0, 300]])
  const b = room('b', [[310, 0], [610, 0], [610, 300], [310, 300]])
  // Door drawn only on room A's side of the shared wall (edge 1), 1 m from its start.
  a.edges[1].openings = [{ id: 'd', kind: 'door', offset: 1000, width: 900, height: 2100, sill: 0 }]
  const project: Project = {
    version: 2,
    name: 't',
    image: null,
    calibration: { a: { x: 0, y: 0 }, b: { x: 100, y: 0 }, mm: 1000 },
    rooms: [a, b],
    settings: { ...DEFAULT_SETTINGS, internalThickness: 100 },
    advertised: null,
  }
  const solved = solveProject(project)

  /** Is there solid wall at 1 m height, inside the shared wall, `y` mm along it? */
  const blockedAt = (roomId: string, y: number) => {
    const r = solved.byId.get(roomId)!
    const shared = roomId === 'a' ? { x: 3000 + 25, y } : { x: 3100 - 25, y }
    return roomWallPieces(solved, r, Infinity).some((p) => {
      const xs = p.footprint.map((q) => q.x)
      const ys = p.footprint.map((q) => q.y)
      const inside =
        shared.x >= Math.min(...xs) && shared.x <= Math.max(...xs) && shared.y >= Math.min(...ys) && shared.y <= Math.max(...ys)
      return inside && p.y0 <= 1000 && p.y1 >= 1000
    })
  }

  it('cuts the door through both halves of a shared wall', () => {
    // Door spans 1000–1900 mm along the wall.
    expect(blockedAt('a', 1450)).toBe(false)
    expect(blockedAt('b', 1450)).toBe(false)
    expect(blockedAt('a', 500)).toBe(true)
    expect(blockedAt('b', 2500)).toBe(true)
  })

  it('keeps the lintel above the door', () => {
    const r = solved.byId.get('a')!
    const lintel = roomWallPieces(solved, r, Infinity).filter((p) => p.y0 === 2100 && p.y1 === 2700)
    expect(lintel.length).toBe(1)
  })
})

describe('pickUnits', () => {
  it('picks the smallest unit that covers the load', () => {
    expect(pickUnits(5900)).toMatchObject({ hp: '1.0 HP', count: 1 })
    expect(pickUnits(11400)).toMatchObject({ hp: '1.5 HP', count: 1 })
  })
  it('splits big open spaces across several units', () => {
    expect(pickUnits(30000)).toMatchObject({ hp: '2.0 HP', count: 2 })
  })
})
