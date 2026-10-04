// Times as the timeline writes them (mm:ss.mmm). No Node imports: the renderer uses them too.

export function formatTime(ms: number): string {
  const total = Math.max(0, ms) / 1000
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const mmss = `${String(m).padStart(2, '0')}:${s.toFixed(3).padStart(6, '0')}`
  return h > 0 ? `${h}:${mmss}` : mmss
}

/**
 * Reads what formatTime writes ("01:05.250", "1:01:05.250") and the shorter forms people type
 * ("65.25", "1:05", a comma for the decimals). Null when the text is not a time.
 */
export function parseTime(text: string): number | null {
  const m = /^\s*(?:(?:(\d+):)?(\d+):)?(\d+(?:[.,]\d*)?)\s*$/.exec(text)
  if (!m) return null
  const [, h, min, sec] = m
  const s = Number(sec.replace(',', '.'))
  // "01:75" and "1:75:00" are not times
  if ((min !== undefined && s >= 60) || (h !== undefined && Number(min) >= 60)) return null
  return Math.round(((Number(h ?? 0) * 60 + Number(min ?? 0)) * 60 + s) * 1000)
}
