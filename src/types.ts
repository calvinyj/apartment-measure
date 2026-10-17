export interface Vec2 {
  x: number
  y: number
}

export type RoomType =
  | 'living'
  | 'dining'
  | 'bedroom'
  | 'kitchen'
  | 'bathroom'
  | 'study'
  | 'utility'
  | 'corridor'
  | 'balcony'
  | 'other'

export const ROOM_TYPES: { value: RoomType; label: string; color: string; outdoor?: boolean; ac: boolean }[] = [
  { value: 'living', label: 'Living', color: '#7aa6d6', ac: true },
  { value: 'dining', label: 'Dining', color: '#8fb8de', ac: true },
  { value: 'bedroom', label: 'Bedroom', color: '#9ccf8f', ac: true },
  { value: 'study', label: 'Study', color: '#c5b3e6', ac: true },
  { value: 'kitchen', label: 'Kitchen', color: '#f2c36b', ac: false },
  { value: 'bathroom', label: 'Bathroom', color: '#8fd3d1', ac: false },
  { value: 'utility', label: 'Utility / Yard', color: '#d6b38f', ac: false },
  { value: 'corridor', label: 'Corridor / Foyer', color: '#c9c9c9', ac: false },
  { value: 'balcony', label: 'Balcony', color: '#e8a3a3', outdoor: true, ac: false },
  { value: 'other', label: 'Other', color: '#b8b8b8', ac: false },
]

export function roomTypeInfo(t: RoomType) {
  return ROOM_TYPES.find((r) => r.value === t) ?? ROOM_TYPES[ROOM_TYPES.length - 1]
}

export type OpeningKind = 'door' | 'window' | 'opening'

export interface Opening {
  id: string
  kind: OpeningKind
  /** mm from the wall's start corner (inner face) to the near side of the opening */
  offset: number
  width: number
  height: number
  /** mm from floor to the bottom of the opening (0 for doors) */
  sill: number
}

/** Which side of the wall is outside the apartment; drives thickness defaults and gross area. */
export type WallSide = 'auto' | 'internal' | 'external'

export interface Edge {
  id: string
  /** 'open' = boundary with no physical wall (e.g. living ↔ dining) */
  kind: 'wall' | 'open'
  /** measured inner-face length in mm; null = not measured */
  measured: number | null
  /** wall thickness override in mm; null = use default */
  thickness: number | null
  side: WallSide
  /** false = beyond this outside wall is the next unit, a lobby or a corridor, not open air (so no sun) */
  openAir?: boolean
  /** paint colour of this room's face of the wall, as a hex code; missing/null = the layout's wall paint */
  paint?: string | null
  openings: Opening[]
}

export interface Room {
  id: string
  name: string
  type: RoomType
  /** traced inner-face outline, in plan image pixels; positive signed area (clockwise on screen) */
  points: Vec2[]
  /** edges[i] runs from points[i] to points[i + 1] */
  edges: Edge[]
  /** measured floor-to-ceiling in mm; null = use default */
  height: number | null
  /** rooms sharing a zone name are cooled as one space */
  acZone: string
  /** override whether this room needs aircon; null = by room type */
  ac: boolean | null
  /** HP of a unit already installed in this room (e.g. 1.5); missing/null = none, so one is suggested */
  acInstalled?: number | null
  /** gets strong afternoon sun (adds aircon margin); null = work it out from which way the room faces */
  sunny: boolean | null
}

export type LightKind = 'downlight' | 'surface' | 'eyeball' | 'pendant' | 'strip' | 'fan'

export const LIGHT_KINDS: { value: LightKind; label: string; plural: string; linear?: boolean }[] = [
  { value: 'downlight', label: 'Downlight', plural: 'downlights' },
  { value: 'surface', label: 'Surface light', plural: 'surface lights' },
  { value: 'eyeball', label: 'Eyeball', plural: 'eyeballs' },
  { value: 'pendant', label: 'Pendant', plural: 'pendants', linear: true },
  // A run of LED tubes; saved layouts know it as 'strip'.
  { value: 'strip', label: 'LED tube', plural: 'LED tubes', linear: true },
  { value: 'fan', label: 'Fan', plural: 'fans' },
]

/**
 * Colour temperature in kelvin, 'tri' for a light that switches between three, or 'rgb' for a
 * full-colour one (RGB).
 */
export type LightTemp = number | 'tri' | 'rgb'

export const LIGHT_TEMPS: { value: LightTemp; label: string }[] = [
  { value: 2700, label: '2700K · warm' },
  { value: 3000, label: '3000K · warm white' },
  { value: 4000, label: '4000K · cool white' },
  { value: 6500, label: '6500K · daylight' },
  { value: 'tri', label: 'Tri-colour (3CCT)' },
  { value: 'rgb', label: 'RGB full colour' },
]

export const lightKindInfo = (k: LightKind) => LIGHT_KINDS.find((l) => l.value === k) ?? LIGHT_KINDS[0]

/** A light or ceiling fan on the lighting & fan plan. */
export interface Light {
  id: string
  kind: LightKind
  /** the room it's in; it keeps its place in the room as measurements change the room's size */
  roomId: string
  /** centre, in mm from the centre of the room's measured outline */
  x: number
  y: number
  /** degrees clockwise from plan right: where an eyeball aims, or which way a pendant or LED tube runs */
  angle: number
  /** mm: a pendant's or strip's length (a pendant of 0 is a round one), or a fan's blade sweep */
  length: number
  /** mm across a round fitting: a downlight's or eyeball's cut-out, a surface light, a round pendant; null = unset.
   * For a run of LED tube, the length of each tube. */
  size: number | null
  /** watts; for a run of LED tube, watts per tube; null = not set */
  watt: number | null
  /** colour temperature; for a fan, of its light (null = it has none) */
  temp: LightTemp | null
  /** brand and model, for the report; '' = not set */
  model: string
}

/** A plug point (power socket outlet) on a wall, already there or one to add. */
export interface PlugPoint {
  id: string
  /** the room whose wall it's on */
  roomId: string
  /** in mm from the centre of the room's measured outline; it's drawn on the room's wall nearest this */
  x: number
  y: number
  /** sockets at this point, e.g. 2 for a twin socket */
  count: number
  /** already there, rather than one to add */
  existing: boolean
  /** what it's for, e.g. "TV"; '' = not set */
  note: string
}

export type CabinetKind = 'base' | 'wall' | 'tall' | 'wardrobe' | 'vanity' | 'other'

export const CABINET_KINDS: { value: CabinetKind; label: string; hint: string }[] = [
  { value: 'base', label: 'Base cabinet', hint: 'On the floor under a counter, usually with a stone top' },
  { value: 'wall', label: 'Wall cabinet', hint: 'Hung on the wall, e.g. above the counter' },
  { value: 'tall', label: 'Tall cabinet', hint: 'Floor to near the ceiling: pantry, oven tower, fridge housing' },
  { value: 'wardrobe', label: 'Wardrobe', hint: 'Hanging space, shelves and drawers' },
  { value: 'vanity', label: 'Vanity', hint: 'Bathroom cabinet under a basin' },
  { value: 'other', label: 'Other', hint: 'TV console, shoe cabinet, shelving' },
]

export const cabinetKindInfo = (k: CabinetKind) => CABINET_KINDS.find((c) => c.value === k) ?? CABINET_KINDS[0]

/** What's on a compartment's front. */
export type CabinetFront = 'door' | 'drawers' | 'open' | 'appliance' | 'panel'
export type DoorHinge = 'left' | 'right' | 'pair' | 'lift' | 'sliding'
export type ApplianceKind = 'oven' | 'microwave' | 'dishwasher' | 'fridge' | 'washer' | 'hood' | 'other'

/**
 * A compartment. Settings for fronts it doesn't have are kept, so switching from doors to
 * drawers and back loses nothing.
 */
export interface CabinetCell {
  front: CabinetFront
  /** how its doors open (door fronts) */
  hinge: DoorHinge
  /**
   * A panel that doesn't open, on this side of hinged doors: for where there's only room for one side
   * to open. Unset = none.
   */
  fixed?: 'left' | 'right'
  /** the fixed panel's width, mm; unset = half the compartment */
  fixedWidth?: number | null
  /** drawers, stacked evenly (drawer fronts) */
  drawers: number
  /** adjustable shelves inside (doors or open) */
  shelves: number
  /** a hanging rail inside (doors or open) */
  rail: boolean
  /** what fills the gap (appliance) */
  appliance: ApplianceKind
}

/** Compartments side by side ('across', left to right) or one above another ('stack', top to bottom). */
export interface CabinetSplit {
  split: 'across' | 'stack'
  /** mm across (or high) each part is, to the middle of the divider either side; null = an equal share of what's left */
  parts: { size: number | null; section: CabinetSection }[]
}

export type CabinetSection = CabinetCell | CabinetSplit

export interface Finish {
  /** what it is, e.g. a laminate's name or code; '' = not set */
  name: string
  color: string
}

export type StoneMaterial = 'quartz' | 'granite' | 'marble' | 'sintered' | 'solid-surface' | 'laminate'

export const STONE_MATERIALS: { value: StoneMaterial; label: string }[] = [
  { value: 'quartz', label: 'Quartz' },
  { value: 'granite', label: 'Granite' },
  { value: 'marble', label: 'Marble' },
  { value: 'sintered', label: 'Sintered stone' },
  { value: 'solid-surface', label: 'Solid surface' },
  { value: 'laminate', label: 'Laminate' },
]

export type CutoutKind = 'sink' | 'hob' | 'basin'

/** A hole in the top for a sink, hob or basin. */
export interface Cutout {
  id: string
  kind: CutoutKind
  /** which leg of the cabinet (which of its walls) it's on */
  leg: number
  /** its centre, mm from the left end of that leg's front */
  x: number
  /** the cut-out's size, from the sink's or hob's spec sheet: across, and front to back */
  width: number
  depth: number
  /** sink under the stone, or dropped in from the top */
  mount: 'under' | 'top'
}

export interface Worktop {
  material: StoneMaterial
  thickness: number
  /** how far it reaches past the fronts */
  overhang: number
  /** height of the stone up the wall behind it; 0 = none */
  upstand: number
  finish: Finish
  cutouts: Cutout[]
}

/** Where a cabinet stands: along one wall of a room, or round its inside corners onto the next one or two (an L or a U). */
export interface CabinetWalls {
  roomId: string
  /**
   * The walls it runs along, left to right as you face them from inside the room: one for a straight
   * cabinet, two for an L, three for a U. Each is the id of an edge of that wall (a straight wall split in
   * parts on the plan is one wall).
   */
  edgeIds: string[]
  /** mm from the first wall's left corner to the cabinet's left end */
  start: number
  /** mm it runs along its last wall, from `start` (straight) or from the corner (L or U); null = to that wall's right corner */
  length: number | null
}

export type HandleStyle = 'none' | 'profile' | 'bar' | 'knob'

/** On the floor with a kick board underneath, on legs, or hung on the wall. */
export type CabinetMount = 'plinth' | 'legs' | 'hung'

/** A built-in cabinet: its place on the walls, its size, its compartments, top and finishes. */
export interface Cabinet {
  id: string
  name: string
  kind: CabinetKind
  /** the template it started from; a leg it gains by turning another corner is filled from it */
  template: string
  walls: CabinetWalls
  /** the front along each of its walls, left to right */
  legs: CabinetSection[]
  /** of the carcass, without the plinth or top, mm */
  height: number
  depth: number
  /** mm from the floor to the underside of the carcass: the plinth, legs, or how high it hangs */
  bottom: number
  mount: CabinetMount
  /** thickness of the carcass board, mm */
  board: number
  handle: HandleStyle
  carcass: Finish
  fronts: Finish
  /** stone (or other) top; null = none */
  top: Worktop | null
}

/** Where a piece of furniture or an appliance is in getting it: still to order, ordered, or delivered. */
export type OrderStatus = 'pending' | 'ordered' | 'delivered'

export const ORDER_STATUSES: { value: OrderStatus; label: string }[] = [
  { value: 'pending', label: 'Pending' },
  { value: 'ordered', label: 'Ordered' },
  { value: 'delivered', label: 'Delivered' },
]

/** A piece of loose furniture or an appliance (not built in), at a spot on the plan. */
export interface FurnitureItem {
  id: string
  /** the room it goes in; it keeps its place in the room as measurements change the room's size */
  roomId: string
  /** where it goes, in mm from the centre of the room's measured outline */
  x: number
  y: number
  name: string
  /** brand and model; '' = not set */
  model: string
  /** where to see or buy it; '' = not set */
  url: string
  /** its size, mm: across, front to back and high; null = not set */
  width: number | null
  depth: number | null
  height: number | null
  /** a reference price, RM; null = not set */
  price: number | null
  status: OrderStatus
}

export interface Calibration {
  a: Vec2
  b: Vec2
  mm: number
}

export type LengthUnit = 'mm' | 'cm' | 'm'

/** Where the outer walls were traced; shared walls are worked out from the gap between rooms. */
export type TraceMode = 'auto' | 'inside' | 'centre' | 'outside'

export interface Settings {
  inputUnit: LengthUnit
  traceMode: TraceMode
  defaultHeight: number
  internalThickness: number
  externalThickness: number
  /** fraction of external wall thickness counted in gross area (developers differ) */
  externalShare: number
  /** acceptable closure error per room, mm */
  closureTolerance: number
  acBtuPerSqft: number
  acRefHeight: number
  acSunnyFactor: number
  /** how far (fraction) the need can exceed an installed unit's BTU and still count as enough */
  acShortfall: number
  /** paint colour of the inside faces of walls, as a hex code; single walls can override it */
  wallPaint: string
  /** draw the plan image under the rooms (in Plan, Measure, 2D and 3D); untick it once an inaccurate plan only gets in the way */
  showPlanImage: boolean
}

export const DEFAULT_SETTINGS: Settings = {
  inputUnit: 'mm',
  traceMode: 'auto',
  defaultHeight: 2700,
  internalThickness: 150,
  externalThickness: 200,
  externalShare: 1,
  closureTolerance: 25,
  acBtuPerSqft: 60,
  acRefHeight: 2700,
  acSunnyFactor: 1.1,
  acShortfall: 0.1,
  wallPaint: '#f1eee8',
  showPlanImage: true,
}

export interface PlanImage {
  /** server URL for stored layouts; a data: URL inside exported files */
  src: string
  width: number
  height: number
}

export interface Project {
  version: 3
  name: string
  image: PlanImage | null
  calibration: Calibration | null
  rooms: Room[]
  settings: Settings
  advertised: { value: number; unit: 'sqft' | 'm2' } | null
  /** where north points on the plan, in degrees clockwise from the top of the image; null = not set */
  north: number | null
  lights: Light[]
  plugs: PlugPoint[]
  cabinets: Cabinet[]
  furniture: FurnitureItem[]
}
