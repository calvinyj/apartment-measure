import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS, type Edge, type Pillar, type Project, type Room } from '../types'
import { wallDistances } from './lights'
import { pillarArea, wallFaceLength, wallFaces } from './pillars'
import { wallSpot } from './plugs'
import { signedArea } from './polygon'
import { solveProject } from './solve'
import { roomWallPieces } from './walls'

// 1 px = 10 mm, traced along the inside faces. Room A is 4 m (walls 1 and 3) by 3 m (walls 2 and 4).
function room(pts: [number, number][] = [[0, 0], [400, 0], [400, 300], [0, 300]]): Room {
  const edges: Edge[] = pts.map((_, i) => ({ id: `e${i}`, kind: 'wall', measured: null, thickness: null, side: 'auto', openings: [] }))
  return { id: 'A', name: 'A', type: 'kitchen', points: pts.map(([x, y]) => ({ x, y })), edges, height: 2700, acZone: '', ac: null, sunny: null }
}

function projectOf(r: Room): Project {
  return {
    version: 3,
    north: null,
    lights: [],
    plugs: [],
    cabinets: [],
    furniture: [],
    name: 't',
    image: null,
    calibration: { a: { x: 0, y: 0 }, b: { x: 100, y: 0 }, mm: 1000 },
    rooms: [r],
    settings: { ...DEFAULT_SETTINGS, traceMode: 'inside' },
    advertised: null,
  }
}

const solved = (r: Room) => solveProject(projectOf(r)).byId.get(r.id)!

const pillar = (patch: Partial<Pillar> = {}): Pillar => ({ id: 'p', offset: 1000, width: 400, depth: 300, ...patch })
const withPillars = (edge: number, ...pillars: Pillar[]) => {
  const r = room()
  r.edges[edge].pillars = pillars
  return r
}
const round = (p: { x: number; y: number }) => ({ x: Math.round(p.x), y: Math.round(p.y) })

describe('pillars', () => {
  it('leave the floor they stand on out of the area', () => {
    expect(solved(room()).area).toBeCloseTo(12e6)
    const s = solved(withPillars(0, pillar()))
    expect(s.pillarArea).toBeCloseTo(400 * 300)
    expect(s.area).toBeCloseTo(12e6 - 400 * 300)
    // Overlapping ones count once.
    const two = solved(withPillars(0, pillar(), pillar({ id: 'q', offset: 1200 })))
    expect(two.pillarArea).toBeCloseTo(600 * 300)
    expect(pillarArea(two.outline, [])).toBe(0)
  })

  it('stand in a corner of the whole straight wall, wherever its length puts it', () => {
    const r = withPillars(0, pillar({ at: 'b' }))
    r.edges[0].measured = 5000
    r.edges[2].measured = 5000
    const s = solved(r)
    const [a, b, , d] = s.pillars[0].footprint.map(round)
    expect(b).toEqual(round(s.ends[0]))
    expect(a).toEqual(round({ x: s.ends[0].x - 400, y: s.ends[0].y }))
    expect(d).toEqual(round({ x: s.ends[0].x - 400, y: s.ends[0].y + 300 }))

    // Wall 1 traced in two parts: corner A is the start of the first, corner B the end of the second.
    const split = room([[0, 0], [200, 0], [400, 0], [400, 300], [0, 300]])
    split.edges[0].pillars = [pillar({ at: 'b' }), pillar({ id: 'q', at: 'a' })]
    const t = solved(split)
    expect(t.pillars.map((p) => round(p.footprint[1]))).toEqual([round(t.ends[1]), round({ x: t.starts[0].x + 400, y: t.starts[0].y })])
  })

  it('hide the wall behind them and add their faces that are out in the room', () => {
    // Mid-wall: its front and both sides.
    const mid = solved(withPillars(0, pillar()))
    expect(wallFaceLength(solved(room()))).toBeCloseTo(14000)
    expect(wallFaceLength(mid)).toBeCloseTo(14000 + 2 * 300)
    expect(wallFaces(mid).filter((f) => f.pillar).map((f) => [round(f.a), round(f.b)])).toEqual([
      [{ x: 1000, y: 0 }, { x: 1000, y: 300 }],
      [{ x: 1000, y: 300 }, { x: 1400, y: 300 }],
      [{ x: 1400, y: 300 }, { x: 1400, y: 0 }],
    ])
    // In a corner: one side is against the next wall, which it hides as much as it covers.
    const corner = solved(withPillars(0, pillar({ at: 'b' })))
    expect(wallFaceLength(corner)).toBeCloseTo(14000)
    expect(wallFaces(corner).filter((f) => f.pillar)).toHaveLength(2)
    const wall2 = wallFaces(corner).filter((f) => !f.pillar && f.edge === 1)
    expect(wall2.map((f) => [round(f.a), round(f.b)])).toEqual([[{ x: 4000, y: 300 }, { x: 4000, y: 3000 }]])
    // A traced corner that isn't quite square still hides the next wall up to its face.
    const skew = room([[0, 0], [400, 0], [402, 300], [0, 300]])
    skew.edges[0].pillars = [pillar({ at: 'b' })]
    const along = wallFaces(solved(skew)).filter((f) => !f.pillar && f.edge === 1)
    expect(along).toHaveLength(1)
    expect(Math.round(along[0].a.y)).toBeGreaterThanOrEqual(298)
  })

  it('take plug points on their faces, and end the stretch of wall beside them', () => {
    const s = solved(withPillars(0, pillar()))
    const front = wallSpot(s, { x: 1200, y: 350 })!
    expect(front.pillar).toBe('p')
    expect(round(front.at)).toEqual({ x: 1200, y: 300 })
    expect([round(front.a), round(front.b)]).toEqual([{ x: 1000, y: 300 }, { x: 1400, y: 300 }])
    // Tapped on the pillar itself: onto its nearest face, not the wall behind.
    expect(wallSpot(s, { x: 1050, y: 150 })!.pillar).toBe('p')
    const beside = wallSpot(s, { x: 500, y: 50 })!
    expect(beside.pillar).toBeUndefined()
    expect([round(beside.a), round(beside.b)]).toEqual([{ x: 0, y: 0 }, { x: 1000, y: 0 }])
    // Without pillars, a wall runs corner to corner.
    const plain = wallSpot(solved(room()), { x: 500, y: 50 })!
    expect([round(plain.a), round(plain.b)]).toEqual([{ x: 0, y: 0 }, { x: 4000, y: 0 }])
  })

  it('stand floor to ceiling in the walls drawn in 2D and 3D, painted like their wall', () => {
    const all = solveProject(projectOf(withPillars(0, pillar())))
    const s = all.byId.get('A')!
    const pieces = roomWallPieces(all, s, Infinity)
    const p = pieces.find((x) => x.footprint.some((q) => Math.round(q.x) === 1400 && Math.round(q.y) === 300))!
    expect(p).toMatchObject({ y0: 0, y1: 2700, edge: 0, fullHeight: true })
    expect(p.outer.every((o) => !o)).toBe(true)
    // Wound the same way as the walls.
    expect(Math.sign(signedArea(p.footprint))).toBe(Math.sign(signedArea(pieces[0].footprint)))
    // Cut with the walls in the cutaway.
    const cut = roomWallPieces(all, s, 1200).find((x) => x.footprint.some((q) => Math.round(q.x) === 1400 && Math.round(q.y) === 300))
    expect(cut).toMatchObject({ y0: 0, y1: 1200, fullHeight: true })
  })

  it('stop the distances from a light to the walls', () => {
    // Up from here it's 1.6 m to the wall, 1.3 m to the pillar's face.
    const d = wallDistances(solved(withPillars(0, pillar())), { x: 1200, y: 1600 }).map((x) => Math.round(x.dist))
    expect(d.sort((a, b) => a - b)).toEqual([1200, 1300, 1400, 2800])
  })
})
