import { isSunny } from './geometry/facing'
import type { Solved, SolvedRoom } from './geometry/solve'
import { roomTypeInfo, type Settings } from './types'
import { M2_TO_SQFT } from './units'

/** Common residential split-unit sizes in Malaysia (HP is the retail label). */
export const AC_SIZES = [
  { hp: '1.0 HP', btu: 9000 },
  { hp: '1.5 HP', btu: 12000 },
  { hp: '2.0 HP', btu: 18000 },
  { hp: '2.5 HP', btu: 24000 },
]

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
  units: { hp: string; btu: number; count: number }
}

/** Explicit choice wins; putting a room in a named zone implies it's cooled with that zone. */
export const needsAc = (r: SolvedRoom) => r.room.ac ?? (r.room.acZone.trim() !== '' || roomTypeInfo(r.room.type).ac)

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
    return { name, rooms, area, volume, btu, sunny, units: pickUnits(btu) }
  })
}

export function pickUnits(btu: number) {
  const largest = AC_SIZES[AC_SIZES.length - 1]
  const count = Math.max(1, Math.ceil(btu / largest.btu))
  const each = btu / count
  const size = AC_SIZES.find((x) => x.btu >= each) ?? largest
  return { ...size, count }
}
