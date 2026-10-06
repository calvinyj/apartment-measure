import { isSunny } from './geometry/facing'
import type { Solved, SolvedRoom } from './geometry/solve'
import { roomTypeInfo, type Room, type Settings } from './types'
import { M2_TO_SQFT } from './units'

/** Common residential split-unit sizes in Malaysia (HP is the retail label). */
export const AC_SIZES = [
  { hp: 1, btu: 9000 },
  { hp: 1.5, btu: 12000 },
  { hp: 2, btu: 18000 },
  { hp: 2.5, btu: 24000 },
]

export const hpLabel = (hp: number) => `${hp.toFixed(1)} HP`

export interface AcZone {
  name: string
  rooms: SolvedRoom[]
  /** mm² */
  area: number
  /** mm³ */
  volume: number
  btu: number
  /** gets the sun margin */
  sunny: boolean
  /** suggested units for the whole zone, ignoring anything installed */
  units: { hp: number; btu: number; count: number }
  /** units already in the zone's rooms; empty = nothing installed */
  installed: { hp: number; btu: number; room: string }[]
  installedBtu: number
  /** the installed units cover the need (within the allowed shortfall); null = nothing installed */
  enough: boolean | null
}

const hasInstalled = (room: Room) => room.acInstalled != null

/** Explicit choice wins; an installed unit or a named zone implies the room is cooled. */
export const needsAc = (r: SolvedRoom) =>
  r.room.ac ?? (hasInstalled(r.room) || r.room.acZone.trim() !== '' || roomTypeInfo(r.room.type).ac)

/**
 * Rule of thumb: area (ft²) × BTU/ft², scaled by ceiling height against a
 * reference height, plus a margin for sun-exposed rooms. A starting point for
 * an installer conversation, not a heat-load calculation.
 */
export function acZones(solved: Solved, s: Settings): AcZone[] {
  const groups = new Map<string, SolvedRoom[]>()
  for (const r of solved.rooms) {
    if (!needsAc(r)) continue
    const key = r.room.acZone.trim() || r.room.name
    groups.set(key, [...(groups.get(key) ?? []), r])
  }
  return [...groups].map(([name, rooms]) => {
    const area = rooms.reduce((a, r) => a + r.area, 0)
    const volume = rooms.reduce((a, r) => a + r.area * r.height, 0)
    const avgHeight = area > 0 ? volume / area : s.defaultHeight
    const sunny = rooms.some((r) => isSunny(solved, r))
    const btu = (area / 1e6) * M2_TO_SQFT * s.acBtuPerSqft * (avgHeight / s.acRefHeight) * (sunny ? s.acSunnyFactor : 1)
    // A zone is cooled as one space, so the units in all its rooms add up.
    const installed = rooms.flatMap((r) => {
      const size = AC_SIZES.find((x) => x.hp === r.room.acInstalled)
      return size ? [{ ...size, room: r.room.name }] : []
    })
    const installedBtu = installed.reduce((a, u) => a + u.btu, 0)
    const enough = installed.length ? btu <= installedBtu * (1 + s.acShortfall) : null
    return { name, rooms, area, volume, btu, sunny, units: pickUnits(btu), installed, installedBtu, enough }
  })
}

export function pickUnits(btu: number) {
  const largest = AC_SIZES[AC_SIZES.length - 1]
  const count = Math.max(1, Math.ceil(btu / largest.btu))
  const each = btu / count
  const size = AC_SIZES.find((x) => x.btu >= each) ?? largest
  return { ...size, count }
}
