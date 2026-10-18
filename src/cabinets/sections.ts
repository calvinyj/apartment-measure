import type { CabinetCell, CabinetFront, CabinetSection, CabinetSplit } from '../types'

/** A part can't be dragged or set smaller than this, mm. */
export const MIN_PART = 100

export const isSplit = (s: CabinetSection): s is CabinetSplit => 'split' in s

/** A compartment with sensible settings for its front. */
export const cell = (front: CabinetFront, patch: Partial<CabinetCell> = {}): CabinetCell => ({
  front,
  hinge: 'pair',
  drawers: 3,
  shelves: front === 'door' || front === 'open' ? 1 : 0,
  rail: false,
  appliance: 'oven',
  ...patch,
})

type Part = [size: number | null, section: CabinetSection]

export const across = (...parts: Part[]): CabinetSplit => ({
  split: 'across',
  parts: parts.map(([size, section]) => ({ size, section })),
})

export const stack = (...parts: Part[]): CabinetSplit => ({
  split: 'stack',
  parts: parts.map(([size, section]) => ({ size, section })),
})

/**
 * Each part's size within `total` mm: a fixed one as set, and the rest share what's left equally.
 * With none left to share, the last one takes up the difference. `over` is how far the fixed parts
 * overrun the space.
 */
export function partSizes(sizes: (number | null)[], total: number): { sizes: number[]; flex: boolean[]; over: number } {
  const flex = sizes.some((s) => s == null) ? sizes.map((s) => s == null) : sizes.map((_, i) => i === sizes.length - 1)
  const fixed = sizes.reduce<number>((sum, s, i) => sum + (flex[i] ? 0 : (s ?? 0)), 0)
  const share = (total - fixed) / flex.filter(Boolean).length
  return {
    sizes: sizes.map((s, i) => (flex[i] ? Math.max(0, share) : (s ?? 0))),
    flex,
    over: Math.max(0, -share * flex.filter(Boolean).length),
  }
}

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

/** Whether a compartment has a fixed panel beside its doors: hinged doors can, lift-up and sliding ones can't. */
export const hasFixed = (c: CabinetCell) => c.front === 'door' && !!c.fixed && c.hinge !== 'lift' && c.hinge !== 'sliding'

/** A door compartment's fixed panel, if it has one, and the space left for its doors (at least MIN_PART wide). */
export function doorSpace(c: CabinetCell, r: Rect): { fixed: Rect | null; doors: Rect } {
  const w = hasFixed(c) ? Math.min(c.fixedWidth ?? r.w / 2, r.w - MIN_PART) : 0
  if (w <= 0) return { fixed: null, doors: r }
  return c.fixed === 'left'
    ? { fixed: { ...r, w }, doors: { ...r, x: r.x + w, w: r.w - w } }
    : { fixed: { ...r, x: r.x + r.w - w, w }, doors: { ...r, w: r.w - w } }
}

/** A drawer inside a door compartment is this high, unless their height is set. */
export const DRAWER_INSIDE_H = 200

/**
 * A door compartment's drawers inside, at the bottom behind the doors, and the space left above them for
 * shelves and hanging (at least MIN_PART high).
 */
export function insideSpace(c: CabinetCell, r: Rect): { n: number; drawers: Rect | null; above: Rect } {
  const n = c.front === 'door' ? (c.insideDrawers ?? 0) : 0
  if (n <= 0) return { n: 0, drawers: null, above: r }
  const h = Math.max(0, Math.min(c.insideDrawersHeight ?? n * DRAWER_INSIDE_H, r.h - MIN_PART))
  return { n, drawers: { ...r, y: r.y + r.h - h, h }, above: { ...r, h: r.h - h } }
}

/** Shelves from the top or the bottom are this far apart, unless set. */
export const SHELF_GAP = 300
/** A hanging rail is this far under the shelf over it (or the top). */
const RAIL_DROP = 70

/**
 * How far apart a compartment's shelves are in `h` mm, when they go from the top or the bottom: as set, or
 * closer if that would leave under MIN_PART past the last one (`fits` is false then). Null when they're
 * spread evenly.
 */
export function shelfSpacing(c: CabinetCell, h: number): { gap: number; fits: boolean } | null {
  if (!c.shelfAlign || c.shelves <= 0) return null
  const want = Math.max(0, c.shelfGap ?? SHELF_GAP)
  const gap = Math.min(want, Math.max(0, (h - MIN_PART) / c.shelves))
  return { gap, fits: gap > want - 0.5 }
}

/**
 * Where a compartment's shelves and hanging rail are in `r`, y down, top to bottom. Spread evenly with a rail,
 * the shelves keep to the top over the hanging space. The rail hangs under the lowest shelf, or near the top
 * when the shelves go from the bottom.
 */
export function shelvesIn(c: CabinetCell, r: Rect): { shelves: number[]; rail: number | null } {
  const n = c.shelves
  const s = shelfSpacing(c, r.h)
  const shelves = Array.from({ length: n }, (_, i) =>
    s
      ? c.shelfAlign === 'top'
        ? r.y + s.gap * (i + 1)
        : r.y + r.h - s.gap * (n - i)
      : c.rail
        ? r.y + Math.min(SHELF_GAP * (i + 1), (r.h * (i + 1)) / (n + 2))
        : r.y + (r.h * (i + 1)) / (n + 1),
  )
  const over = c.shelfAlign === 'bottom' || !n ? r.y : shelves[n - 1]
  return { shelves, rail: c.rail ? over + RAIL_DROP : null }
}

/** A compartment laid out on the front: x from the left, y down from the top of the carcass. */
export interface LaidCell {
  path: number[]
  rect: Rect
  cell: CabinetCell
}

/** The divider between parts `index` and `index + 1` of the split at `path`. */
export interface LaidDivider {
  path: number[]
  index: number
  split: 'across' | 'stack'
  /** where it is: x for 'across', y for 'stack' */
  at: number
  /** the split's whole space */
  rect: Rect
}

export interface LaidSplit {
  path: number[]
  split: 'across' | 'stack'
  rect: Rect
  sizes: number[]
  flex: boolean[]
}

export interface Laid {
  cells: LaidCell[]
  dividers: LaidDivider[]
  splits: LaidSplit[]
  /** mm the fixed parts overrun their space, summed */
  over: number
}

/** Where every compartment and divider of a front falls in `rect`. */
export function layOut(section: CabinetSection, rect: Rect): Laid {
  const out: Laid = { cells: [], dividers: [], splits: [], over: 0 }
  const walk = (s: CabinetSection, r: Rect, path: number[]) => {
    if (!isSplit(s)) return void out.cells.push({ path, rect: r, cell: s })
    const wide = s.split === 'across'
    const { sizes, flex, over } = partSizes(
      s.parts.map((p) => p.size),
      wide ? r.w : r.h,
    )
    out.over += over
    out.splits.push({ path, split: s.split, rect: r, sizes, flex })
    let at = wide ? r.x : r.y
    s.parts.forEach((p, i) => {
      const sub = wide ? { x: at, y: r.y, w: sizes[i], h: r.h } : { x: r.x, y: at, w: r.w, h: sizes[i] }
      walk(p.section, sub, [...path, i])
      at += sizes[i]
      if (i < s.parts.length - 1) out.dividers.push({ path, index: i, split: s.split, at, rect: r })
    })
  }
  walk(section, rect, [])
  return out
}

export function sectionAt(root: CabinetSection, path: number[]): CabinetSection | null {
  let s: CabinetSection = root
  for (const i of path) {
    if (!isSplit(s) || !s.parts[i]) return null
    s = s.parts[i].section
  }
  return s
}

/** The section at `path` replaced by f of it. */
export function replaceAt(root: CabinetSection, path: number[], f: (s: CabinetSection) => CabinetSection): CabinetSection {
  if (!path.length) return f(root)
  if (!isSplit(root)) return root
  const [i, ...rest] = path
  return { ...root, parts: root.parts.map((p, j) => (j === i ? { ...p, section: replaceAt(p.section, rest, f) } : p)) }
}

export const updateCell = (root: CabinetSection, path: number[], patch: Partial<CabinetCell>) =>
  replaceAt(root, path, (s) => (isSplit(s) ? s : { ...s, ...patch }))

/**
 * Split the compartment at `path` into n. Within a split the same way, it becomes n parts of that split
 * (sharing its size, if it had one) rather than a split inside a split.
 */
export function splitAt(root: CabinetSection, path: number[], dir: 'across' | 'stack', n: number): CabinetSection {
  const target = sectionAt(root, path)
  if (!target || isSplit(target) || n < 2) return root
  const parentPath = path.slice(0, -1)
  const parent = path.length ? sectionAt(root, parentPath) : null
  if (parent && isSplit(parent) && parent.split === dir) {
    const i = path[path.length - 1]
    const size = parent.parts[i].size
    const copies = Array.from({ length: n }, () => ({ size: size == null ? null : size / n, section: { ...target } }))
    return replaceAt(root, parentPath, () => ({ ...parent, parts: [...parent.parts.slice(0, i), ...copies, ...parent.parts.slice(i + 1)] }))
  }
  return replaceAt(root, path, () => ({ split: dir, parts: Array.from({ length: n }, () => ({ size: null, section: { ...target } })) }))
}

/**
 * Take the compartment at `path` out of its split. A fixed size it had goes to the part beside it if that's
 * fixed too (otherwise the parts sharing what's left take it up). A split left with one part becomes that part.
 */
export function removeAt(root: CabinetSection, path: number[]): CabinetSection {
  if (!path.length) return root
  const parentPath = path.slice(0, -1)
  const parent = sectionAt(root, parentPath)
  if (!parent || !isSplit(parent)) return root
  const i = path[path.length - 1]
  const gone = parent.parts[i]
  const parts = parent.parts.filter((_, j) => j !== i)
  const k = Math.min(i, parts.length - 1)
  if (gone.size != null && parts[k].size != null) parts[k] = { ...parts[k], size: parts[k].size! + gone.size }
  return replaceAt(root, parentPath, () => (parts.length === 1 ? parts[0].section : { ...parent, parts }))
}

/** Set (or with null, free) the size of the part at `path`. */
export function setPartSize(root: CabinetSection, path: number[], size: number | null): CabinetSection {
  if (!path.length) return root
  const parentPath = path.slice(0, -1)
  const i = path[path.length - 1]
  return replaceAt(root, parentPath, (s) =>
    isSplit(s) ? { ...s, parts: s.parts.map((p, j) => (j === i ? { ...p, size: size == null ? null : Math.round(size) } : p)) } : s,
  )
}

/**
 * Move a divider by delta mm: the parts either side of it become fixed at their new sizes (sizes are the
 * split's parts as laid out), each kept at least MIN_PART.
 */
export function moveDivider(root: CabinetSection, d: { path: number[]; index: number }, sizes: number[], delta: number): CabinetSection {
  const a = sizes[d.index]
  const b = sizes[d.index + 1]
  const t = Math.max(MIN_PART - a, Math.min(b - MIN_PART, delta))
  return replaceAt(root, d.path, (s) =>
    isSplit(s)
      ? {
          ...s,
          parts: s.parts.map((p, j) =>
            j === d.index ? { ...p, size: Math.round(a + t) } : j === d.index + 1 ? { ...p, size: Math.round(b - t) } : p,
          ),
        }
      : s,
  )
}

/** A part swapped with its neighbour: the split it's in, and where it was and is now. */
export interface Moved {
  root: CabinetSection
  /** the compartment's path after the move */
  path: number[]
  split: number[]
  from: number
  to: number
}

/**
 * Swap the part holding the compartment at `path` with its neighbour before (-1) or after (+1), in the
 * nearest split running `dir`: so within a column, left and right move the whole column. Its size goes
 * with it. Null when there's no neighbour that way.
 */
export function movePart(root: CabinetSection, path: number[], dir: 'across' | 'stack', by: -1 | 1): Moved | null {
  for (let j = path.length - 1; j >= 0; j--) {
    const split = path.slice(0, j)
    const parent = sectionAt(root, split)
    if (!parent || !isSplit(parent) || parent.split !== dir) continue
    const from = path[j]
    const to = from + by
    if (to < 0 || to >= parent.parts.length) return null
    const parts = [...parent.parts]
    ;[parts[from], parts[to]] = [parts[to], parts[from]]
    const moved = [...path]
    moved[j] = to
    return { root: replaceAt(root, split, () => ({ ...parent, parts })), path: moved, split, from, to }
  }
  return null
}

/**
 * Put the drawers compartment at `path` behind the doors of the one above it in its stack: the doors run down
 * over it, with its drawers inside at the bottom, and every other part keeps its size (`sizes` are the stack's
 * parts as laid out). Null unless it's drawers right under doors that have none inside yet.
 */
export function putBehindDoors(root: CabinetSection, path: number[], sizes: number[]): { root: CabinetSection; path: number[] } | null {
  if (!path.length) return null
  const parentPath = path.slice(0, -1)
  const parent = sectionAt(root, parentPath)
  const i = path[path.length - 1]
  if (!parent || !isSplit(parent) || parent.split !== 'stack' || i === 0) return null
  const drawers = parent.parts[i].section
  const doors = parent.parts[i - 1].section
  if (isSplit(drawers) || drawers.front !== 'drawers' || isSplit(doors) || doors.front !== 'door' || doors.insideDrawers) return null
  const cell: CabinetCell = { ...doors, insideDrawers: drawers.drawers, insideDrawersHeight: Math.round(sizes[i]) }
  // The doors take on the drawers' height. They go on sharing what's left only if nothing else does, else
  // the parts that do would grow.
  const othersShare = parent.parts.some((p, j) => j !== i && j !== i - 1 && p.size == null)
  const size = parent.parts[i - 1].size == null && !othersShare ? null : Math.round(sizes[i - 1] + sizes[i])
  const parts = parent.parts.flatMap((p, j) => (j === i ? [] : j === i - 1 ? [{ size, section: cell }] : [p]))
  if (parts.length === 1) return { root: replaceAt(root, parentPath, () => cell), path: parentPath }
  return { root: replaceAt(root, parentPath, () => ({ ...parent, parts })), path: [...parentPath, i - 1] }
}

/** Every compartment of a front, in order. */
export function cellsOf(s: CabinetSection): CabinetCell[] {
  return isSplit(s) ? s.parts.flatMap((p) => cellsOf(p.section)) : [s]
}

export const samePath = (a: number[] | null, b: number[] | null) =>
  !!a && !!b && a.length === b.length && a.every((x, i) => x === b[i])
