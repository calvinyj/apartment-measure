import { area } from '../geometry/polygon'
import { dist } from '../geometry/vec'
import type { ApplianceKind, Cabinet, CabinetCell, CutoutKind } from '../types'
import { carcassLength, outline, type Placement } from './placement'
import { doorSpace, layOut } from './sections'

/** A sheet of board, 8 × 4 ft, mm². */
export const SHEET = 2440 * 1220

/** Board in mm², by what it's for. */
export interface BoardAreas {
  /** the box: ends, top and bottom */
  shell: number
  /** back panels (often a thinner board) */
  back: number
  /** doors, drawer fronts and fixed panels */
  fronts: number
  /** kick board under the fronts */
  plinth: number
  /** the inside: upright dividers and fixed shelves between compartments */
  dividers: number
  /** adjustable shelves */
  shelves: number
  /** the boxes behind drawer fronts */
  drawerBoxes: number
}

export interface CabinetMaterials {
  board: BoardAreas
  /** door leaves (a pair is two) */
  doors: number
  /** of those, sliding ones */
  slidingDoors: number
  drawers: number
  hinges: number
  /** lift-up doors, each needing a stay */
  liftUps: number
  handles: number
  shelves: number
  rails: number
  /** kick board length, mm */
  plinthLength: number
  appliances: Partial<Record<ApplianceKind, number>>
  top: {
    /** mm², seen from above, cut-outs included */
    area: number
    /** along the walls, mm */
    length: number
    /** the exposed front edge, mm */
    frontEdge: number
    /** stone up the wall, mm² */
    upstand: number
    cutouts: Partial<Record<CutoutKind, number>>
  } | null
}

export const emptyBoard = (): BoardAreas => ({ shell: 0, back: 0, fronts: 0, plinth: 0, dividers: 0, shelves: 0, drawerBoxes: 0 })

/** Board without the inside: the box, back, fronts and plinth. */
export const outerBoard = (b: BoardAreas) => b.shell + b.back + b.fronts + b.plinth
/** The inside: dividers, shelves and drawer boxes. */
export const innerBoard = (b: BoardAreas) => b.dividers + b.shelves + b.drawerBoxes
export const allBoard = (b: BoardAreas) => outerBoard(b) + innerBoard(b)

/** Hinges a door leaf this tall needs. */
export const hingesFor = (h: number) => (h <= 900 ? 2 : h <= 1600 ? 3 : h <= 2000 ? 4 : 5)

/** Shelves sit back from the doors; drawer boxes are shorter than the carcass is deep. */
const SHELF_SETBACK = 20
const DRAWER_BACK = 50

/** Leaves of doors this wide (beside any fixed panel): a pair, sliding doors and lift-ups are two (one lift-up if narrow). */
export const doorLeaves = (c: CabinetCell, w: number) => (c.hinge === 'pair' || c.hinge === 'sliding' ? 2 : c.hinge === 'lift' && w > 1200 ? 2 : 1)

/**
 * What a cabinet takes to build, approximately: board by area (no cutting allowance), and hardware.
 * Each leg is built as one box with dividers; at a corner, the leg before it runs into the corner.
 */
export function cabinetMaterials(c: Cabinet, p: Placement): CabinetMaterials {
  const m: CabinetMaterials = {
    board: emptyBoard(),
    doors: 0,
    slidingDoors: 0,
    drawers: 0,
    hinges: 0,
    liftUps: 0,
    handles: 0,
    shelves: 0,
    rails: 0,
    plinthLength: 0,
    appliances: {},
    top: null,
  }
  const { board: b } = m
  const H = c.height
  const D = c.depth
  const handled = c.handle === 'bar' || c.handle === 'knob'
  p.legs.forEach((leg, k) => {
    const front = c.legs[k]
    if (!front) return
    const L = carcassLength(leg)
    b.shell += 2 * H * D + 2 * L * D
    b.back += L * H
    if (c.mount === 'plinth') {
      b.plinth += leg.width * c.bottom
      m.plinthLength += leg.width
    }
    const laid = layOut(front, { x: 0, y: 0, w: leg.width, h: H })
    for (const d of laid.dividers) b.dividers += (d.split === 'across' ? d.rect.h : d.rect.w) * D
    for (const { cell, rect } of laid.cells) {
      const { w, h } = rect
      if (cell.front === 'door' || cell.front === 'panel' || cell.front === 'drawers') b.fronts += w * h
      if (cell.front === 'door' || cell.front === 'open') {
        b.shelves += cell.shelves * w * (D - SHELF_SETBACK)
        m.shelves += cell.shelves
        if (cell.rail) m.rails++
      }
      if (cell.front === 'door') {
        const leaves = doorLeaves(cell, doorSpace(cell, rect).doors.w)
        m.doors += leaves
        if (cell.hinge === 'sliding') m.slidingDoors += leaves
        else if (cell.hinge === 'lift') m.liftUps += leaves
        else m.hinges += leaves * hingesFor(h)
        if (handled) m.handles += leaves
      }
      if (cell.front === 'drawers') {
        const n = cell.drawers
        const fh = h / n
        // Each drawer's box: two sides, a front and back inside the drawer front, and a bottom.
        const bh = Math.max(60, Math.min(250, fh - 60))
        const bd = D - DRAWER_BACK
        const bw = Math.max(0, w - 2 * c.board - 26)
        b.drawerBoxes += n * (2 * bd * bh + 2 * bw * bh + bw * bd)
        m.drawers += n
        if (handled) m.handles += n
      }
      if (cell.front === 'appliance') m.appliances[cell.appliance] = (m.appliances[cell.appliance] ?? 0) + 1
    }
  })
  if (c.top) {
    const t = c.top
    const pts = outline(p, D + t.overhang)
    const length = p.legs.reduce((s, l) => s + l.to - l.from, 0)
    const n = p.legs.length
    // The front edge is the outline's second half: from the last leg's right end back to the first's left.
    const front = pts.slice(n + 1)
    let frontEdge = 0
    for (let i = 0; i + 1 < front.length; i++) frontEdge += dist(front[i], front[i + 1])
    const cutouts: Partial<Record<CutoutKind, number>> = {}
    for (const x of t.cutouts) cutouts[x.kind] = (cutouts[x.kind] ?? 0) + 1
    m.top = { area: area(pts), length, frontEdge, upstand: length * t.upstand, cutouts }
  }
  return m
}

/** Materials of several cabinets added up. */
export function addMaterials(list: CabinetMaterials[]): CabinetMaterials {
  const total: CabinetMaterials = {
    board: emptyBoard(),
    doors: 0,
    slidingDoors: 0,
    drawers: 0,
    hinges: 0,
    liftUps: 0,
    handles: 0,
    shelves: 0,
    rails: 0,
    plinthLength: 0,
    appliances: {},
    top: null,
  }
  for (const m of list) {
    for (const k of Object.keys(m.board) as (keyof BoardAreas)[]) total.board[k] += m.board[k]
    total.doors += m.doors
    total.slidingDoors += m.slidingDoors
    total.drawers += m.drawers
    total.hinges += m.hinges
    total.liftUps += m.liftUps
    total.handles += m.handles
    total.shelves += m.shelves
    total.rails += m.rails
    total.plinthLength += m.plinthLength
    for (const [k, v] of Object.entries(m.appliances) as [ApplianceKind, number][]) total.appliances[k] = (total.appliances[k] ?? 0) + v
    if (m.top) {
      const t = (total.top ??= { area: 0, length: 0, frontEdge: 0, upstand: 0, cutouts: {} })
      t.area += m.top.area
      t.length += m.top.length
      t.frontEdge += m.top.frontEdge
      t.upstand += m.top.upstand
      for (const [k, v] of Object.entries(m.top.cutouts) as [CutoutKind, number][]) t.cutouts[k] = (t.cutouts[k] ?? 0) + v
    }
  }
  return total
}

/** Sheets of 8 × 4 ft board for this much, by area alone. */
export const sheetsFor = (mm2: number) => (mm2 > 0 ? Math.ceil(mm2 / SHEET - 1e-9) : 0)
