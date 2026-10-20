import { groupOf } from '../geometry/runs'
import type { Solved, SolvedRoom } from '../geometry/solve'
import { cross } from '../geometry/vec'
import { uid } from '../store'
import { cabinetKindInfo, type Cabinet, type CabinetKind, type CabinetSection, type CabinetWalls, type Cutout, type RoomType } from '../types'
import { cornerOf, emptyCorner, placeCabinet, resolveWalls } from './placement'
import { cell } from './sections'
import { DEFAULT_CARCASS, DEFAULT_FRONTS, defaultTemplate, newWorktop, templateById, templateSize, type CabinetTemplate } from './templates'

/** What a room usually gets. */
export function kindForRoom(t: RoomType): CabinetKind {
  return t === 'kitchen' ? 'base' : t === 'bedroom' ? 'wardrobe' : t === 'bathroom' ? 'vanity' : t === 'utility' ? 'tall' : 'other'
}

const widthsOf = (solved: Solved, c: Pick<Cabinet, 'walls' | 'depth'>) => {
  const res = placeCabinet(solved, c)
  return res.ok ? res.placement.legs.map((l) => Math.max(0, l.width)) : null
}

const withIds = (cutouts: ReturnType<CabinetTemplate['build']>['cutouts']) => (cutouts ?? []).map((x) => ({ ...x, id: uid() }))

/** A name not yet used, e.g. "Kitchen base cabinet 2". */
export function freshName(base: string, taken: string[]) {
  if (!taken.includes(base)) return base
  for (let n = 2; ; n++) if (!taken.includes(`${base} ${n}`)) return `${base} ${n}`
}

/**
 * A new cabinet along all of one wall, of the kind the room usually gets, from that kind's first template.
 * It takes its finishes from the last cabinet made, as a new light takes the last one's settings.
 */
export function createCabinet(solved: Solved, r: SolvedRoom, edge: number, existing: Cabinet[]): Omit<Cabinet, 'id'> | null {
  const g = groupOf(r.groups, edge)
  if (r.room.edges[g[0]].kind !== 'wall') return null
  const kind = kindForRoom(r.room.type)
  const t = defaultTemplate(kind)
  const size = templateSize(t)
  const walls: CabinetWalls = { roomId: r.room.id, edgeIds: [r.room.edges[g[0]].id], start: 0, length: null }
  const widths = widthsOf(solved, { walls, depth: size.depth })
  if (!widths) return null
  const built = t.build(widths)
  const last = existing[existing.length - 1]
  return {
    name: freshName(`${r.room.name} ${cabinetKindInfo(kind).label.toLowerCase()}`, existing.map((c) => c.name)),
    kind,
    template: t.id,
    walls,
    legs: built.legs,
    height: size.height,
    depth: size.depth,
    bottom: size.bottom,
    mount: size.mount,
    board: last?.board ?? 18,
    handle: last?.handle ?? 'bar',
    carcass: last?.carcass ?? { ...DEFAULT_CARCASS },
    fronts: last?.fronts ?? { ...DEFAULT_FRONTS },
    top: size.top ? { ...(last?.top ?? newWorktop()), cutouts: withIds(built.cutouts) } : null,
  }
}

/** The front a template gives leg k of a cabinet on these walls. */
function templateLeg(solved: Solved, c: Cabinet, walls: CabinetWalls, k: number): CabinetSection {
  const t = templateById(c.template)
  const widths = widthsOf(solved, { walls, depth: c.depth })
  return (t && widths && t.build(widths).legs[k]) || cell('door')
}

/**
 * The cabinet on new walls. A cabinet still just as its template made it is made again from the template,
 * to fit them. Otherwise keep[k] is the old leg that becomes leg k (its front and cut-outs come along), or
 * null for a new leg, filled from the template.
 */
function rewall(solved: Solved, c: Cabinet, walls: CabinetWalls, keep: (number | null)[]): Partial<Cabinet> {
  if (asTemplate(solved, c)) return rebuild(solved, c, walls)
  // A corner between two legs that stay side by side stays as it was; a new one starts empty.
  const corners = keep.slice(1).map((b, k) => {
    const a = keep[k]
    return a != null && b === a + 1 ? cornerOf(c, a) : emptyCorner()
  })
  const legs = keep.map((old, k) => (old == null ? templateLeg(solved, c, walls, k) : c.legs[old] ?? templateLeg(solved, c, walls, k)))
  const top = c.top && {
    ...c.top,
    cutouts: c.top.cutouts.flatMap((x) => {
      const k = keep.indexOf(x.leg)
      return k < 0 ? [] : [{ ...x, leg: k }]
    }),
  }
  return { walls, legs, corners, top }
}

/** Everything from the template again, on these walls: fronts, and cut-outs if it has a top. */
function rebuild(solved: Solved, c: Cabinet, walls: CabinetWalls): Partial<Cabinet> {
  const t = templateById(c.template)
  const widths = widthsOf(solved, { walls, depth: c.depth })
  if (!t || !widths) return { walls }
  const built = t.build(widths)
  return { walls, legs: built.legs, corners: undefined, top: c.top && { ...c.top, cutouts: withIds(built.cutouts) } }
}

/**
 * Tapping a wall while placing a cabinet: the wall just past either end turns the corner onto it (up to
 * a U); an end wall it's already on is taken off again; any other wall moves it there, along all of it,
 * taking its first leg's compartments (and cut-outs) along. Null when the tap changes nothing.
 */
export function tapWall(solved: Solved, c: Cabinet, r: SolvedRoom, edge: number): Partial<Cabinet> | null {
  const g = groupOf(r.groups, edge)
  if (r.room.edges[g[0]].kind !== 'wall') return null
  const id = r.room.edges[g[0]].id
  const moveHere = () => rewall(solved, c, { roomId: r.room.id, edgeIds: [id], start: 0, length: null }, [0])
  const res = resolveWalls(solved, c.walls)
  if (!res.ok || res.room.room.id !== r.room.id) return moveHere()
  const { groups } = res
  const ids = c.walls.edgeIds
  const n = r.room.edges.length
  const k = groups.findIndex((x) => x[0] === g[0])
  const legs = groups.map((_, i) => i)
  if (k >= 0) {
    if (groups.length === 1 || (k > 0 && k < groups.length - 1)) return null
    if (k === 0) return rewall(solved, c, { ...c.walls, edgeIds: ids.slice(1), start: 0 }, legs.slice(1))
    return rewall(solved, c, { ...c.walls, edgeIds: ids.slice(0, -1), length: null }, legs.slice(0, -1))
  }
  if (groups.length >= 3) return moveHere()
  const first = groups[0][0]
  const lastEdge = groups[groups.length - 1][groups[groups.length - 1].length - 1]
  const inside = (a: number, b: number) => cross(r.dirs[a], r.dirs[b]) > 0
  if (g[0] === (lastEdge + 1) % n && inside(lastEdge, g[0]))
    return rewall(solved, c, { ...c.walls, edgeIds: [...ids, id], length: null }, [...legs, null])
  if ((g[g.length - 1] + 1) % n === first && inside(g[g.length - 1], first)) {
    // The old first wall now starts at the corner; a straight cabinet's right end stays where it was.
    const length = groups.length === 1 ? (c.walls.length == null ? null : c.walls.start + c.walls.length) : c.walls.length
    return rewall(solved, c, { ...c.walls, edgeIds: [id, ...ids], start: 0, length }, [null, ...legs])
  }
  return moveHere()
}

/** The cabinet made from a template: its sizes, fronts and cut-outs (its top's other settings stay). */
export function applyTemplate(solved: Solved, c: Cabinet, t: CabinetTemplate): Partial<Cabinet> {
  const size = templateSize(t)
  const walls = c.walls
  const widths = widthsOf(solved, { walls, depth: size.depth }) ?? c.legs.map(() => 1000)
  const built = t.build(widths)
  return {
    kind: t.kind,
    template: t.id,
    height: size.height,
    depth: size.depth,
    bottom: size.bottom,
    mount: size.mount,
    legs: built.legs,
    corners: undefined,
    top: size.top ? { ...(c.top ?? newWorktop()), cutouts: withIds(built.cutouts) } : null,
  }
}

const withoutIds = (cutouts: (Omit<Cutout, 'id'> & { id?: string })[]) => cutouts.map(({ id: _, ...x }) => x)

/**
 * Whether its compartments and cut-outs are just as its template made them for its walls, and its corners as
 * they start (so nothing's lost making them again).
 */
export function asTemplate(solved: Solved, c: Cabinet): boolean {
  if (c.corners?.some((x) => x.open !== 'left' || x.shelves > 0)) return false
  const t = templateById(c.template)
  const widths = widthsOf(solved, c)
  if (!t || !widths) return false
  const built = t.build(widths)
  if (JSON.stringify(built.legs) !== JSON.stringify(c.legs)) return false
  return !c.top || JSON.stringify(withoutIds(built.cutouts ?? [])) === JSON.stringify(withoutIds(c.top.cutouts))
}

/** Its walls changed, and if it's still as its template made it, the template made again to fit them. */
export const withWalls = (solved: Solved, c: Cabinet, walls: CabinetWalls): Partial<Cabinet> =>
  asTemplate(solved, c) ? rebuild(solved, c, walls) : { walls }

/** Whether re-applying a template would lose changes made to its compartments or cut-outs. */
export const frontsEdited = (solved: Solved, c: Cabinet) => !asTemplate(solved, c)
