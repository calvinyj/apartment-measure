import { describe, expect, it } from 'vitest'
import { normalizeProject } from '../store'
import { DEFAULT_SETTINGS, type Edge, type Project, type Room, type RoomType } from '../types'
import { bearing, facesAfternoonSun, formatFacing, isSunny, roomFacing } from './facing'
import { solveProject } from './solve'

function room(id: string, type: RoomType, pts: [number, number][], sunny: boolean | null = null): Room {
  const edges: Edge[] = pts.map((_, i) => ({ id: String(i), kind: 'wall', measured: null, thickness: null, side: 'auto', openings: [] }))
  return { id, name: id, type, points: pts.map(([x, y]) => ({ x, y })), edges, height: null, acZone: '', ac: null, sunny }
}

function project(rooms: Room[], north: number | null): Project {
  return {
    version: 3,
    north,
    lights: [],
    plugs: [],
    cabinets: [],
    furniture: [],
    name: 't',
    image: null,
    // 1 px = 10 mm
    calibration: { a: { x: 0, y: 0 }, b: { x: 100, y: 0 }, mm: 1000 },
    rooms,
    settings: { ...DEFAULT_SETTINGS, traceMode: 'centre' },
    advertised: null,
  }
}

describe('bearing', () => {
  it('reads plan directions as compass bearings', () => {
    expect(bearing({ x: 0, y: -1 }, 0)).toBeCloseTo(0)
    expect(bearing({ x: 1, y: 0 }, 0)).toBeCloseTo(90)
    expect(bearing({ x: -1, y: 0 }, 0)).toBeCloseTo(270)
    // North pointing to the right of the plan: the plan's top faces west.
    expect(bearing({ x: 0, y: -1 }, 90)).toBeCloseTo(270)
    expect(bearing({ x: 1, y: -1 }, 45)).toBeCloseTo(0)
  })
})

describe('which way a room faces', () => {
  // Bedroom in the middle, balcony on its left, living room on its right.
  const bed = room('bed', 'bedroom', [[0, 0], [400, 0], [400, 300], [0, 300]])
  const balcony = room('balcony', 'balcony', [[-150, 0], [0, 0], [0, 300], [-150, 300]])
  const living = room('living', 'living', [[400, 0], [800, 0], [800, 300], [400, 300]])

  it('is unknown until north is set', () => {
    const s = solveProject(project([bed], null))
    expect(roomFacing(s, s.rooms[0])).toEqual([])
    expect(isSunny(s, s.rooms[0])).toBe(false)
  })

  it('counts outside walls and walls onto a balcony, not walls to other rooms', () => {
    const s = solveProject(project([bed, balcony, living], 0))
    const f = roomFacing(s, s.byId.get('bed')!)
    expect(formatFacing(f).split(', ').sort()).toEqual(['N', 'S', 'W'])
    expect(facesAfternoonSun(f)).toBe(true)
    expect(isSunny(s, s.byId.get('living')!)).toBe(false)
  })

  it('turns with the compass', () => {
    // North at the bottom of the plan: the balcony side now faces east.
    const s = solveProject(project([bed, balcony, living], 180))
    expect(formatFacing(roomFacing(s, s.byId.get('bed')!)).split(', ').sort()).toEqual(['E', 'N', 'S'])
    expect(isSunny(s, s.byId.get('bed')!)).toBe(false)
    expect(isSunny(s, s.byId.get('living')!)).toBe(true)
  })

  it('skips an outside wall marked as against the next unit or a corridor', () => {
    // North to the right of the plan: the living room's top wall faces west.
    const open = solveProject(project([bed, balcony, living], 90))
    expect(isSunny(open, open.byId.get('living')!)).toBe(true)
    const shut = { ...living, edges: living.edges.map((e, i) => (i === 0 ? { ...e, openAir: false } : e)) }
    const s = solveProject(project([bed, balcony, shut], 90))
    expect(formatFacing(roomFacing(s, s.byId.get('living')!)).split(', ').sort()).toEqual(['E', 'N'])
    expect(isSunny(s, s.byId.get('living')!)).toBe(false)
  })

  it('lets the room override the compass', () => {
    const s = solveProject(project([{ ...bed, sunny: false }, balcony, { ...living, sunny: true }], 0))
    expect(isSunny(s, s.byId.get('bed')!)).toBe(false)
    expect(isSunny(s, s.byId.get('living')!)).toBe(true)
  })
})

describe('loading older layouts', () => {
  const tri: [number, number][] = [[0, 0], [1, 0], [1, 1]]
  const raw = { ...project([room('a', 'bedroom', tri, false), room('b', 'bedroom', tri, true)], null), version: 2, north: undefined }

  it('turns an unticked sun box into "work it out from the compass", and keeps a ticked one', () => {
    const p = normalizeProject(raw)
    expect(p.version).toBe(3)
    expect(p.north).toBeNull()
    expect(p.rooms.map((r) => r.sunny)).toEqual([null, true])
  })

  it('keeps an explicit "no" from v3 on', () => {
    expect(normalizeProject({ ...raw, version: 3 }).rooms.map((r) => r.sunny)).toEqual([false, true])
  })
})
