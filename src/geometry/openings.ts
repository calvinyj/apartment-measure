import type { Opening, OpeningKind, Room } from '../types'
import { edgeFacing, outdoorEdges, type CompassPoint } from './facing'
import type { Solved } from './solve'

export const OPENING_LABELS: Record<OpeningKind, string> = { door: 'Door', window: 'Window', opening: 'Opening' }

/** A door, window or opening in the list on the report. */
export interface OpeningRow {
  opening: Opening
  room: Room
  /** the wall it's on, numbered as on the Measure tab (a straight wall split in parts is one wall) */
  wallNo: number
  /** mm from the wall's corner A to its near side, along the whole wall */
  from: number
  /** the room on the other side of the wall; null = outside the apartment */
  beyond: Room | null
  /** the way it looks out, when it's on an outdoor side and north is set */
  faces: CompassPoint | null
}

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0)

/**
 * Every door, window and opening, room by room in the rooms' order, then wall by wall, and along each wall
 * from corner A. One left on a wall that's since been made open (no wall) is left out, as from the wall areas.
 */
export function openingList(solved: Solved): OpeningRow[] {
  return solved.rooms.flatMap((r) => {
    const outdoor = outdoorEdges(solved, r)
    return r.groups.flatMap((group, g) => {
      // Where each part starts along the wall; an opening is entered from the start of its part.
      const lengths = group.map((i) => r.closure.lengths[i])
      const starts = group.map((_, j) => sum(lengths.slice(0, j)))
      // The rooms beyond each part of the wall, along the whole wall (scaled from the plan to the measured length).
      const beyond = group.flatMap((i, j) => {
        const k = r.estimates[i] > 0 ? lengths[j] / r.estimates[i] : 1
        return r.edgeInfo[i].neighbors.map((nb) => ({ roomId: nb.roomId, lo: starts[j] + nb.from * k, hi: starts[j] + nb.to * k }))
      })
      const rows = group.flatMap((i, j) => {
        if (r.room.edges[i].kind !== 'wall') return []
        return r.room.edges[i].openings.map((o): OpeningRow => {
          const from = starts[j] + o.offset
          const mid = from + o.width / 2
          // The part its middle is on, for whether that side is internal or looks outdoors.
          const part = group[Math.max(0, starts.filter((s) => s <= mid).length - 1)]
          const gap = (b: { lo: number; hi: number }) => Math.max(b.lo - mid, mid - b.hi, 0)
          const near = beyond.reduce<(typeof beyond)[number] | null>((best, b) => (!best || gap(b) < gap(best) ? b : best), null)
          // Beside the room next door, or on an internal wall where the plan's overlap misses it by a little.
          const next = near && (gap(near) <= o.width / 2 || r.edgeInfo[part].side === 'internal') ? near : null
          return {
            opening: o,
            room: r.room,
            wallNo: g + 1,
            from,
            beyond: next ? (solved.byId.get(next.roomId)?.room ?? null) : null,
            faces: solved.north != null && outdoor.includes(part) ? edgeFacing(r, part, solved.north) : null,
          }
        })
      })
      return rows.sort((a, b) => a.from - b.from)
    })
  })
}
