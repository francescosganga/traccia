// Times as the timeline writes them (mm:ss.mmm). No Node imports: the renderer uses them too.

export function formatTime(ms: number): string {
  const total = Math.max(0, ms) / 1000
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const mmss = `${String(m).padStart(2, '0')}:${s.toFixed(3).padStart(6, '0')}`
  return h > 0 ? `${h}:${mmss}` : mmss
}
