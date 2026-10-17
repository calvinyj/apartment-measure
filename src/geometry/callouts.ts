import type { Vec2 } from '../types'

/** A card to put beside a box, with a line to `at` (inside the box). All in one upright frame, e.g. as on screen. */
export interface CalloutInput {
  id: string
  at: Vec2
  /** the card's height */
  h: number
}

export interface Callout {
  id: string
  at: Vec2
  side: 'left' | 'right'
  /** the card's top left corner, and its height */
  x: number
  y: number
  h: number
  /** where the line from `at` meets the card: the middle of its side facing the box */
  port: Vec2
}

export interface CalloutOptions {
  /** each card's width */
  w: number
  /** between cards one above another */
  gap: number
  /** between the box and the cards */
  margin: number
}

interface Box {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

/**
 * The centres of cards in a column, in this order, nearest their preferred centres (least squares)
 * without overlapping: each at least `gap` below the one before. This is isotonic regression on the
 * centres less the room the cards before them take (pool adjacent violators).
 */
export function stack(pref: number[], h: number[], gap: number): number[] {
  const offset: number[] = []
  pref.forEach((_, i) => offset.push(i ? offset[i - 1] + (h[i - 1] + h[i]) / 2 + gap : 0))
  const blocks: { sum: number; n: number }[] = []
  pref.forEach((p, i) => {
    blocks.push({ sum: p - offset[i], n: 1 })
    while (blocks.length > 1) {
      const b = blocks[blocks.length - 1]
      const a = blocks[blocks.length - 2]
      if (a.sum / a.n <= b.sum / b.n) break
      a.sum += b.sum
      a.n += b.n
      blocks.pop()
    }
  })
  return blocks.flatMap((b) => Array<number>(b.n).fill(b.sum / b.n)).map((z, i) => z + offset[i])
}

const orient = (a: Vec2, b: Vec2, c: Vec2) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)

/** Whether segments ab and cd cross (touching at an end doesn't count). */
export function crosses(a: Vec2, b: Vec2, c: Vec2, d: Vec2): boolean {
  return orient(a, b, c) * orient(a, b, d) < 0 && orient(c, d, a) * orient(c, d, b) < 0
}

/** One column of cards beside the box, its lines uncrossed where swapping cards can do it. */
function column(items: CalloutInput[], side: 'left' | 'right', box: Box, o: CalloutOptions): Callout[] {
  if (!items.length) return []
  const x = side === 'left' ? box.minX - o.margin - o.w : box.maxX + o.margin
  const portX = side === 'left' ? box.minX - o.margin : box.maxX + o.margin
  // Top to bottom by where they point; level ones nearest the column first, as their lines are shorter.
  const towards = side === 'left' ? 1 : -1
  let order = [...items].sort((a, b) => a.at.y - b.at.y || towards * (a.at.x - b.at.x))
  const place = (ord: CalloutInput[]) => {
    const ys = stack(
      ord.map((c) => c.at.y),
      ord.map((c) => c.h),
      o.gap,
    )
    return ord.map((c, i): Callout => ({ id: c.id, at: c.at, side, x, y: ys[i] - c.h / 2, h: c.h, port: { x: portX, y: ys[i] } }))
  }
  const crossing = (cs: Callout[]) => {
    const pairs: [number, number][] = []
    for (let i = 0; i < cs.length; i++)
      for (let j = i + 1; j < cs.length; j++)
        if (crosses(cs[i].at, cs[i].port, cs[j].at, cs[j].port)) pairs.push([i, j])
    return pairs
  }
  // Swapping two crossed cards uncrosses them (with cards the same height, it always shortens the
  // lines, so it ends); with heights that differ it might not, so keep the best seen.
  let placed = place(order)
  let pairs = crossing(placed)
  let best = { placed, n: pairs.length }
  for (let tries = 0; pairs.length && tries < items.length * items.length; tries++) {
    const [i, j] = pairs[0]
    order = order.map((c, k) => (k === i ? order[j] : k === j ? order[i] : c))
    placed = place(order)
    pairs = crossing(placed)
    if (pairs.length < best.n) best = { placed, n: pairs.length }
  }
  return best.placed
}

/**
 * Cards in a column either side of the box, each beside what it points to where there's room, with a
 * straight line to it. Each goes on the side nearer what it points to, unless that column runs taller
 * than the box and moving cards from the middle across evens them up.
 */
export function layoutCallouts(items: CalloutInput[], box: Box, o: CalloutOptions): Callout[] {
  const mid = (box.minX + box.maxX) / 2
  const left = items.filter((c) => c.at.x < mid)
  const right = items.filter((c) => c.at.x >= mid)
  const height = (cs: CalloutInput[]) => cs.reduce((sum, c) => sum + c.h + o.gap, -o.gap)
  const span = box.maxY - box.minY
  for (;;) {
    const [from, to] = height(left) >= height(right) ? [left, right] : [right, left]
    if (height(from) <= span || !from.length) break
    // The one nearest the middle moves across, if that leaves the taller column shorter.
    const k = from.reduce((best, c, i) => (Math.abs(c.at.x - mid) < Math.abs(from[best].at.x - mid) ? i : best), 0)
    const moved = from[k]
    if (Math.max(height(from) - moved.h - o.gap, height([...to, moved])) >= height(from)) break
    from.splice(k, 1)
    to.push(moved)
  }
  return [...column(left, 'left', box, o), ...column(right, 'right', box, o)]
}
