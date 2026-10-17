import { describe, expect, it } from 'vitest'
import { crosses, layoutCallouts, stack, type Callout } from './callouts'

const box = { minX: 0, minY: 0, maxX: 100, maxY: 100 }
const opts = { w: 40, gap: 4, margin: 10 }

const overlapping = (cs: Callout[]) =>
  cs.some((a, i) => cs.some((b, j) => j > i && a.side === b.side && a.y < b.y + b.h + opts.gap - 1e-9 && b.y < a.y + a.h + opts.gap - 1e-9))

const crossed = (cs: Callout[]) => cs.some((a, i) => cs.some((b, j) => j > i && crosses(a.at, a.port, b.at, b.port)))

describe('stack', () => {
  it('leaves cards where they want to be when they fit', () => {
    expect(stack([10, 50, 90], [20, 20, 20], 4)).toEqual([10, 50, 90])
  })

  it('spreads cards that want the same place evenly about it', () => {
    const ys = stack([50, 50, 50], [20, 20, 20], 4)
    expect(ys).toEqual([26, 50, 74])
  })

  it('keeps cards of different heights apart', () => {
    const ys = stack([0, 0], [10, 30], 2)
    expect(ys[1] - ys[0]).toBeCloseTo(5 + 15 + 2)
  })
})

describe('layoutCallouts', () => {
  it('puts each card on the nearer side, level with what it points to', () => {
    const cs = layoutCallouts(
      [
        { id: 'a', at: { x: 20, y: 30 }, h: 10 },
        { id: 'b', at: { x: 80, y: 60 }, h: 10 },
      ],
      box,
      opts,
    )
    const a = cs.find((c) => c.id === 'a')!
    const b = cs.find((c) => c.id === 'b')!
    expect(a.side).toBe('left')
    expect(a.x + opts.w).toBe(-10)
    expect(a.port).toEqual({ x: -10, y: 30 })
    expect(b.side).toBe('right')
    expect(b.x).toBe(110)
    expect(b.port).toEqual({ x: 110, y: 60 })
  })

  it('stacks cards for things side by side without overlapping', () => {
    const items = [10, 20, 30, 40].map((x, i) => ({ id: String(i), at: { x, y: 50 }, h: 12 }))
    const cs = layoutCallouts(items, box, opts)
    expect(cs.every((c) => c.side === 'left')).toBe(true)
    expect(overlapping(cs)).toBe(false)
    expect(crossed(cs)).toBe(false)
  })

  it('swaps cards whose lines would cross', () => {
    // In order from the top, the 161 one's line crosses the line to the one at 0, 16.
    const items = [
      { id: 'a', at: { x: 28, y: 1 }, h: 11 },
      { id: 'b', at: { x: 161, y: 6 }, h: 27 },
      { id: 'c', at: { x: 0, y: 16 }, h: 18 },
      { id: 'd', at: { x: 75, y: 24 }, h: 30 },
    ]
    const wide = { minX: 0, minY: 0, maxX: 400, maxY: 200 }
    const cs = layoutCallouts(items, wide, opts)
    expect(cs.every((c) => c.side === 'left')).toBe(true)
    expect(crossed(cs)).toBe(false)
    expect(overlapping(cs)).toBe(false)
  })

  it('uncrosses a crowd', () => {
    // A fixed scatter of points on the left half.
    let seed = 7
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 0.999
    const items = Array.from({ length: 9 }, (_, i) => ({ id: String(i), at: { x: rnd() * 49, y: rnd() * 100 }, h: 10 }))
    const cs = layoutCallouts(items, box, opts)
    expect(overlapping(cs)).toBe(false)
    expect(crossed(cs)).toBe(false)
  })

  it('moves cards from the middle to the other side when one column runs taller than the box', () => {
    const items = Array.from({ length: 10 }, (_, i) => ({ id: String(i), at: { x: 5 + i * 4, y: 50 }, h: 15 }))
    const cs = layoutCallouts(items, box, opts)
    const right = cs.filter((c) => c.side === 'right')
    expect(right.length).toBeGreaterThan(0)
    // The ones that moved are those nearest the middle.
    expect(Math.min(...right.map((c) => c.at.x))).toBeGreaterThan(Math.max(...cs.filter((c) => c.side === 'left').map((c) => c.at.x)))
    expect(overlapping(cs)).toBe(false)
  })
})
