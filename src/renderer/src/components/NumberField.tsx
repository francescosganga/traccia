import { useEffect, useState } from 'react'

interface Props {
  value: number
  min: number
  max: number
  step?: number
  onChange: (v: number) => void
}

/**
 * Number input that commits while typing only when the text is a number within range, and
 * clamps (or restores the last value) when the field loses focus. Clamping on every keystroke
 * would replace "0" with the default before the user can type "0.5".
 */
export function NumberField({ value, min, max, step, onChange }: Props) {
  const [draft, setDraft] = useState(String(value))
  useEffect(() => setDraft(String(value)), [value])

  const parse = (text: string): number | null => {
    if (text.trim() === '') return null
    const n = Number(text)
    return Number.isFinite(n) ? n : null
  }
  const edit = (text: string) => {
    setDraft(text)
    const n = parse(text)
    if (n !== null && n >= min && n <= max && n !== value) onChange(n)
  }
  const commit = () => {
    const n = parse(draft)
    const v = n === null ? value : Math.max(min, Math.min(max, n))
    setDraft(String(v))
    if (v !== value) onChange(v)
  }

  return (
    <input
      type="number"
      min={min}
      max={max}
      step={step}
      value={draft}
      onChange={(e) => edit(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur()
      }}
    />
  )
}
