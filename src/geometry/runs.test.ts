import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS, type Edge, type Project, type Room } from '../types'
import { groupMeasured, measureGroups, splitMeasured } from './runs'
import { solveProject } from './solve'

function room(pts: [number, number][], open: number[] = []): Room {
  const edges: Edge[] = pts.map((_, i) => ({
    id: String(i),
    kind: open.includes(i) ? 'open' : 'wall',
    measured: null,
    thickness: null,
    side: 'auto',
    openings: [],
  }))
  return { id: 'r', name: 'r', type: 'bedroom', points: pts.map(([x, y]) => ({ x, y })), edges, height: null, acZone: '', ac: null, sunny: false }
}

describe('measureGroups', () => {
  it('keeps a plain rectangle as four walls', () => {
    expect(measureGroups(room([[0, 0], [10, 0], [10, 5], [0, 5]]))).toEqual([[0], [1], [2], [3]])
  })

  it('joins a straight wall split at the first corner (wrapping past the last edge)', () => {
    // Like the Home Office: the top wall is split at (856, 456) where the balcony ends.
    const r = room([[856, 456], [1138, 456], [1138, 916], [788, 916], [788, 456]])
    expect(measureGroups(r)).toEqual([[4, 0], [1], [2], [3]])
  })

  it('does not join a wall with an open stretch on the same line', () => {
    // The wall has a real end where the opening starts, so it is measured on its own.
    const r = room([[0, 0], [390, 0], [515, 0], [515, 150], [0, 150]], [0])
    expect(measureGroups(r)).toEqual([[0], [1], [2], [3], [4]])
  })
})

describe('splitting one measurement', () => {
  it('shares the total in plan proportions and reads it back', () => {
    const r = room([[856, 456], [1138, 456], [1138, 916], [788, 916], [788, 456]])
    const est = [2193, 3600, 2662, 3600, 470]
    const parts = splitMeasured(2650, [4, 0], est)
    expect(parts[0]! + parts[1]!).toBeCloseTo(2650)
    expect(parts[0]! / parts[1]!).toBeCloseTo(470 / 2193)
    r.edges[4].measured = parts[0]
    r.edges[0].measured = parts[1]
    expect(groupMeasured(r, [4, 0])).toBeCloseTo(2650)
    expect(groupMeasured(r, [1])).toBeNull()
  })
})

describe('a straight wall facing different neighbours along its length', () => {
  // Room A's top wall is shared with B for its first 1 m, then faces outside: still one straight face.
  const a = room([[0, 0], [100, 0], [400, 0], [400, 300], [0, 300]])
  a.id = 'a'
  const b = room([[0, -150], [100, -150], [100, 0], [0, 0]])
  b.id = 'b'
  const project: Project = {
    version: 2,
    name: 't',
    image: null,
    calibration: { a: { x: 0, y: 0 }, b: { x: 100, y: 0 }, mm: 1000 },
    rooms: [a, b],
    settings: { ...DEFAULT_SETTINGS, internalThickness: 150, externalThickness: 200, traceMode: 'centre' },
    advertised: null,
  }
  it('has one inside face, without a step where the neighbour changes', () => {
    const s = solveProject(project).byId.get('a')!
    expect(s.edgeInfo[0].side).toBe('internal')
    expect(s.edgeInfo[1].side).toBe('external')
    expect(s.planEnds[0].y).toBeCloseTo(s.planStarts[1].y)
  })
})
