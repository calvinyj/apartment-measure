import { LIGHT_KINDS, type Light, type LightKind, type LightTemp, type Room, type Vec2 } from '../types'
import { normDeg } from './facing'
import { area, bbox, centroid, pointInPolygon } from './polygon'
import type { Solved, SolvedRoom } from './solve'
import { add, cross, dist, dot, outward, scale, sub } from './vec'

const RAD = Math.PI / 180

export const direction = (deg: number): Vec2 => ({ x: Math.cos(deg * RAD), y: Math.sin(deg * RAD) })
export const angleOf = (v: Vec2) => Math.atan2(v.y, v.x) / RAD

/** Where each room's lights are measured from: the centre of its measured outline. */
export function roomAnchors(solved: Solved): Map<string, Vec2> {
  return new Map(solved.rooms.map((r) => [r.room.id, centroid(r.outline)]))
}

/** A light's centre on the measured layout, in mm; null once its room is gone. */
export function lightCentre(anchors: Map<string, Vec2>, l: Light): Vec2 | null {
  const a = anchors.get(l.roomId)
  return a ? add(a, { x: l.x, y: l.y }) : null
}

/** The two ends of a pendant or LED tube running through c. */
export function lightEnds(c: Vec2, l: Pick<Light, 'angle' | 'length'>): [Vec2, Vec2] {
  const h = scale(direction(l.angle), l.length / 2)
  return [sub(c, h), add(c, h)]
}

/** The room a point is in (the smallest, where rooms overlap); null outside every room. */
export function roomAt(solved: Solved, p: Vec2): SolvedRoom | null {
  const hits = solved.rooms.filter((r) => pointInPolygon(p, r.outline))
  hits.sort((a, b) => area(a.outline) - area(b.outline))
  return hits[0] ?? null
}

function distToSegment(p: Vec2, a: Vec2, b: Vec2) {
  const ab = sub(b, a)
  const l2 = dot(ab, ab)
  const t = l2 > 0 ? Math.max(0, Math.min(1, dot(sub(p, a), ab) / l2)) : 0
  return dist(p, add(a, scale(ab, t)))
}

/** The room's wall nearest p: which way it runs (corner A to B) and how far away it is. */
export function nearestWall(r: SolvedRoom, p: Vec2): { dir: Vec2; dist: number } | null {
  let best: { dir: Vec2; dist: number } | null = null
  r.room.edges.forEach((e, i) => {
    if (e.kind !== 'wall') return
    const d = distToSegment(p, r.starts[i], r.ends[i])
    if (!best || d < best.dist) best = { dir: r.dirs[i], dist: d }
  })
  return best
}

export const DEFAULT_LENGTH: Record<LightKind, number> = {
  downlight: 0,
  surface: 0,
  eyeball: 0,
  pendant: 1200,
  strip: 1000,
  fan: 1320,
}

/** LED tubes are sold by the foot, with the watts usual for each length. */
export const TUBE_SIZES = [
  { feet: 1, mm: 300, watts: [4, 5] },
  { feet: 2, mm: 600, watts: [8, 9, 10] },
  { feet: 3, mm: 900, watts: [12, 14] },
  { feet: 4, mm: 1200, watts: [16, 18, 20] },
  { feet: 5, mm: 1500, watts: [22, 24] },
]

export const DEFAULT_TUBE = 1200

/**
 * How many tubes light a run end to end. A tube can't be cut, so the last one overlaps; a run up to
 * 5% of a tube longer than whole tubes still takes whole tubes, with the ends sitting just short.
 */
export const tubesFor = (l: Pick<Light, 'length' | 'size'>) =>
  Math.max(1, Math.ceil(l.length / (l.size ?? DEFAULT_TUBE) - 0.05))

/** Ceiling fans are sold by blade sweep in inches; stored in mm, to the nearest 10. */
export const FAN_SIZES = [36, 42, 46, 48, 52, 56, 60].map((inches) => ({
  inches,
  mm: Math.round((inches * 25.4) / 10) * 10,
}))

const fanMm = (inches: number) => FAN_SIZES.find((s) => s.inches === inches)!.mm

/** A usual blade sweep for a room's floor area (mm²): the common rule of thumb by room size. */
export function fanSizeFor(floor: number): number {
  const m2 = floor / 1e6
  return fanMm(m2 <= 7 ? 36 : m2 <= 13.5 ? 42 : m2 <= 21 ? 48 : m2 <= 37 ? 52 : 56)
}

/**
 * A new light at p (in room r, measured from its anchor), turned to suit the room: an eyeball
 * aims at the nearest wall, an LED tube runs along it, and a pendant runs the long way of the room.
 * A fan is sized for the room, with a blade pointing up the plan.
 */
export function newLight(kind: LightKind, r: SolvedRoom, anchor: Vec2, p: Vec2): Omit<Light, 'id'> {
  const wall = nearestWall(r, p)
  let angle = 0
  if (kind === 'eyeball' && wall) angle = angleOf(outward(wall.dir))
  if (kind === 'strip' && wall) angle = angleOf(wall.dir)
  if (kind === 'pendant') {
    const b = bbox(r.outline)
    angle = b.w >= b.h ? 0 : 90
  }
  if (kind === 'fan') angle = 270
  const length = kind === 'fan' ? fanSizeFor(r.area) : DEFAULT_LENGTH[kind]
  return {
    kind,
    roomId: r.room.id,
    ...offsetFrom(anchor, p),
    angle: normDeg(angle),
    length,
    size: kind === 'strip' ? DEFAULT_TUBE : null,
    watt: null,
    temp: null,
    model: '',
  }
}

type Specs = Pick<Light, 'size' | 'watt' | 'temp' | 'model'>

/** A light's size, power, colour and model, which new ones copy. */
export const specsOf = (l: Light): Specs => ({ size: l.size, watt: l.watt, temp: l.temp, model: l.model })

/** What a new light of this kind starts with: the size, power, colour and model of the last one placed. */
export function specsFrom(lights: Light[], kind: LightKind): Specs {
  const last = lights.filter((l) => l.kind === kind).at(-1)
  return last ? specsOf(last) : { size: kind === 'strip' ? DEFAULT_TUBE : null, watt: null, temp: null, model: '' }
}

/** Whether the light is a round fitting, with a size across it. */
export const isRound = (l: Pick<Light, 'kind' | 'length'>) =>
  l.kind === 'downlight' || l.kind === 'surface' || l.kind === 'eyeball' || (l.kind === 'pendant' && l.length <= 0)

/** A light's power in all: a run of LED tube's watts per tube, for each tube. */
export const lightWatts = (l: Light) => (l.watt == null ? 0 : l.kind === 'strip' ? l.watt * tubesFor(l) : l.watt)

/** "12W", "16.5W" */
export const formatWatts = (w: number) => `${Math.round(w * 10) / 10}W`

/** "12W", or "3×16W" for a run of three LED tubes; null when not set. */
export const wattLabel = (l: Pick<Light, 'kind' | 'watt' | 'length' | 'size'>) =>
  l.watt == null ? null : `${l.kind === 'strip' ? `${tubesFor(l)}×` : ''}${formatWatts(l.watt)}`

/** A fan's blade sweep in inches, as fans are sold: "46″". */
export const fanSizeLabel = (l: Pick<Light, 'length'>) => `${Math.round(l.length / 25.4)}″`

/** "3000K", or "3CCT" for tri-colour. */
export const tempLabel = (t: LightTemp) => (t === 'tri' ? '3CCT' : `${t}K`)

/** A light's stored position: p from the room's anchor, to the whole mm. */
export const offsetFrom = (anchor: Vec2, p: Vec2) => ({ x: Math.round(p.x - anchor.x), y: Math.round(p.y - anchor.y) })

/** Degrees between two directions, 0–180. */
const apart = (a: number, b: number) => Math.abs(normDeg(a - b + 180) - 180)

/**
 * A dragged angle, pulled along or square to one of the room's walls, or onto a multiple of 45°,
 * when within 5°; otherwise to the nearest degree.
 */
export function snapAngle(deg: number, r: SolvedRoom | null): number {
  const candidates = [0, 45, 90, 135, 180, 225, 270, 315]
  r?.room.edges.forEach((e, i) => {
    if (e.kind === 'wall') for (let q = 0; q < 4; q++) candidates.push(angleOf(r.dirs[i]) + q * 90)
  })
  let best = Math.round(deg)
  let gap = 5
  for (const c of candidates) {
    if (apart(deg, c) < gap) {
      gap = apart(deg, c)
      best = c
    }
  }
  return normDeg(best)
}

/**
 * From p straight out to the room's walls, along and square to its longest wall (the plan's
 * axes, for most rooms): where each of the four lines meets the outline, and how far that is.
 */
export function wallDistances(r: SolvedRoom, p: Vec2): { to: Vec2; dist: number }[] {
  let longest = -1
  r.room.edges.forEach((e, i) => {
    if (e.kind === 'wall' && (longest < 0 || dist(r.starts[i], r.ends[i]) > dist(r.starts[longest], r.ends[longest])))
      longest = i
  })
  const u = longest < 0 ? { x: 1, y: 0 } : r.dirs[longest]
  const v = outward(u)
  const out: { to: Vec2; dist: number }[] = []
  for (const d of [u, v, scale(u, -1), scale(v, -1)]) {
    let t = Infinity
    const pts = r.outline
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i]
      const e = sub(pts[(i + 1) % pts.length], a)
      const den = cross(d, e)
      if (Math.abs(den) < 1e-9) continue
      const ap = sub(a, p)
      const s = cross(ap, e) / den
      const w = cross(ap, d) / den
      if (s > 0 && w >= 0 && w <= 1) t = Math.min(t, s)
    }
    if (t < Infinity) out.push({ to: add(p, scale(d, t)), dist: t })
  }
  return out
}

/**
 * A dragged point pulled into line (across or down the plan) with any of the given points,
 * when within tol. Returns the lines it was pulled onto, for drawing guides.
 */
export function snapInLine(p: Vec2, targets: Vec2[], tol: number): { p: Vec2; x: number | null; y: number | null } {
  let x: number | null = null
  let y: number | null = null
  let dx = tol
  let dy = tol
  for (const t of targets) {
    if (Math.abs(t.x - p.x) < dx) {
      dx = Math.abs(t.x - p.x)
      x = t.x
    }
    if (Math.abs(t.y - p.y) < dy) {
      dy = Math.abs(t.y - p.y)
      y = t.y
    }
  }
  return { p: { x: x ?? p.x, y: y ?? p.y }, x, y }
}

export interface ScheduleRow {
  room: Room
  count: Record<LightKind, number>
  /** how many LED tubes light its runs */
  tubes: number
  /** watts in all, of the lights and fans with their power set */
  watts: number
  /** how many have no power set */
  unrated: number
}

/** Lights counted room by room (rooms with none are left out), in the rooms' order. */
export function lightSchedule(rooms: Room[], lights: Light[]): ScheduleRow[] {
  return rooms
    .map((room) => {
      const mine = lights.filter((l) => l.roomId === room.id)
      const count = Object.fromEntries(
        LIGHT_KINDS.map((k) => [k.value, mine.filter((l) => l.kind === k.value).length]),
      ) as Record<LightKind, number>
      const tubes = mine.filter((l) => l.kind === 'strip').reduce((sum, l) => sum + tubesFor(l), 0)
      const watts = mine.reduce((sum, l) => sum + lightWatts(l), 0)
      const unrated = mine.filter((l) => l.watt == null).length
      return { row: { room, count, tubes, watts, unrated }, any: mine.length > 0 }
    })
    .filter((r) => r.any)
    .map((r) => r.row)
}

export interface FixtureRow {
  kind: LightKind
  model: string
  /** a pendant or LED tube, sized by its length */
  linear: boolean
  /** mm: across a round fitting, a linear pendant's length, an LED tube's or a fan's blade sweep; null = not set */
  size: number | null
  /** watts each (each tube, for LED tube) */
  watt: number | null
  temp: LightTemp | null
  /** how many (runs, for LED tube) */
  count: number
  /** LED tube: the runs' total length, mm, and how many tubes light them */
  length: number
  tubes: number
  /** where they go, in the rooms' order */
  rooms: { room: Room; count: number }[]
  /** watts in all; 0 when their power isn't set */
  watts: number
}

/**
 * The lights and fans as a shopping list: alike ones (the same kind, model, size, power and colour)
 * on one row, with the rooms they go in. Rows follow the kinds' order, then model (unnamed last), then size.
 */
export function fixtureList(rooms: Room[], lights: Light[]): FixtureRow[] {
  const order = new Map(rooms.map((r, i) => [r.id, i]))
  const rows = new Map<string, FixtureRow>()
  for (const l of lights) {
    const room = rooms.find((r) => r.id === l.roomId)
    if (!room) continue
    const model = l.model.trim()
    const linear = l.kind === 'strip' || (l.kind === 'pendant' && l.length > 0)
    const size = l.kind === 'strip' ? (l.size ?? DEFAULT_TUBE) : isRound(l) ? l.size : l.length
    const key = JSON.stringify([l.kind, model.toLowerCase(), linear, size, l.watt, l.temp])
    let row = rows.get(key)
    if (!row) {
      row = {
        kind: l.kind,
        model,
        linear,
        size,
        watt: l.watt,
        temp: l.temp,
        count: 0,
        length: 0,
        tubes: 0,
        rooms: [],
        watts: 0,
      }
      rows.set(key, row)
    }
    row.count++
    if (l.kind === 'strip') {
      row.length += l.length
      row.tubes += tubesFor(l)
    }
    row.watts += lightWatts(l)
    const here = row.rooms.find((x) => x.room.id === room.id)
    if (here) here.count++
    else row.rooms.push({ room, count: 1 })
  }
  const kinds = LIGHT_KINDS.map((k) => k.value)
  const out = [...rows.values()]
  for (const r of out) r.rooms.sort((a, b) => order.get(a.room.id)! - order.get(b.room.id)!)
  return out.sort(
    (a, b) =>
      kinds.indexOf(a.kind) - kinds.indexOf(b.kind) ||
      Number(!a.model) - Number(!b.model) ||
      a.model.localeCompare(b.model) ||
      (a.size ?? 0) - (b.size ?? 0) ||
      (a.watt ?? 0) - (b.watt ?? 0),
  )
}
