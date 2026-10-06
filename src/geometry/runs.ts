import type { Room } from '../types'
import { cross, dot, NEARLY_PARALLEL, norm, sub } from './vec'

/**
 * Group a room's edges into what you'd measure on site. Consecutive wall edges on
 * one straight line (split only because a neighbour changes on the other side) form
 * a single wall: there's no corner between them to measure to. Open edges stay single.
 *
 * Groups are in edge order; a group may wrap past the last edge (e.g. [4, 0]).
 */
export function measureGroups(room: Room): number[][] {
  const n = room.points.length
  const dirs = room.points.map((p, i) => norm(sub(room.points[(i + 1) % n], p)))
  const continues = room.edges.map((e, i) => {
    const j = (i + 1) % n
    return (
      e.kind === 'wall' &&
      room.edges[j].kind === 'wall' &&
      Math.abs(cross(dirs[i], dirs[j])) < NEARLY_PARALLEL &&
      dot(dirs[i], dirs[j]) > 0
    )
  })
  if (continues.every(Boolean) || !continues.some(Boolean)) return room.edges.map((_, i) => [i])

  // Start on an edge that doesn't continue the one before it.
  const start = continues.findIndex((_, i) => !continues[(i - 1 + n) % n])
  const groups: number[][] = []
  let cur: number[] = []
  for (let k = 0; k < n; k++) {
    const i = (start + k) % n
    cur.push(i)
    if (!continues[i]) {
      groups.push(cur)
      cur = []
    }
  }
  return groups.sort((a, b) => Math.min(...a) - Math.min(...b))
}

/** The group an edge belongs to. */
export const groupOf = (groups: number[][], edge: number) => groups.find((g) => g.includes(edge)) ?? [edge]

/** Total measured length of a group, or null unless every part has a measurement. */
export function groupMeasured(room: Room, group: number[]): number | null {
  let sum = 0
  for (const i of group) {
    const m = room.edges[i].measured
    if (m == null) return null
    sum += m
  }
  return sum
}

/** Share one measured length across a group's parts in proportion to the plan. */
export function splitMeasured(total: number | null, group: number[], estimates: number[]): (number | null)[] {
  if (total == null) return group.map(() => null)
  const planTotal = group.reduce((a, i) => a + estimates[i], 0)
  return group.map((i) => (planTotal > 0 ? (total * estimates[i]) / planTotal : total / group.length))
}
