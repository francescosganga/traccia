import { locale, t } from '../shared/i18n'
import { formatTime, type FrameRef } from '../shared/recording-reader'
import type { ClickEvent, CursorSample, OutputFormat, Rect, TranscriptSegment, TranscriptWord } from '../shared/types'

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

const SPEECH_BEFORE = 1.5
const SPEECH_AFTER = 0.5
const SPEECH_MAX_WORDS = 10

/** Words being spoken around instant `t` (seconds), to annotate clicks. Empty string when silent. */
export function wordsAround(words: TranscriptWord[], t: number): string {
  const hits = words.filter((w) => w.end >= t - SPEECH_BEFORE && w.start <= t + SPEECH_AFTER)
  return hits
    .slice(-SPEECH_MAX_WORDS)
    .map((w) => w.text.trim())
    .join(' ')
}

/**
 * Drops transcript entries that start at or after the end of the recording and clamps the
 * rest to it. Whisper pads short audio with silence and sometimes "transcribes" that padding
 * (subtitle credits and the like), with timestamps past the end of the real audio.
 */
export function clipToDuration<T extends { start: number; end: number }>(items: T[], durationMs: number): T[] {
  const limit = durationMs / 1000
  return items.filter((s) => s.start < limit).map((s) => (s.end > limit ? { ...s, end: limit } : s))
}

/** Returns the last sample taken at or before epoch `t` (or the first one if none). */
export function sampleAt(samples: CursorSample[], t: number): CursorSample | null {
  if (samples.length === 0) return null
  let lo = 0
  let hi = samples.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (samples[mid].t <= t) lo = mid
    else hi = mid - 1
  }
  return samples[lo]
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
  whisperModel?: string
  language?: string
  t0: number
  samples: CursorSample[]
  clicks: ClickEvent[]
  segments: TranscriptSegment[] | null
  words?: TranscriptWord[]
  cursorHz: number
  geometry: Geometry
  frames?: FrameRef[]
  skippedFrames?: number
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
  const isFrames = input.format === 'jpg'
  const clicksOnly = input.cursorMode !== 'full'
  // Like cursor samples and clicks below, speech is limited to the recording's time span.
  const segments = input.segments ? clipToDuration(input.segments, input.durationMs) : null
  const words = input.words ? clipToDuration(input.words, input.durationMs) : []

  if (isFrames && input.frames) {
    for (const f of input.frames) {
      let cursor = ''
      if (!clicksOnly) {
        const s = sampleAt(input.samples, input.t0 + f.tMs)
        const pos = s ? mapPoint(g, s.x, s.y) : null
        cursor = pos && pos.inside ? ` cursor ${pos.x},${pos.y}` : ' cursor outside'
      }
      events.push({ t: f.tMs, order: 0, line: `${formatTime(f.tMs)} frame ${f.file}${cursor}` })
    }
  }
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
    const said = words.length ? wordsAround(words, rel / 1000) : ''
    events.push({ t: rel, order: 2, line: `${formatTime(rel)} click ${c.button} ${where}${said ? ` "${said}"` : ''}` })
  }

  if (segments) {
    for (const seg of segments) {
      const start = seg.start * 1000
      const end = seg.end * 1000
      events.push({ t: start, order: 3, line: `[${formatTime(start)} → ${formatTime(end)}] ${seg.text}` })
    }
  }

  events.sort((a, b) => a.t - b.t || a.order - b.order)

  const date = input.createdAt.toLocaleString(locale())
  const duration = formatTime(input.durationMs)
  const header: string[] = [t('tl.title', { date })]
  if (isFrames) {
    const skipped = input.skippedFrames ? t('tl.skipped', { n: input.skippedFrames }) : ''
    header.push(t('tl.frames', { w: input.width, h: input.height, fps: input.fps, n: input.frames?.length ?? 0, skipped, duration }))
  } else {
    header.push(t('tl.video', { name: input.mediaName, w: input.width, h: input.height, fps: input.fps, duration }))
  }
  if (input.audio) {
    header.push(
      input.segments
        ? t('tl.audioTranscribed', { model: input.whisperModel ?? '', lang: input.language ?? 'auto' })
        : t('tl.audioNoTranscript')
    )
  } else {
    header.push(t('tl.audioNone'))
  }
  const unit = isFrames ? t('tl.unitImage') : t('tl.unitVideo')
  header.push(clicksOnly ? t('tl.cursorClicksOnly', { unit }) : t('tl.cursorFull', { unit, hz: input.cursorHz }))
  header.push('#')
  header.push(t('tl.formatTitle'))
  if (isFrames) header.push(clicksOnly ? t('tl.fmtFrameNoCursor') : t('tl.fmtFrame'))
  if (!clicksOnly) header.push(t('tl.fmtCursor'))
  header.push(words.length ? t('tl.fmtClickSpeech') : t('tl.fmtClick'))
  if (input.segments) header.push(t('tl.fmtSpeech'))
  if (input.warnings.length) {
    header.push('#')
    for (const w of input.warnings) header.push(t('tl.warning', { text: w }))
  }
  header.push('')

  return header.concat(events.map((e) => e.line)).join('\n') + '\n'
}
