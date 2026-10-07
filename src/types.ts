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
}
