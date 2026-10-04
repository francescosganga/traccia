import { beforeAll, describe, expect, it } from 'vitest'
import { setLanguage, t } from '../shared/i18n'
import type { RecordingJson } from '../shared/recording-reader'
import type { ClickEvent, CursorSample } from '../shared/types'
import { recordingTexts, textsInputFromJson } from './texts'
import { mapPoint, wordsAround, type Geometry, type TimelineInput } from './timeline'

beforeAll(() => setLanguage('en'))

// A region of a Retina display, downscaled: the case where JSON coordinates differ most from the captured ones.
const geometry: Geometry = {
  displayBounds: { x: 1440, y: 0, width: 1440, height: 900 },
  scale: 2,
  cropPx: { x: 200, y: 100, width: 1000, height: 600 },
  outScale: 0.5,
  outWidth: 500,
  outHeight: 300
}
const t0 = 1_000_000

/** What the session has at the end of a recording, and the recording.json it writes from it. */
function recording(format: 'mp4' | 'jpg'): { live: TimelineInput; json: RecordingJson } {
  const samples: CursorSample[] = Array.from({ length: 50 }, (_, i) => ({ t: t0 + i * 100, x: 1540 + i * 3, y: 50 + (i % 7) * 20 }))
  const clicks: ClickEvent[] = [
    { t: t0 + 1200, button: 'left', x: 1600, y: 120 },
    { t: t0 + 3300, button: 'right', x: 1450, y: 10 }
  ]
  const segments = [{ start: 0.5, end: 2, text: 'Here I open the menu' }]
  const words = [
    { start: 0.5, end: 0.8, text: ' Here' },
    { start: 1, end: 1.3, text: ' I' },
    { start: 1.3, end: 2, text: ' open' }
  ]
  const frames = format === 'jpg' ? [{ file: 'frames/frame_00001.jpg', tMs: 0 }, { file: 'frames/frame_00002.jpg', tMs: 1500 }] : undefined
  const live: TimelineInput = {
    createdAt: new Date('2026-10-01T10:00:00Z'),
    format,
    mediaName: format === 'jpg' ? 'frames/' : 'recording.mp4',
    width: 500,
    height: 300,
    fps: format === 'jpg' ? 2 : 30,
    durationMs: 4900,
    audio: true,
    systemAudio: false,
    whisperModel: 'base',
    language: 'en',
    t0,
    samples,
    clicks,
    segments,
    words,
    cursorHz: 10,
    geometry,
    frames,
    skippedFrames: format === 'jpg' ? 3 : 0,
    warnings: ['No webcam: the camera could not be opened']
  }
  const json: RecordingJson = {
    version: 1,
    app: 'traccia',
    createdAt: live.createdAt.toISOString(),
    format,
    media: live.mediaName,
    timeline: 'recording.txt',
    rawTimeline: 'recording-raw.txt',
    prompt: 'PROMPT.md',
    width: 500,
    height: 300,
    fps: live.fps,
    durationMs: live.durationMs,
    display: { id: 1, bounds: geometry.displayBounds, scaleFactor: 2 },
    capture: { width: 2880, height: 1800, mimeType: 'video/webm' },
    region: { x: 100, y: 50, width: 500, height: 300 },
    cropPx: geometry.cropPx,
    audio: true,
    systemAudio: false,
    whisper: { model: 'base', language: 'en' },
    cursor: samples.map((s) => {
      const p = mapPoint(geometry, s.x, s.y)
      return [s.t - t0, p.x, p.y]
    }),
    clicks: clicks.map((c) => {
      const p = mapPoint(geometry, c.x, c.y)
      return { t: c.t - t0, button: c.button, x: p.x, y: p.y, speech: wordsAround(words, (c.t - t0) / 1000) }
    }),
    transcript: segments,
    words,
    frames,
    skippedFrames: live.skippedFrames,
    cursorHz: 10,
    clicksTracked: true,
    warnings: live.warnings
  }
  return { live, json }
}

describe('textsInputFromJson', () => {
  for (const format of ['mp4', 'jpg'] as const) {
    it(`rebuilds the texts the session wrote (${format})`, () => {
      const { live, json } = recording(format)
      const rebuilt = textsInputFromJson(json, 99)
      expect(rebuilt.clicksTracked).toBe(true)
      expect(recordingTexts(rebuilt.input, '/rec', rebuilt.clicksTracked)).toEqual(recordingTexts(live, '/rec', true))
    })
  }

  it('says which points are outside the picture, as the original mapping did', () => {
    const { json } = recording('mp4')
    const { txt } = recordingTexts(textsInputFromJson(json, 10).input, '/rec', true)
    expect(txt).toContain('00:03.300 click right -90,-40 (outside)')
  })

  it('says where the editor silenced the audio', () => {
    const { json } = recording('mp4')
    const { txt } = recordingTexts(textsInputFromJson({ ...json, muted: [{ fromMs: 1000, toMs: 2500 }] }, 10).input, '/rec', true)
    expect(txt).toContain('# Silenced after the recording: 00:01.000 → 00:02.500;')
    expect(recordingTexts(textsInputFromJson(json, 10).input, '/rec', true).txt).not.toContain('Silenced')
  })

  it('falls back to the current cursor rate for recordings that did not store it', () => {
    const { json } = recording('mp4')
    delete json.cursorHz
    expect(textsInputFromJson(json, 4).input.cursorHz).toBe(4)
  })

  it('guesses whether clicks were tracked for recordings that did not store it', () => {
    const { json } = recording('mp4')
    delete json.clicksTracked
    expect(textsInputFromJson(json, 10).clicksTracked).toBe(true)
    const none = { ...json, clicks: [] }
    expect(textsInputFromJson(none, 10).clicksTracked).toBe(true)
    // Recorded in Italian, read in English
    setLanguage('it')
    const warning = t('warn.clicksHookFailed', { error: 'EPERM' })
    setLanguage('en')
    expect(textsInputFromJson({ ...none, warnings: [warning] }, 10).clicksTracked).toBe(false)
  })
})
