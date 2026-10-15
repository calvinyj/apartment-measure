import { describe, expect, it } from 'vitest'
import { solveProject } from '../geometry/solve'
import { DEFAULT_SETTINGS, type Cabinet, type Edge, type Opening, type Project, type Room } from '../types'
import { cabinetWarnings, cellUnder } from './checks'
import { applyTemplate, asTemplate, createCabinet, tapWall, withWalls } from './edit'
import { addMaterials, allBoard, cabinetMaterials, innerBoard, outerBoard, sheetsFor } from './materials'
import { outline, placeCabinet, type Placement } from './placement'
import { across, cell, cellsOf, doorSpace, isSplit, layOut, moveDivider, movePart, partSizes, removeAt, sectionAt, setPartSize, splitAt, stack } from './sections'
import { DEFAULT_CARCASS, DEFAULT_FRONTS, KIND_SIZES, newWorktop, templateById, templateSize, TEMPLATES } from './templates'
import { area } from '../geometry/polygon'

// 1 px = 10 mm, traced along the inside faces. Room K is 4 m wide (walls 1 and 3) by 3 m (walls 2 and 4).
function room(openings: Opening[][] = []): Room {
  const pts: [number, number][] = [
    [0, 0],
    [400, 0],
    [400, 300],
    [0, 300],
  ]
  const edges: Edge[] = pts.map((_, i) => ({
    id: `e${i}`,
    kind: 'wall',
    measured: null,
    thickness: null,
    side: 'auto',
    openings: openings[i] ?? [],
  }))
  return { id: 'K', name: 'Kitchen', type: 'kitchen', points: pts.map(([x, y]) => ({ x, y })), edges, height: 2700, acZone: '', ac: null, sunny: null }
}

function project(r: Room): Project {
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

// Pairs of doors no wider than 1200 mm on runs up to 4.8 m, so no warning about wide doors.
const doorPairs = across([null, cell('door')], [null, cell('door')], [null, cell('door')], [null, cell('door')])

function cabinet(patch: Partial<Cabinet> = {}): Cabinet {
  return {
    id: 'c',
    name: 'Kitchen base',
    kind: 'base',
    template: 'base-blank',
    walls: { roomId: 'K', edgeIds: ['e0'], start: 0, length: null },
    legs: [doorPairs],
    ...KIND_SIZES.base,
    board: 18,
    handle: 'bar',
    carcass: DEFAULT_CARCASS,
    fronts: DEFAULT_FRONTS,
    top: null,
    ...patch,
  }
}

const solvedOf = (r = room()) => solveProject(project(r))

function placed(c: Cabinet, r = room()): Placement {
  const res = placeCabinet(solvedOf(r), c)
  if (!res.ok) throw new Error(res.error)
  return res.placement
}

const opening = (patch: Partial<Opening>): Opening => ({ id: 'o', kind: 'door', offset: 0, width: 900, height: 2100, sill: 0, ...patch })

describe('compartments', () => {
  it('shares what fixed parts leave, and lets the last take up the difference when all are fixed', () => {
    expect(partSizes([450, null, null], 2400)).toEqual({ sizes: [450, 975, 975], flex: [false, true, true], over: 0 })
    expect(partSizes([500, 500], 1200)).toEqual({ sizes: [500, 700], flex: [false, true], over: 0 })
    expect(partSizes([1500, null], 1200)).toEqual({ sizes: [1500, 0], flex: [false, true], over: 300 })
  })

  it('lays out splits within splits, and the dividers between their parts', () => {
    const front = across([450, stack([null, cell('drawers')], [200, cell('open')])], [null, cell('door')])
    const laid = layOut(front, { x: 0, y: 0, w: 1200, h: 700 })
    expect(laid.cells.map((c) => [c.path, c.rect])).toEqual([
      [[0, 0], { x: 0, y: 0, w: 450, h: 500 }],
      [[0, 1], { x: 0, y: 500, w: 450, h: 200 }],
      [[1], { x: 450, y: 0, w: 750, h: 700 }],
    ])
    expect(laid.dividers.map((d) => [d.path, d.index, d.split, d.at])).toEqual([
      [[0], 0, 'stack', 500],
      [[], 0, 'across', 450],
    ])
  })

  it('splits a compartment, alongside its neighbours when the split is the same way', () => {
    const one = splitAt(cell('door'), [], 'across', 3)
    expect(isSplit(one) && one.parts.map((p) => p.size)).toEqual([null, null, null])
    const two = splitAt(across([900, cell('door')], [null, cell('drawers')]), [0], 'across', 2)
    expect(isSplit(two) && two.parts.map((p) => p.size)).toEqual([450, 450, null])
    const nested = splitAt(across([900, cell('door')], [null, cell('drawers')]), [0], 'stack', 2)
    expect(sectionAt(nested, [0])).toMatchObject({ split: 'stack' })
  })

  it('removes a compartment, giving its fixed size to a fixed neighbour, and collapses a split of one', () => {
    const front = across([300, cell('door')], [400, cell('drawers')], [null, cell('open')])
    const gone = removeAt(front, [0])
    expect(isSplit(gone) && gone.parts.map((p) => p.size)).toEqual([700, null])
    expect(removeAt(across([300, cell('door')], [null, cell('drawers')]), [1])).toEqual(cell('door'))
    expect(removeAt(cell('door'), [])).toEqual(cell('door'))
  })

  it('swaps a compartment with its neighbour, size and all; within a column, the whole column', () => {
    const front = across([450, stack([null, cell('drawers')], [200, cell('open')])], [900, cell('door')], [null, cell('panel')])
    const right = movePart(front, [1], 'across', 1)!
    expect(right).toMatchObject({ path: [2], split: [], from: 1, to: 2 })
    expect(isSplit(right.root) && right.root.parts.map((p) => [p.size, isSplit(p.section) ? 'stack' : p.section.front])).toEqual([
      [450, 'stack'],
      [null, 'panel'],
      [900, 'door'],
    ])
    // The drawers are in a column: left/right moves the column, up/down moves within it.
    const col = movePart(front, [0, 0], 'across', 1)!
    expect(col.path).toEqual([1, 0])
    expect(sectionAt(col.root, [1, 1])).toEqual(cell('open'))
    expect(movePart(front, [0, 0], 'stack', 1)!.path).toEqual([0, 1])
    expect(movePart(front, [0, 0], 'across', -1)).toBeNull()
    expect(movePart(front, [1], 'stack', 1)).toBeNull()
  })

  it('puts a fixed panel beside hinged doors, half the compartment unless sized, leaving the doors at least 100 mm', () => {
    const r = { x: 0, y: 0, w: 900, h: 700 }
    expect(doorSpace(cell('door', { hinge: 'right', fixed: 'left' }), r)).toEqual({ fixed: { ...r, w: 450 }, doors: { ...r, x: 450, w: 450 } })
    expect(doorSpace(cell('door', { hinge: 'left', fixed: 'right', fixedWidth: 300 }), r)).toEqual({ fixed: { ...r, x: 600, w: 300 }, doors: { ...r, w: 600 } })
    expect(doorSpace(cell('door', { fixed: 'right', fixedWidth: 880 }), r).doors.w).toBe(100)
    // Not beside sliding or lift-up doors, nor on other fronts.
    expect(doorSpace(cell('door', { hinge: 'sliding', fixed: 'left' }), r)).toEqual({ fixed: null, doors: r })
    expect(doorSpace(cell('open', { fixed: 'left' }), r)).toEqual({ fixed: null, doors: r })
  })

  it('sets sizes and drags dividers, keeping each part at least 100 mm', () => {
    const front = across([null, cell('door')], [null, cell('drawers')])
    const set = setPartSize(front, [1], 333.4)
    expect(isSplit(set) && set.parts[1].size).toBe(333)
    const moved = moveDivider(front, { path: [], index: 0 }, [600, 600], 450)
    expect(isSplit(moved) && moved.parts.map((p) => p.size)).toEqual([1050, 150])
    const clamped = moveDivider(front, { path: [], index: 0 }, [600, 600], 900)
    expect(isSplit(clamped) && clamped.parts.map((p) => p.size)).toEqual([1100, 100])
  })
})

describe('placing a cabinet on its walls', () => {
  it('runs along part of one wall', () => {
    const p = placed(cabinet({ walls: { roomId: 'K', edgeIds: ['e0'], start: 500, length: 2000 } }))
    expect(p.legs).toHaveLength(1)
    expect(p.legs[0]).toMatchObject({ wallNo: 1, from: 500, to: 2500, width: 2000 })
    expect(p.legs[0].wallLength).toBeCloseTo(4000)
  })

  it('turns an inside corner into an L: each front loses the depth of the other leg', () => {
    const p = placed(cabinet({ walls: { roomId: 'K', edgeIds: ['e0', 'e1'], start: 1000, length: 1500 } }))
    const [a, b] = p.legs
    expect(a.from).toBe(1000)
    expect(a.to).toBeCloseTo(4000)
    expect(a.width).toBeCloseTo(2400)
    expect(b.from).toBe(0)
    expect(b.to).toBe(1500)
    expect(b.width).toBeCloseTo(900)
    // From above: 3000 × 600 along wall 1, and 900 × 600 more along wall 2.
    expect(area(outline(p, 600))).toBeCloseTo(3000 * 600 + 900 * 600)
  })

  it('makes a U of three walls, the middle one losing a depth at each end', () => {
    const p = placed(cabinet({ walls: { roomId: 'K', edgeIds: ['e3', 'e0', 'e1'], start: 1000, length: null } }))
    expect(p.legs.map((l) => Math.round(l.width))).toEqual([2000 - 600, 4000 - 1200, 3000 - 600])
    expect(p.legs.map((l) => l.wallNo)).toEqual([4, 1, 2])
  })

  it('refuses walls that aren’t next to each other, or that are gone', () => {
    const s = solvedOf()
    expect(placeCabinet(s, cabinet({ walls: { roomId: 'K', edgeIds: ['e0', 'e2'], start: 0, length: null } }))).toMatchObject({ ok: false })
    expect(placeCabinet(s, cabinet({ walls: { roomId: 'K', edgeIds: ['nope'], start: 0, length: null } }))).toMatchObject({ ok: false })
    expect(placeCabinet(s, cabinet({ walls: { roomId: 'gone', edgeIds: ['e0'], start: 0, length: null } }))).toMatchObject({ ok: false })
  })
})

describe('warnings', () => {
  const warn = (c: Cabinet, r = room()) => cabinetWarnings(solvedOf(r), c, placed(c, r), 'mm')

  it('warns when it runs past the end of its wall', () => {
    expect(warn(cabinet({ walls: { roomId: 'K', edgeIds: ['e0'], start: 3000, length: 2000 } })).join(' ')).toMatch(/1,000 mm past the end of wall 1/)
    expect(warn(cabinet({ walls: { roomId: 'K', edgeIds: ['e0'], start: 0, length: 4000 } }))).toEqual([])
  })

  it('warns about a doorway behind it, and a window sill below its top', () => {
    const c = cabinet({ walls: { roomId: 'K', edgeIds: ['e0'], start: 500, length: 2000 }, top: newWorktop() })
    expect(warn(c, room([[opening({ offset: 1000 })]])).join(' ')).toMatch(/doorway on wall 1/)
    expect(warn(c, room([[opening({ offset: 3000 })]]))).toEqual([])
    expect(warn(c, room([[opening({ kind: 'window', offset: 1000, sill: 1000, height: 1200 })]]))).toEqual([])
    expect(warn(c, room([[opening({ kind: 'window', offset: 1000, sill: 800, height: 1200 })]])).join(' ')).toMatch(/sill below the top/)
  })

  it('warns about wide single doors, and a sink over drawers', () => {
    const c = cabinet({
      walls: { roomId: 'K', edgeIds: ['e0'], start: 0, length: 1600 },
      legs: [across([800, cell('door', { hinge: 'left' })], [null, cell('drawers')])],
      top: { ...newWorktop(), cutouts: [{ id: 's', kind: 'sink', leg: 0, x: 1200, width: 600, depth: 440, mount: 'under' }] },
    })
    const w = warn(c).join(' ')
    expect(w).toMatch(/1 door is over 600 mm wide/)
    expect(w).toMatch(/sink is over drawers/)
    expect(cellUnder(c, placed(c), c.top!.cutouts[0])?.path).toEqual([1])
  })

  it('measures a door beside a fixed panel by what the panel leaves it', () => {
    const c = (fixedWidth: number) =>
      cabinet({ walls: { roomId: 'K', edgeIds: ['e0'], start: 0, length: 1000 }, legs: [cell('door', { hinge: 'right', fixed: 'left', fixedWidth })] })
    expect(warn(c(300)).join(' ')).toMatch(/1 door is over 600 mm wide/)
    expect(warn(c(500))).toEqual([])
  })
})

describe('materials', () => {
  it('adds up the board and hardware of a simple box', () => {
    const c = cabinet({
      walls: { roomId: 'K', edgeIds: ['e0'], start: 0, length: 1000 },
      legs: [cell('door', { shelves: 1 })],
      height: 700,
      depth: 600,
      bottom: 100,
    })
    const m = cabinetMaterials(c, placed(c))
    expect(m.board).toMatchObject({
      shell: 2 * 700 * 600 + 2 * 1000 * 600,
      back: 1000 * 700,
      fronts: 1000 * 700,
      plinth: 1000 * 100,
      dividers: 0,
      shelves: 1000 * 580,
      drawerBoxes: 0,
    })
    expect(m).toMatchObject({ doors: 2, hinges: 4, handles: 2, shelves: 1, drawers: 0, plinthLength: 1000, top: null })
    expect(outerBoard(m.board) + innerBoard(m.board)).toBe(allBoard(m.board))
  })

  it('counts dividers, drawers and the stone top of an L', () => {
    const c = cabinet({
      walls: { roomId: 'K', edgeIds: ['e0', 'e1'], start: 1000, length: 1500 },
      legs: [across([null, cell('drawers')], [null, cell('door')]), cell('door', { hinge: 'left' })],
      top: { ...newWorktop(), overhang: 20, upstand: 100, cutouts: [{ id: 's', kind: 'sink', leg: 0, x: 1800, width: 760, depth: 440, mount: 'under' }] },
    })
    const m = cabinetMaterials(c, placed(c))
    expect(m.drawers).toBe(3)
    expect(m.doors).toBe(3)
    expect(m.board.dividers).toBe(760 * 600)
    expect(m.top!.area).toBeCloseTo(3000 * 620 + (1500 - 620) * 620)
    expect(m.top!.length).toBeCloseTo(4500)
    expect(m.top!.upstand).toBeCloseTo(4500 * 100)
    expect(m.top!.frontEdge).toBeCloseTo(3000 - 620 + 1500 - 620)
    expect(m.top!.cutouts).toEqual({ sink: 1 })
    const twice = addMaterials([m, m])
    expect(twice.drawers).toBe(6)
    expect(twice.top!.cutouts).toEqual({ sink: 2 })
  })

  it('counts a fixed panel as front board, with hinges and a handle only on the door beside it', () => {
    const c = cabinet({
      walls: { roomId: 'K', edgeIds: ['e0'], start: 0, length: 1000 },
      legs: [cell('door', { hinge: 'right', fixed: 'left', fixedWidth: 400, shelves: 2 })],
      height: 700,
      depth: 600,
    })
    const m = cabinetMaterials(c, placed(c))
    expect(m.board.fronts).toBe(1000 * 700)
    expect(m.board.shelves).toBe(2 * 1000 * 580)
    expect(m).toMatchObject({ doors: 1, hinges: 2, handles: 1, shelves: 2 })
    const pair = cabinet({ ...c, legs: [cell('door', { hinge: 'pair', fixed: 'left', fixedWidth: 200 })] })
    expect(cabinetMaterials(pair, placed(pair))).toMatchObject({ doors: 2, hinges: 4, handles: 2 })
  })

  it('rounds sheets up', () => {
    expect(sheetsFor(0)).toBe(0)
    expect(sheetsFor(2440 * 1220)).toBe(1)
    expect(sheetsFor(2440 * 1220 + 1)).toBe(2)
  })
})

describe('templates', () => {
  it('fill any run without overrunning it, with cut-outs over their compartments', () => {
    for (const t of TEMPLATES) {
      for (const widths of [[600], [2400], [3600], [2400, 1500], [1800, 2400, 1800]]) {
        const { legs, cutouts = [] } = t.build(widths)
        expect(legs, `${t.id} ${widths}`).toHaveLength(widths.length)
        legs.forEach((front, k) => {
          const laid = layOut(front, { x: 0, y: 0, w: widths[k], h: templateSize(t).height })
          expect(laid.over, `${t.id} ${widths}`).toBe(0)
          expect(laid.cells.every((c) => c.rect.w > 0), `${t.id} ${widths}`).toBe(true)
          expect(cellsOf(front).length).toBe(laid.cells.length)
        })
        for (const x of cutouts) expect(x.x, `${t.id} ${widths}`).toBeLessThan(widths[x.leg])
      }
    }
  })
})

describe('placing and reshaping by tapping walls', () => {
  const s = solvedOf()
  const r = s.byId.get('K')!
  const start = (edge = 0) => ({ ...createCabinet(s, r, edge, [])!, id: 'c' }) as Cabinet
  const tap = (c: Cabinet, edge: number) => ({ ...c, ...tapWall(s, c, r, edge)! }) as Cabinet

  it('starts a cabinet along all of the tapped wall, of the kind the room usually has', () => {
    const c = start()
    expect(c).toMatchObject({ kind: 'base', template: 'base-kitchen', name: 'Kitchen base cabinet' })
    expect(c.walls).toEqual({ roomId: 'K', edgeIds: ['e0'], start: 0, length: null })
    expect(c.top?.cutouts.map((x) => x.kind)).toEqual(['sink', 'hob'])
    expect(createCabinet(s, r, 0, [c])?.name).toBe('Kitchen base cabinet 2')
  })

  it('turns the corner onto the wall past either end, and takes an end wall off again', () => {
    const l = tap(start(), 1)
    expect(l.walls.edgeIds).toEqual(['e0', 'e1'])
    expect(l.legs).toHaveLength(2)
    // Still as its template made it, so it's made again: the hob moves to the new last wall.
    expect(l.top!.cutouts.map((x) => [x.kind, x.leg])).toEqual([
      ['sink', 0],
      ['hob', 1],
    ])
    expect(asTemplate(s, l)).toBe(true)
    const u = tap(l, 3)
    expect(u.walls).toMatchObject({ edgeIds: ['e3', 'e0', 'e1'], start: 0 })
    expect(tapWall(s, u, r, 0)).toBeNull()
    expect(tap(u, 3).walls.edgeIds).toEqual(['e0', 'e1'])
    expect(tap(u, 1).walls.edgeIds).toEqual(['e3', 'e0'])
  })

  it('moves to a wall that isn’t past either end', () => {
    expect(tap(start(), 2).walls).toEqual({ roomId: 'K', edgeIds: ['e2'], start: 0, length: null })
  })

  it('keeps compartments that were changed, adding the new leg from the template', () => {
    const c = { ...start(), legs: [cell('open', { shelves: 4 })] }
    expect(asTemplate(s, c)).toBe(false)
    const l = tap(c, 1)
    expect(l.legs[0]).toEqual(cell('open', { shelves: 4 }))
    expect(l.legs).toHaveLength(2)
    expect(withWalls(s, c, { ...c.walls, start: 500 })).toEqual({ walls: { ...c.walls, start: 500 } })
  })

  it('moves to another wall with the compartments that were changed, not the template’s', () => {
    // A U along walls 4, 1 and 2, changed; wall 3 isn't past either end, so tapping it moves the cabinet.
    const u = { ...tap(tap(start(), 1), 3), legs: [cell('open', { shelves: 4 }), cell('drawers'), cell('door')] }
    expect(u.top!.cutouts.map((x) => [x.kind, x.leg])).toEqual([
      ['sink', 0],
      ['hob', 2],
    ])
    const moved = tap(u, 2)
    expect(moved.walls).toEqual({ roomId: 'K', edgeIds: ['e2'], start: 0, length: null })
    expect(moved.legs).toEqual([cell('open', { shelves: 4 })])
    expect(moved.top!.cutouts.map((x) => [x.kind, x.leg])).toEqual([['sink', 0]])
  })

  it('applies a template’s sizes, fronts and top', () => {
    const c = start()
    const w = { ...c, ...applyTemplate(s, c, templateById('wardrobe-hanging')!) } as Cabinet
    expect(w).toMatchObject({ kind: 'wardrobe', height: 2300, depth: 600, mount: 'plinth', top: null })
    expect(asTemplate(s, w)).toBe(true)
  })
})
