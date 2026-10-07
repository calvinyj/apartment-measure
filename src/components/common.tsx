import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { AC_SIZES, hpLabel } from '../ac'
import { solveProject } from '../geometry/solve'
import { useStore } from '../store'
import type { LengthUnit, Room } from '../types'
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

/** Pre-installed aircon in a room; the report checks it against the estimate instead of suggesting one. */
export function InstalledAcField({ room }: { room: Room }) {
  const updateRoom = useStore((s) => s.updateRoom)
  return (
    <Field label="Aircon already installed" hint="Leave as None to get a suggested size. Units in the same aircon zone add up.">
      <select
        value={room.acInstalled == null ? '' : String(room.acInstalled)}
        onChange={(e) => updateRoom(room.id, { acInstalled: e.target.value === '' ? null : Number(e.target.value) })}
      >
        <option value="">None</option>
        {AC_SIZES.map((x) => (
          <option key={x.hp} value={x.hp}>
            {hpLabel(x.hp)}
          </option>
        ))}
      </select>
    </Field>
  )
}

/** "#abc", "abc", "#aabbcc" or "aabbcc" as "#aabbcc"; null if it isn't a hex colour. */
export function parseHexColor(text: string): string | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(text.trim())
  if (!m) return null
  const h = m[1].length === 3 ? [...m[1]].map((c) => c + c).join('') : m[1]
  return `#${h.toLowerCase()}`
}

/** Hex colour code with the browser's colour picker beside it. */
export function ColorInput({ value, onChange }: { value: string; onChange: (hex: string) => void }) {
  const [text, setText] = useState(value)
  const [bad, setBad] = useState(false)
  const focused = useRef(false)

  useEffect(() => {
    if (!focused.current) setText(value)
  }, [value])

  return (
    <div className={`color-input${bad ? ' bad' : ''}`}>
      {/* The code comes first so tapping the field's label focuses it rather than opening the picker. */}
      <input
        autoComplete="off"
        spellCheck={false}
        value={text}
        placeholder="#rrggbb"
        onFocus={(e) => {
          focused.current = true
          e.target.select()
        }}
        onBlur={() => {
          focused.current = false
          setBad(false)
          setText(value)
        }}
        onChange={(e) => {
          setText(e.target.value)
          const hex = parseHexColor(e.target.value)
          setBad(hex == null)
          if (hex) onChange(hex)
        }}
      />
      <input type="color" value={value} onChange={(e) => onChange(e.target.value)} aria-label="Pick a colour" />
    </div>
  )
}
