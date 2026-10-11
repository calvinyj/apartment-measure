import type { Cabinet, CabinetKind, CabinetSection, Cutout, Finish, Worktop } from '../types'
import { across, cell, stack } from './sections'

/** Usual sizes for each kind, mm. A base cabinet's 100 + 760 with a 20 mm top makes an 880 mm counter. */
export const KIND_SIZES: Record<CabinetKind, Pick<Cabinet, 'height' | 'depth' | 'bottom' | 'mount'> & { top: boolean }> = {
  base: { height: 760, depth: 600, bottom: 100, mount: 'plinth', top: true },
  wall: { height: 700, depth: 350, bottom: 1500, mount: 'hung', top: false },
  tall: { height: 2100, depth: 600, bottom: 100, mount: 'plinth', top: false },
  wardrobe: { height: 2300, depth: 600, bottom: 100, mount: 'plinth', top: false },
  vanity: { height: 530, depth: 500, bottom: 300, mount: 'hung', top: true },
  other: { height: 600, depth: 400, bottom: 100, mount: 'plinth', top: false },
}

/** A cut-out's usual size: across × front to back. */
export const CUTOUT_SIZES: Record<Cutout['kind'], { width: number; depth: number }> = {
  sink: { width: 760, depth: 440 },
  hob: { width: 680, depth: 380 },
  basin: { width: 500, depth: 380 },
}

export const DEFAULT_CARCASS: Finish = { name: '', color: '#f3f1ec' }
export const DEFAULT_FRONTS: Finish = { name: '', color: '#d8c8b0' }
export const DEFAULT_STONE: Finish = { name: '', color: '#e9e7e2' }

export const newWorktop = (): Worktop => ({
  material: 'quartz',
  thickness: 20,
  overhang: 20,
  upstand: 0,
  finish: { ...DEFAULT_STONE },
  cutouts: [],
})

/** A cut-out for a template to place, centred `x` along its leg's front. */
type TemplateCutout = Omit<Cutout, 'id'>

export interface CabinetTemplate {
  id: string
  kind: CabinetKind
  name: string
  hint: string
  /** sizes other than the kind's usual ones */
  size?: Partial<(typeof KIND_SIZES)[CabinetKind]>
  /** fronts for legs this wide, with any cut-outs */
  build: (widths: number[]) => { legs: CabinetSection[]; cutouts?: TemplateCutout[] }
}

/** n equal parts, each about `target` wide (at least one), made for the width each gets. */
function evenParts(width: number, target: number, make: (w: number) => CabinetSection): [null, CabinetSection][] {
  const n = Math.max(1, Math.round(width / target))
  return Array.from({ length: n }, () => [null, make(width / n)])
}

/** Equal compartments, each about `target` wide. */
function evenly(width: number, target: number, make: (w: number) => CabinetSection): CabinetSection {
  const parts = evenParts(width, target, make)
  return parts.length === 1 ? parts[0][1] : across(...parts)
}

/** Doors for a compartment about this wide: a pair, or one if it's narrow. */
const doors = (w: number, patch: Parameters<typeof cell>[1] = {}) => cell('door', { hinge: w >= 500 ? 'pair' : 'left', ...patch })

const each = (widths: number[], f: (w: number, k: number) => CabinetSection) => widths.map(f)

const cutout = (kind: Cutout['kind'], leg: number, x: number): TemplateCutout => ({
  kind,
  leg,
  x,
  ...CUTOUT_SIZES[kind],
  mount: kind === 'hob' ? 'top' : 'under',
})

const pantry = (w: number) => doors(w, { shelves: 5 })

const SINK_W = 900
const DRAWER_W = 450
const HOB_W = 900

/** A sink compartment with drawers to its left and doors after, as wide as fits. */
function sinkRun(w: number): { front: CabinetSection; sinkAt: number } {
  const sink = doors(SINK_W, { shelves: 0 })
  if (w < SINK_W + DRAWER_W + 300) return { front: sink, sinkAt: w / 2 }
  const rest = w - SINK_W - DRAWER_W
  return {
    front: across([DRAWER_W, cell('drawers')], [SINK_W, sink], ...evenParts(rest, 900, (w) => doors(w))),
    sinkAt: DRAWER_W + SINK_W / 2,
  }
}

/** Drawers and a sink at the left, doors, and drawers under a hob at the right; just the sink if there's no room. */
function kitchenRun(w: number): { front: CabinetSection; cutouts: TemplateCutout[] } {
  if (w < SINK_W + DRAWER_W + HOB_W + 300) {
    const s = sinkRun(w)
    return { front: s.front, cutouts: [cutout('sink', 0, s.sinkAt)] }
  }
  return {
    front: across(
      [DRAWER_W, cell('drawers')],
      [SINK_W, doors(SINK_W, { shelves: 0 })],
      ...evenParts(w - SINK_W - DRAWER_W - HOB_W, 900, (x) => doors(x)),
      [HOB_W, cell('drawers')],
    ),
    cutouts: [cutout('sink', 0, DRAWER_W + SINK_W / 2), cutout('hob', 0, w - HOB_W / 2)],
  }
}

/** Doors, then a stack of drawers for the hob at the right end. */
function hobRun(w: number): { front: CabinetSection; hobAt: number } {
  if (w < HOB_W + 400) return { front: cell('drawers'), hobAt: w / 2 }
  return {
    front: across(...evenParts(w - HOB_W, 900, (w) => doors(w)), [HOB_W, cell('drawers')]),
    hobAt: w - HOB_W / 2,
  }
}

const blank = (kind: CabinetKind): CabinetTemplate => ({
  id: `${kind}-blank`,
  kind,
  name: 'Blank',
  hint: 'One compartment with doors on each wall, to divide up yourself',
  build: (ws) => ({ legs: each(ws, (w) => doors(w)) }),
})

export const TEMPLATES: CabinetTemplate[] = [
  {
    id: 'base-kitchen',
    kind: 'base',
    name: 'Sink & hob',
    hint: 'Drawers and a sink at the left; doors; drawers under a hob at the right (on the last wall of an L or U, if it fits there)',
    build: (ws) => {
      const last = ws.length - 1
      if (ws.length === 1 || ws[last] < HOB_W + 400) {
        const k = kitchenRun(ws[0])
        return { legs: ws.map((w, i) => (i === 0 ? k.front : evenly(w, 900, (x) => doors(x)))), cutouts: k.cutouts }
      }
      const s = sinkRun(ws[0])
      const h = hobRun(ws[last])
      return {
        legs: ws.map((w, k) => (k === 0 ? s.front : k === last ? h.front : evenly(w, 900, (x) => doors(x)))),
        cutouts: [cutout('sink', 0, s.sinkAt), cutout('hob', last, h.hobAt)],
      }
    },
  },
  {
    id: 'base-sink',
    kind: 'base',
    name: 'Sink & doors',
    hint: 'Drawers and a sink compartment, then doors',
    build: (ws) => {
      const s = sinkRun(ws[0])
      return {
        legs: ws.map((w, k) => (k === 0 ? s.front : evenly(w, 900, (w) => doors(w)))),
        cutouts: [cutout('sink', 0, s.sinkAt)],
      }
    },
  },
  {
    id: 'base-doors',
    kind: 'base',
    name: 'Doors',
    hint: 'Pairs of doors about 900 mm wide, a shelf inside each',
    build: (ws) => ({ legs: each(ws, (w) => evenly(w, 900, (w) => doors(w))) }),
  },
  {
    id: 'base-drawers',
    kind: 'base',
    name: 'Drawers',
    hint: 'Stacks of 3 drawers about 800 mm wide',
    build: (ws) => ({ legs: each(ws, (w) => evenly(w, 800, () => cell('drawers'))) }),
  },
  blank('base'),

  {
    id: 'wall-doors',
    kind: 'wall',
    name: 'Doors',
    hint: 'Pairs of doors about 800 mm wide, a shelf inside each',
    build: (ws) => ({ legs: each(ws, (w) => evenly(w, 800, (w) => doors(w))) }),
  },
  {
    id: 'wall-lift',
    kind: 'wall',
    name: 'Lift-up doors',
    hint: 'Doors that lift up, about 900 mm wide',
    build: (ws) => ({ legs: each(ws, (w) => evenly(w, 900, () => cell('door', { hinge: 'lift' }))) }),
  },
  {
    id: 'wall-hood',
    kind: 'wall',
    name: 'Doors & hood',
    hint: 'A gap for the cooker hood in the middle (of the last wall), doors either side',
    size: { height: 700 },
    build: (ws) => {
      const last = ws.length - 1
      return {
        legs: ws.map((w, k) => {
          if (k !== last) return evenly(w, 800, (w) => doors(w))
          if (w < 1500) return cell('appliance', { appliance: 'hood' })
          return across([null, doors((w - 900) / 2)], [900, cell('appliance', { appliance: 'hood' })], [null, doors((w - 900) / 2)])
        }),
      }
    },
  },
  blank('wall'),

  {
    id: 'tall-pantry',
    kind: 'tall',
    name: 'Pantry',
    hint: 'Pairs of tall doors about 600 mm wide, 5 shelves inside',
    build: (ws) => ({ legs: each(ws, (w) => evenly(w, 600, pantry)) }),
  },
  {
    id: 'tall-oven',
    kind: 'tall',
    name: 'Oven tower',
    hint: 'Oven and microwave at the left with drawers under and doors over; pantry after',
    build: (ws) => ({
      legs: ws.map((w, k) => {
        const tower = stack(
          [null, doors(600, { shelves: 1 })],
          [400, cell('appliance', { appliance: 'microwave' })],
          [600, cell('appliance', { appliance: 'oven' })],
          [500, cell('drawers', { drawers: 2 })],
        )
        if (k > 0) return evenly(w, 600, pantry)
        if (w < 1000) return tower
        return across([600, tower], ...evenParts(w - 600, 600, pantry))
      }),
    }),
  },
  {
    id: 'tall-fridge',
    kind: 'tall',
    name: 'Fridge housing',
    hint: 'A space for the fridge at the left with doors over it; pantry after',
    build: (ws) => ({
      legs: ws.map((w, k) => {
        const housing = stack([400, doors(900, { shelves: 0 })], [null, cell('appliance', { appliance: 'fridge' })])
        if (k > 0) return evenly(w, 600, pantry)
        if (w < 1400) return housing
        return across([900, housing], ...evenParts(w - 900, 600, pantry))
      }),
    }),
  },
  blank('tall'),

  {
    id: 'wardrobe-hanging',
    kind: 'wardrobe',
    name: 'Hanging & shelves',
    hint: 'Pairs of doors about 900 mm wide; hanging space and shelves in turn',
    build: (ws) => {
      let i = 0
      return { legs: each(ws, (w) => evenly(w, 900, (x) => (i++ % 2 === 0 ? doors(x, { shelves: 1, rail: true }) : doors(x, { shelves: 5 })))) }
    },
  },
  {
    id: 'wardrobe-drawers',
    kind: 'wardrobe',
    name: 'Hanging, shelves & drawers',
    hint: 'Hanging space and, in turn, shelves over 3 drawers',
    build: (ws) => {
      let i = 0
      return {
        legs: each(ws, (w) =>
          evenly(w, 900, (x) => (i++ % 2 === 0 ? doors(x, { shelves: 1, rail: true }) : stack([null, doors(x, { shelves: 3 })], [600, cell('drawers')]))),
        ),
      }
    },
  },
  {
    id: 'wardrobe-sliding',
    kind: 'wardrobe',
    name: 'Sliding doors',
    hint: 'Sliding doors about 1200 mm wide; hanging space and shelves in turn',
    build: (ws) => {
      let i = 0
      return {
        legs: each(ws, (w) =>
          evenly(w, 1200, () =>
            i++ % 2 === 0 ? cell('door', { hinge: 'sliding', shelves: 1, rail: true }) : cell('door', { hinge: 'sliding', shelves: 5 }),
          ),
        ),
      }
    },
  },
  blank('wardrobe'),

  {
    id: 'vanity-doors',
    kind: 'vanity',
    name: 'Basin & doors',
    hint: 'Doors under a basin in the middle',
    build: (ws) => ({ legs: each(ws, (w) => doors(w, { shelves: 0 })), cutouts: [cutout('basin', 0, ws[0] / 2)] }),
  },
  {
    id: 'vanity-drawers',
    kind: 'vanity',
    name: 'Basin & drawers',
    hint: '2 drawers under a basin in the middle',
    build: (ws) => ({ legs: each(ws, () => cell('drawers', { drawers: 2 })), cutouts: [cutout('basin', 0, ws[0] / 2)] }),
  },
  {
    id: 'vanity-double',
    kind: 'vanity',
    name: 'Two basins',
    hint: 'Two halves with doors, a basin over each',
    build: (ws) => ({
      legs: each(ws, (w, k) => (k === 0 ? across([null, doors(w / 2, { shelves: 0 })], [null, doors(w / 2, { shelves: 0 })]) : doors(w))),
      cutouts: [cutout('basin', 0, ws[0] / 4), cutout('basin', 0, (ws[0] * 3) / 4)],
    }),
  },
  blank('vanity'),

  {
    id: 'other-tv',
    kind: 'other',
    name: 'TV console',
    hint: 'Low, on legs: open shelves either side of 2 drawers',
    size: { height: 450, depth: 450, bottom: 150, mount: 'legs' },
    build: (ws) => ({
      legs: each(ws, (w) =>
        w < 1200 ? cell('drawers', { drawers: 2 }) : across([null, cell('open')], [null, cell('drawers', { drawers: 2 })], [null, cell('open')]),
      ),
    }),
  },
  {
    id: 'other-shoe',
    kind: 'other',
    name: 'Shoe cabinet',
    hint: 'Pairs of doors about 800 mm wide, 5 shelves inside',
    size: { height: 1000, depth: 350 },
    build: (ws) => ({ legs: each(ws, (w) => evenly(w, 800, (x) => doors(x, { shelves: 5 }))) }),
  },
  {
    id: 'other-shelves',
    kind: 'other',
    name: 'Open shelves',
    hint: 'Open compartments about 800 mm wide, 3 shelves each',
    size: { height: 1800, depth: 350 },
    build: (ws) => ({ legs: each(ws, (w) => evenly(w, 800, () => cell('open', { shelves: 3 }))) }),
  },
  blank('other'),
]

export const templateById = (id: string) => TEMPLATES.find((t) => t.id === id) ?? null
export const templatesFor = (kind: CabinetKind) => TEMPLATES.filter((t) => t.kind === kind)
export const defaultTemplate = (kind: CabinetKind) => templatesFor(kind)[0]

/** A template's sizes: the kind's usual ones with its own on top. */
export const templateSize = (t: CabinetTemplate) => ({ ...KIND_SIZES[t.kind], ...t.size })
