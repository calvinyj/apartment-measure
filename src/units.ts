import type { LengthUnit } from './types'

export const M2_TO_SQFT = 10.7639

const FACTOR: Record<LengthUnit, number> = { mm: 1, cm: 10, m: 1000 }

export function toUnit(mm: number, unit: LengthUnit): number {
  return mm / FACTOR[unit]
}

export function formatLength(mm: number, unit: LengthUnit = 'mm'): string {
  const v = toUnit(mm, unit)
  const digits = unit === 'mm' ? 0 : unit === 'cm' ? 1 : 3
  return `${v.toLocaleString(undefined, { maximumFractionDigits: digits, minimumFractionDigits: unit === 'm' ? digits : 0 })} ${unit}`
}

/** Accepts "3152", "315.2cm", "3.152 m"; bare numbers use the default unit. */
export function parseLength(text: string, unit: LengthUnit): number | null {
  const m = text.trim().replace(/,/g, '').match(/^(\d+(?:\.\d*)?|\.\d+)\s*(mm|cm|m)?$/i)
  if (!m) return null
  const value = parseFloat(m[1])
  const u = (m[2]?.toLowerCase() as LengthUnit | undefined) ?? unit
  return value * FACTOR[u]
}

export const m2 = (mm2: number) => mm2 / 1e6

export function formatArea(mm2: number): string {
  return `${m2(mm2).toFixed(2)} m²`
}

export function formatSqft(mm2: number): string {
  return `${Math.round(m2(mm2) * M2_TO_SQFT).toLocaleString()} ft²`
}

export const fmtInt = (n: number) => Math.round(n).toLocaleString()
