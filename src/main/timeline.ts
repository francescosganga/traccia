import { locale, t } from '../shared/i18n'
import type { ClickEvent, CursorSample, OutputFormat, Rect } from '../shared/types'

/** Everything needed to map a global cursor position (DIP) to output pixels. */
export interface Geometry {
  /** Display bounds in DIP */
  displayBounds: Rect
  /** Captured pixels per DIP (2 on Retina) */
  scale: number
  /** Crop rectangle in captured pixels */
  cropPx: Rect
  /** Output pixels per captured pixel (≤ 1, downscaling only) */
  outScale: number
  outWidth: number
  outHeight: number
}

export function mapPoint(g: Geometry, x: number, y: number): { x: number; y: number; inside: boolean } {
  const cx = (x - g.displayBounds.x) * g.scale - g.cropPx.x
  const cy = (y - g.displayBounds.y) * g.scale - g.cropPx.y
  const ox = Math.round(cx * g.outScale)
  const oy = Math.round(cy * g.outScale)
  return { x: ox, y: oy, inside: ox >= 0 && oy >= 0 && ox < g.outWidth && oy < g.outHeight }
}

export function formatTime(ms: number): string {
  const total = Math.max(0, ms) / 1000
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const mmss = `${String(m).padStart(2, '0')}:${s.toFixed(3).padStart(6, '0')}`
  return h > 0 ? `${h}:${mmss}` : mmss
}

export interface TimelineInput {
  createdAt: Date
  format: OutputFormat
  mediaName: string
  width: number
  height: number
  fps: number
  durationMs: number
  audio: boolean
  t0: number
  samples: CursorSample[]
  clicks: ClickEvent[]
  cursorHz: number
  geometry: Geometry
  warnings: string[]
  /** 'clicks' (default) lists only mouse clicks; 'full' also logs pointer movement */
  cursorMode?: 'full' | 'clicks'
}

interface Event {
  t: number
  order: number
  line: string
}

export function buildTimeline(input: TimelineInput): string {
  const g = input.geometry
  const events: Event[] = []
  const clicksOnly = input.cursorMode !== 'full'

  if (!clicksOnly) {
    // Downsample the 120 Hz stream to cursorHz and only log when the pointer actually moved.
    const minGap = 1000 / Math.max(1, input.cursorHz)
    let lastT = -Infinity
    let lastX = NaN
    let lastY = NaN
    for (const s of input.samples) {
      const rel = s.t - input.t0
      if (rel < 0 || rel > input.durationMs) continue
      if (rel - lastT < minGap) continue
      const p = mapPoint(g, s.x, s.y)
      if (!p.inside) continue
      if (p.x === lastX && p.y === lastY) continue
      lastT = rel
      lastX = p.x
      lastY = p.y
      events.push({ t: rel, order: 1, line: `${formatTime(rel)} cursor ${p.x},${p.y}` })
    }
  }

  for (const c of input.clicks) {
    const rel = c.t - input.t0
    if (rel < 0 || rel > input.durationMs) continue
    const p = mapPoint(g, c.x, c.y)
    const where = p.inside ? `${p.x},${p.y}` : `${p.x},${p.y} (outside)`
    events.push({ t: rel, order: 2, line: `${formatTime(rel)} click ${c.button} ${where}` })
  }

  events.sort((a, b) => a.t - b.t || a.order - b.order)

  const date = input.createdAt.toLocaleString(locale())
  const duration = formatTime(input.durationMs)
  const header: string[] = [t('tl.title', { date })]
  header.push(t('tl.video', { name: input.mediaName, w: input.width, h: input.height, fps: input.fps, duration }))
  header.push(input.audio ? t('tl.audio') : t('tl.audioNone'))
  const unit = t('tl.unitVideo')
  header.push(clicksOnly ? t('tl.cursorClicksOnly', { unit }) : t('tl.cursorFull', { unit, hz: input.cursorHz }))
  header.push('#')
  header.push(t('tl.formatTitle'))
  if (!clicksOnly) header.push(t('tl.fmtCursor'))
  header.push(t('tl.fmtClick'))
  if (input.warnings.length) {
    header.push('#')
    for (const w of input.warnings) header.push(t('tl.warning', { text: w }))
  }
  header.push('')

  return header.concat(events.map((e) => e.line)).join('\n') + '\n'
}
