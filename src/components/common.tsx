import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { solveProject } from '../geometry/solve'
import { useStore } from '../store'
import type { LengthUnit } from '../types'
import { parseLength, toUnit } from '../units'

export function useSolved() {
  const project = useStore((s) => s.project)
  return useMemo(() => solveProject(project), [project])
}

const DIGITS: Record<LengthUnit, number> = { mm: 0, cm: 1, m: 3 }
const show = (mm: number | null, unit: LengthUnit) => (mm == null ? '' : String(Number(toUnit(mm, unit).toFixed(DIGITS[unit]))))

/** Length field in the user's preferred unit; also accepts "3.15m" / "315cm" / "3150mm". */
export function LengthInput({
  value,
  onChange,
  unit,
  placeholder,
  autoFocus,
  onEnter,
  id,
}: {
  value: number | null
  onChange: (mm: number | null) => void
  unit: LengthUnit
  placeholder?: number | null
  autoFocus?: boolean
  onEnter?: () => void
  id?: string
}) {
  const [text, setText] = useState(show(value, unit))
  const [bad, setBad] = useState(false)
  const focused = useRef(false)

  useEffect(() => {
    if (!focused.current) setText(show(value, unit))
  }, [value, unit])

  return (
    <div className={`len-input${bad ? ' bad' : ''}`}>
      <input
        id={id}
        inputMode="decimal"
        autoComplete="off"
        autoFocus={autoFocus}
        value={text}
        placeholder={placeholder == null ? '' : show(placeholder, unit)}
        onFocus={(e) => {
          focused.current = true
          e.target.select()
        }}
        onBlur={() => {
          focused.current = false
          setBad(false)
          setText(show(value, unit))
        }}
        onChange={(e) => {
          const t = e.target.value
          setText(t)
          if (t.trim() === '') {
            setBad(false)
            onChange(null)
            return
          }
          const mm = parseLength(t, unit)
          setBad(mm == null)
          if (mm != null) onChange(mm)
        }}
        onKeyDown={(e: KeyboardEvent) => {
          if (e.key === 'Enter') onEnter?.()
        }}
      />
      <span className="unit">{unit}</span>
    </div>
  )
}

export function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  )
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T
  options: { value: T; label: string }[]
  onChange: (v: T) => void
}) {
  return (
    <div className="segmented">
      {options.map((o) => (
        <button key={o.value} className={o.value === value ? 'on' : ''} onClick={() => onChange(o.value)} type="button">
          {o.label}
        </button>
      ))}
    </div>
  )
}
