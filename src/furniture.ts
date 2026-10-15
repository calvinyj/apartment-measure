import { ORDER_STATUSES, type FurnitureItem, type LengthUnit, type OrderStatus, type Room, type Vec2 } from './types'
import { formatLengthValue } from './units'

/** Usual furniture and appliances, offered as you type a name (after the ones already used). */
export const FURNITURE_NAMES = [
  'Sofa',
  'Coffee table',
  'TV',
  'TV console',
  'Dining table',
  'Dining chairs',
  'Bed',
  'Mattress',
  'Bedside table',
  'Dressing table',
  'Desk',
  'Office chair',
  'Bookshelf',
  'Shoe rack',
  'Fridge',
  'Washing machine',
  'Dryer',
  'Microwave',
  'Rice cooker',
  'Water filter',
  'Air purifier',
  'Dehumidifier',
  'Robot vacuum',
]

/** Where an item is on the measured layout, in mm; null once its room is gone. */
export function furnitureSpot(anchors: Map<string, Vec2>, f: Pick<FurnitureItem, 'roomId' | 'x' | 'y'>): Vec2 | null {
  const a = anchors.get(f.roomId)
  return a ? { x: a.x + f.x, y: a.y + f.y } : null
}

/** Items at the same spot share it: one mark on the plan, and one line to their cards. */
export const spotKey = (f: Pick<FurnitureItem, 'roomId' | 'x' | 'y'>) => `${f.roomId}:${f.x}:${f.y}`

export interface FurnitureSpot {
  key: string
  /** in mm on the measured layout */
  at: Vec2
  items: FurnitureItem[]
}

/** The spots items are at, each with the items there in the order they were placed; ones whose room is gone are left out. */
export function furnitureSpots(anchors: Map<string, Vec2>, items: FurnitureItem[]): FurnitureSpot[] {
  const spots = new Map<string, FurnitureSpot>()
  for (const f of items) {
    const at = furnitureSpot(anchors, f)
    if (!at) continue
    const key = spotKey(f)
    const spot = spots.get(key)
    if (spot) spot.items.push(f)
    else spots.set(key, { key, at, items: [f] })
  }
  return [...spots.values()]
}

/** Its size in the length unit, e.g. "2,040 × 990 × 830 mm", or "W 2,040 × H 830 mm" with some not set; '' with none. */
export function sizeLabel(f: Pick<FurnitureItem, 'width' | 'depth' | 'height'>, unit: LengthUnit): string {
  const dims = [
    ['W', f.width],
    ['D', f.depth],
    ['H', f.height],
  ] as const
  const set = dims.filter(([, v]) => v != null)
  if (!set.length) return ''
  const all = set.length === dims.length
  return `${set.map(([k, v]) => `${all ? '' : `${k} `}${formatLengthValue(v!, unit)}`).join(' × ')} ${unit}`
}

/** A price in ringgit, e.g. "RM 1,299" or "RM 89.90". */
export function formatPrice(rm: number): string {
  const cents = Math.round(rm * 100) % 100 !== 0
  return `RM ${rm.toLocaleString(undefined, { minimumFractionDigits: cents ? 2 : 0, maximumFractionDigits: 2 })}`
}

/** The web address to open, adding https:// to one typed without it; null for one that isn't a web address. */
export function itemHref(url: string): string | null {
  const t = url.trim()
  if (!t) return null
  try {
    const u = new URL(/^[a-z][a-z\d+.-]*:/i.test(t) ? t : `https://${t}`)
    return (u.protocol === 'https:' || u.protocol === 'http:') && u.hostname.includes('.') ? u.href : null
  } catch {
    return null
  }
}

/** A link's site, to show it short, e.g. "ikea.com"; '' for one that isn't a web address. */
export function linkSite(url: string): string {
  const href = itemHref(url)
  return href ? new URL(href).hostname.replace(/^www\./, '') : ''
}

/** Items room by room as the rooms are listed, each room's in the order they were placed; ones whose room is gone are left out. */
export function furnitureList(rooms: Room[], items: FurnitureItem[]): { item: FurnitureItem; room: Room }[] {
  return rooms.flatMap((room) => items.filter((f) => f.roomId === room.id).map((item) => ({ item, room })))
}

export interface StatusTally {
  status: OrderStatus
  count: number
  /** RM, of those with a price */
  price: number
  /** how many have no price set */
  unpriced: number
}

/** How many items are pending, ordered and delivered, and what they come to; only statuses some item has. */
export function statusTotals(items: FurnitureItem[]): StatusTally[] {
  return ORDER_STATUSES.flatMap(({ value: status }) => {
    const these = items.filter((f) => f.status === status)
    if (!these.length) return []
    return [
      {
        status,
        count: these.length,
        price: these.reduce((sum, f) => sum + (f.price ?? 0), 0),
        unpriced: these.filter((f) => f.price == null).length,
      },
    ]
  })
}
