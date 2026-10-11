import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS, type Edge, type Project, type Room } from '../types'
import { solveProject } from './solve'
import { roomWallPieces } from './walls'

function room(id: string, pts: [number, number][]): Room {
  const edges: Edge[] = pts.map((_, i) => ({ id: `${id}-${i}`, kind: 'wall', measured: null, thickness: null, side: 'auto', openings: [] }))
  return { id, name: id, type: 'bedroom', points: pts.map(([x, y]) => ({ x, y })), edges, height: 2700, acZone: '', ac: null, sunny: null }
}

describe('roomWallPieces', () => {
  // 1 px = 10 mm; two 3 m rooms with a 100 mm wall between them.
  const a = room('a', [[0, 0], [300, 0], [300, 300], [0, 300]])
  const b = room('b', [[310, 0], [610, 0], [610, 300], [310, 300]])
  // Door drawn only on room A's side of the shared wall (edge 1), 1 m from its start.
  a.edges[1].openings = [{ id: 'd', kind: 'door', offset: 1000, width: 900, height: 2100, sill: 0 }]
  // Window on room B's outside wall (edge 1, x = 6100).
  b.edges[1].openings = [{ id: 'w', kind: 'window', offset: 1000, width: 1200, height: 1200, sill: 900 }]
  const project: Project = {
    version: 3,
    north: null,
    lights: [],
    plugs: [],
    cabinets: [],
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
    expect(lintel[0].fullHeight).toBe(true)
  })

  it('tells a sill under a window from the full-height top', () => {
    const r = solved.byId.get('b')!
    const pieces = roomWallPieces(solved, r, Infinity).filter((p) => p.edge === 1)
    expect(pieces.filter((p) => p.y1 === 900).every((p) => !p.fullHeight)).toBe(true)
    expect(pieces.some((p) => p.y1 === 900)).toBe(true)
    expect(pieces.filter((p) => p.y1 === 2700).every((p) => p.fullHeight)).toBe(true)
    // Cut at 1.2 m, the cut is the top, even where the window starts below it.
    const cut = roomWallPieces(solved, r, 1200).filter((p) => p.edge === 1)
    expect(cut.filter((p) => p.y1 === 1200).every((p) => p.fullHeight)).toBe(true)
  })

  it('marks only the face away from the room as outer', () => {
    const r = solved.byId.get('a')!
    // Edge 3 is the outside wall on the left; its outer face is a full wall thickness further left.
    const outerX = r.starts[3].x - r.edgeInfo[3].ownThickness
    const left = roomWallPieces(solved, r, Infinity).filter((p) => p.edge === 3)
    expect(left.length).toBeGreaterThan(0)
    for (const p of left) {
      expect(p.outer.filter(Boolean).length).toBe(1)
      const i = p.outer.indexOf(true)
      expect(p.footprint[i].x).toBeCloseTo(outerX)
      expect(p.footprint[(i + 1) % p.footprint.length].x).toBeCloseTo(outerX)
    }
  })
})

describe('a side that is partly open and partly wall', () => {
  // Like a balcony: the top edge is open for 3.9 m, then a 1.25 m wall on the same line.
  const r = room('bal', [[0, 0], [390, 0], [515, 0], [515, 150], [0, 150]])
  r.edges[0].kind = 'open'
  const project: Project = {
    version: 3,
    north: null,
    lights: [],
    plugs: [],
    cabinets: [],
    name: 't',
    image: null,
    calibration: { a: { x: 0, y: 0 }, b: { x: 100, y: 0 }, mm: 1000 },
    rooms: [r],
    settings: { ...DEFAULT_SETTINGS, traceMode: 'centre', externalThickness: 200 },
    advertised: null,
  }
  const solved = solveProject(project)
  const s = solved.byId.get('bal')!

  it('keeps every wall piece next to the room (no runaway mitres)', () => {
    for (const p of roomWallPieces(solved, s, Infinity)) {
      for (const q of p.footprint) {
        expect(q.x).toBeGreaterThan(-250)
        expect(q.x).toBeLessThan(5150 + 250)
        expect(q.y).toBeGreaterThan(-250)
        expect(q.y).toBeLessThan(1500 + 250)
      }
    }
  })

  it('keeps the open stretch straight and steps down to the wall face', () => {
    // Open part stays on the traced line; the wall part's inside face is 100 mm in (half of 200).
    expect(s.planStarts[0].y).toBeCloseTo(0)
    expect(s.planEnds[0].y).toBeCloseTo(0)
    expect(s.planStarts[1].y).toBeCloseTo(100)
    expect(s.planEnds[1].y).toBeCloseTo(100)
    // (5050 − 100) × (1400 − 0), minus the 1150 × 100 strip under the short wall.
    expect(s.area / 1e6).toBeCloseTo((4950 * 1400 - 1150 * 100) / 1e6, 4)
  })

  it('keeps the built-up area within the outer box', () => {
    // Traced box grown by half an external wall on every side, at most.
    expect(solved.grossArea / 1e6).toBeLessThanOrEqual((5150 + 200) * (1500 + 200) / 1e6 + 1e-6)
  })
})
