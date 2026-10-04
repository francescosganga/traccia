import { useEffect, useState } from 'react'
import { formatTime, parseTime } from '../../../shared/time'

interface Props {
  /** ms */
  value: number
  max: number
  onChange: (ms: number) => void
  label: string
}

/**
 * A time as the timeline writes it (mm:ss.mmm). Like NumberField it commits when the field loses
 * focus or on Enter, clamped to 0…max; text that is not a time (or Escape) restores the value.
 */
export function TimeField({ value, max, onChange, label }: Props) {
  const [draft, setDraft] = useState(formatTime(value))
  useEffect(() => setDraft(formatTime(value)), [value])

  // The text comes from the field itself: a blur right after typing can reach a handler rendered before the last keystroke
  const commit = (text: string) => {
    const ms = parseTime(text)
    const v = ms === null ? value : Math.max(0, Math.min(max, ms))
    setDraft(formatTime(v))
    if (v !== value) onChange(v)
  }

  return (
    <input
      type="text"
      className="time-field"
      aria-label={label}
      spellCheck={false}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={(e) => commit(e.currentTarget.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur()
        if (e.key === 'Escape') setDraft(formatTime(value))
      }}
    />
  )
}
