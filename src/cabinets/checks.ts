import { overlapsPillar } from '../geometry/pillars'
import type { Solved } from '../geometry/solve'
import { cutsFor } from '../geometry/walls'
import type { Cabinet, Cutout, LengthUnit } from '../types'
import { formatLength } from '../units'
import { outline, wallNumber, type Placement } from './placement'
import { doorSpace, insideSpace, layOut, MIN_PART, shelfSpacing, type LaidCell } from './sections'

/** An opening with its bottom below this is a doorway (or a gap down to the floor); higher up, a window. */
export const DOOR_SILL = 300
/** Stone left in front of (or behind) a cut-out, at least. */
export const MIN_STONE_EDGE = 50
const WIDE_DOOR = 600
/** Sliding doors hang from a track, so they can be wider. */
const WIDE_SLIDING = 1200
const WIDE_DRAWER = 1000
const LOW_DRAWER = 100

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

/** Height of the cabinet's top above the floor: the carcass, plus its stone. */
export const cabinetTop = (c: Cabinet) => c.bottom + c.height + (c.top?.thickness ?? 0)

/** The compartment under a cut-out's centre (the top one there). */
export function cellUnder(c: Cabinet, p: Placement, x: Cutout): LaidCell | null {
  const leg = p.legs[x.leg]
  const front = c.legs[x.leg]
  if (!leg || !front) return null
  const cells = layOut(front, { x: 0, y: 0, w: leg.width, h: c.height }).cells.filter((l) => l.rect.x <= x.x && x.x <= l.rect.x + l.rect.w)
  return cells.sort((a, b) => a.rect.y - b.rect.y)[0] ?? null
}

const CUTOUT_LABEL = { sink: 'sink', hob: 'hob', basin: 'basin' } as const

/** Things worth a second look: running past a wall's end, over a doorway or window, into a pillar, too tall, wide doors, cut-outs. */
export function cabinetWarnings(solved: Solved, c: Cabinet, p: Placement, unit: LengthUnit): string[] {
  const out: string[] = []
  const r = p.room
  // A plinth fills the space under it; legs or hanging leave it clear.
  const y0 = c.mount === 'plinth' ? 0 : c.bottom
  const y1 = cabinetTop(c)

  p.legs.forEach((leg) => {
    const wall = `wall ${leg.wallNo}`
    if (leg.from > leg.wallLength + 0.5) out.push(`It starts past the end of ${wall} (${formatLength(leg.wallLength, unit)} long).`)
    else if (leg.to > leg.wallLength + 0.5)
      out.push(`It runs ${formatLength(leg.to - leg.wallLength, unit)} past the end of ${wall} (${formatLength(leg.wallLength, unit)} long).`)
    if (leg.width < 150) out.push(`Along ${wall} it’s too short to clear the corner.`)
    const cuts = cutsFor(solved, r, leg.group[0])
    let door = false
    let window = false
    for (const cut of cuts) {
      if (cut.to <= leg.from + 1 || cut.from >= leg.to - 1) continue
      if (cut.head <= y0 || cut.sill >= y1) continue
      if (cut.sill < DOOR_SILL) door = true
      else window = true
    }
    if (door) out.push(`It’s across a doorway on ${wall}.`)
    if (window)
      out.push(
        c.top && c.kind !== 'wall'
          ? `A window on ${wall} has its sill below the top (at ${formatLength(y1, unit)}).`
          : `It covers part of a window on ${wall}.`,
      )
  })

  // Pillars go floor to ceiling, so they're in the way of a cabinet at any height.
  const body = outline(p, c.depth)
  for (const pillar of r.pillars)
    if (overlapsPillar(body, pillar)) out.push(`It runs into the pillar on wall ${wallNumber(r, pillar.edge)}.`)

  if (y1 > r.height + 0.5) out.push(`Its top, at ${formatLength(y1, unit)}, is above the ceiling (${formatLength(r.height, unit)}).`)

  let wideDoors = 0
  let wideSliding = 0
  let wideDrawers = 0
  let lowDrawers = 0
  let tallInside = 0
  let farShelves = 0
  let over = 0
  p.legs.forEach((leg, k) => {
    const front = c.legs[k]
    if (!front) return
    const laid = layOut(front, { x: 0, y: 0, w: leg.width, h: c.height })
    over += laid.over
    for (const { cell, rect } of laid.cells) {
      if (cell.front === 'door' && cell.hinge === 'sliding') {
        if (rect.w / 2 > WIDE_SLIDING + 0.5) wideSliding += 2
      } else if (cell.front === 'door' && cell.hinge !== 'lift') {
        const leaves = cell.hinge === 'pair' ? 2 : 1
        if (doorSpace(cell, rect).doors.w / leaves > WIDE_DOOR + 0.5) wideDoors += leaves
      }
      if (cell.front === 'drawers') {
        if (rect.w > WIDE_DRAWER + 0.5) wideDrawers++
        if (rect.h / cell.drawers < LOW_DRAWER) lowDrawers++
      }
      const inside = insideSpace(cell, rect)
      if (inside.drawers) {
        if (rect.w > WIDE_DRAWER + 0.5) wideDrawers++
        if (inside.drawers.h / inside.n < LOW_DRAWER) lowDrawers++
        if ((cell.insideDrawersHeight ?? 0) > rect.h - MIN_PART + 0.5) tallInside++
      }
      if ((cell.front === 'door' || cell.front === 'open') && cell.shelfGap != null && shelfSpacing(cell, inside.above.h)?.fits === false)
        farShelves++
    }
  })
  if (over > 0.5) out.push('Some compartments are set wider (or taller) than the space they’re in.')
  if (wideDoors) out.push(`${plural(wideDoors, 'door')} ${wideDoors === 1 ? 'is' : 'are'} over ${WIDE_DOOR} mm wide: heavy to open, and may sag. Try a pair.`)
  if (wideSliding) out.push(`${plural(wideSliding, 'sliding door')} ${wideSliding === 1 ? 'is' : 'are'} over ${WIDE_SLIDING} mm wide.`)
  if (wideDrawers) out.push(`${plural(wideDrawers, 'drawer stack')} ${wideDrawers === 1 ? 'is' : 'are'} over ${WIDE_DRAWER} mm wide.`)
  if (lowDrawers) out.push(`${plural(lowDrawers, 'drawer stack')} ${lowDrawers === 1 ? 'has' : 'have'} fronts under ${LOW_DRAWER} mm high.`)
  if (tallInside)
    out.push(
      `The drawers inside ${tallInside === 1 ? 'one compartment' : `${tallInside} compartments`} are set too tall, leaving under ${MIN_PART} mm over them; they’re drawn shorter.`,
    )
  if (farShelves)
    out.push(
      `The shelves in ${farShelves === 1 ? 'one compartment' : `${farShelves} compartments`} are set too far apart to fit, leaving under ${MIN_PART} mm past the last; they’re drawn closer.`,
    )

  if (c.top) {
    const stoneDepth = c.depth + c.top.overhang
    for (const x of c.top.cutouts) {
      const leg = p.legs[x.leg]
      const what = CUTOUT_LABEL[x.kind]
      if (!leg) {
        out.push(`The ${what} cut-out is on a wall the cabinet no longer has.`)
        continue
      }
      if (x.x - x.width / 2 < 0 || x.x + x.width / 2 > leg.width)
        out.push(`The ${what} cut-out runs past the end of the front along wall ${leg.wallNo}.`)
      if ((stoneDepth - x.depth) / 2 < MIN_STONE_EDGE)
        out.push(`The ${what} cut-out leaves less than ${MIN_STONE_EDGE} mm of stone in front of it.`)
      const under = cellUnder(c, p, x)
      const drawers = under && (under.cell.front === 'drawers' || insideSpace(under.cell, under.rect).n > 0)
      if (under && x.kind !== 'hob' && (drawers || under.cell.front === 'appliance'))
        out.push(`The ${what} is over ${drawers ? 'drawers' : 'an appliance'}; the bowl and pipes need that space.`)
      if (under && x.kind === 'hob' && under.cell.front === 'appliance' && under.cell.appliance !== 'oven')
        out.push(`The hob is over the ${under.cell.appliance}.`)
      if (under && x.kind !== 'hob' && x.width > under.rect.w - 2 * c.board)
        out.push(`The ${what} cut-out is wider than the compartment under it.`)
    }
  }
  return out
}
