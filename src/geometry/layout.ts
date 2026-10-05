import type { Vec2 } from '../types'
import { dot, sub } from './vec'

export interface LayoutRoom {
  /** closed outline in mm with an arbitrary origin */
  walk: Vec2[]
  /** where the room would sit if we only trusted the plan */
  prior: Vec2
}

export interface LayoutLink {
  a: number
  edgeA: number
  b: number
  edgeB: number
  /** unit outward normal of room a's edge */
  normal: Vec2
  /** desired distance between the two faces, mm */
  gap: number
  weight: number
}

const PRIOR_WEIGHT = 1e-4

/**
 * Least-squares placement: translate each room so that faces across a shared
 * wall end up exactly one wall thickness apart, staying close to the plan otherwise.
 */
export function layoutRooms(rooms: LayoutRoom[], links: LayoutLink[]): Vec2[] {
  const n = rooms.length * 2
  const H = Array.from({ length: n }, () => new Float64Array(n))
  const g = new Float64Array(n)

  rooms.forEach((r, i) => {
    H[2 * i][2 * i] += PRIOR_WEIGHT
    H[2 * i + 1][2 * i + 1] += PRIOR_WEIGHT
    g[2 * i] += PRIOR_WEIGHT * r.prior.x
    g[2 * i + 1] += PRIOR_WEIGHT * r.prior.y
  })

  for (const l of links) {
    // gap = dot(walkB[j] - walkA[i], n) + dot(tB - tA, n)  → want = l.gap
    const base = dot(sub(rooms[l.b].walk[l.edgeB], rooms[l.a].walk[l.edgeA]), l.normal)
    const c = l.gap - base
    const idx = [2 * l.a, 2 * l.a + 1, 2 * l.b, 2 * l.b + 1]
    const coef = [-l.normal.x, -l.normal.y, l.normal.x, l.normal.y]
    for (let p = 0; p < 4; p++) {
      g[idx[p]] += l.weight * coef[p] * c
      for (let q = 0; q < 4; q++) H[idx[p]][idx[q]] += l.weight * coef[p] * coef[q]
    }
  }

  const t = solveSpd(H, g)
  return rooms.map((_, i) => ({ x: t[2 * i], y: t[2 * i + 1] }))
}

/** Gaussian elimination with partial pivoting (systems here are tiny). */
function solveSpd(A: Float64Array[], b: Float64Array): Float64Array {
  const n = b.length
  const M = A.map((row) => Float64Array.from(row))
  const x = Float64Array.from(b)
  for (let col = 0; col < n; col++) {
    let piv = col
    for (let r = col + 1; r < n; r++) if (Math.abs(M[r][col]) > Math.abs(M[piv][col])) piv = r
    ;[M[col], M[piv]] = [M[piv], M[col]]
    ;[x[col], x[piv]] = [x[piv], x[col]]
    const d = M[col][col]
    if (Math.abs(d) < 1e-15) continue
    for (let r = col + 1; r < n; r++) {
      const f = M[r][col] / d
      if (f === 0) continue
      for (let c = col; c < n; c++) M[r][c] -= f * M[col][c]
      x[r] -= f * x[col]
    }
  }
  for (let r = n - 1; r >= 0; r--) {
    let s = x[r]
    for (let c = r + 1; c < n; c++) s -= M[r][c] * x[c]
    x[r] = Math.abs(M[r][r]) < 1e-15 ? 0 : s / M[r][r]
  }
  return x
}
