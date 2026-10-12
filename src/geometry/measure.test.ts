import { describe, expect, it } from 'vitest'
import { snapMeasure, type MeasureTargets } from './measure'

// A 4 m × 3 m room's inside faces, in mm.
const corners = [
  { x: 0, y: 0 },
  { x: 4000, y: 0 },
  { x: 4000, y: 3000 },
  { x: 0, y: 3000 },
]
const room: MeasureTargets = { corners, lines: corners.map((c, i) => [c, corners[(i + 1) % 4]]) }
const free: MeasureTargets = { corners: [], lines: [] }

describe('snapping a measurement', () => {
  it('lands on a corner nearby, before a line', () => {
    expect(snapMeasure({ x: 3980, y: 25 }, null, room, 50)).toEqual({ p: { x: 4000, y: 0 }, to: 'corner', straight: false })
  })

  it('lands on a wall nearby, at the point nearest the tap', () => {
    expect(snapMeasure({ x: 1500, y: 2970 }, null, room, 50)).toEqual({ p: { x: 1500, y: 3000 }, to: 'line', straight: false })
  })

  it('stays where it was when nothing is near', () => {
    expect(snapMeasure({ x: 1500, y: 1500 }, null, room, 50)).toEqual({ p: { x: 1500, y: 1500 }, to: 'free', straight: false })
  })

  it('measures wall to wall square when the second point is nearly straight across', () => {
    // From the left wall, a tap on the right wall a little lower meets it level with the first point.
    const s = snapMeasure({ x: 3990, y: 1240 }, { x: 0, y: 1200 }, room, 50)
    expect(s.to).toBe('line')
    expect(s.straight).toBe(true)
    expect(s.p.x).toBeCloseTo(4000)
    expect(s.p.y).toBeCloseTo(1200)
  })

  it('makes a nearly straight measurement straight, but not a slanting one', () => {
    expect(snapMeasure({ x: 30, y: 2000 }, { x: 0, y: 0 }, free, 50).p).toEqual({ x: 0, y: 2000 })
    expect(snapMeasure({ x: 600, y: 2000 }, { x: 0, y: 0 }, free, 50)).toEqual({ p: { x: 600, y: 2000 }, to: 'free', straight: false })
  })
})
