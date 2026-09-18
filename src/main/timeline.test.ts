import { beforeAll, describe, expect, it } from 'vitest'
import { setLanguage } from '../shared/i18n'
import type { CursorSample, TranscriptWord } from '../shared/types'
import { buildTimeline, clipToDuration, formatTime, mapPoint, sampleAt, wordsAround, type Geometry } from './timeline'

beforeAll(() => setLanguage('en'))

// Primary display, 1:1 pixels, no crop: output pixels equal DIP.
const identity: Geometry = {
  displayBounds: { x: 0, y: 0, width: 1000, height: 600 },
  scale: 1,
  cropPx: { x: 0, y: 0, width: 1000, height: 600 },
  outScale: 1,
  outWidth: 1000,
  outHeight: 600
}

describe('mapPoint', () => {
  it('scales DIP to captured pixels', () => {
    const g: Geometry = { ...identity, scale: 2, cropPx: { x: 0, y: 0, width: 2000, height: 1200 }, outWidth: 2000, outHeight: 1200 }
    expect(mapPoint(g, 100, 50)).toEqual({ x: 200, y: 100, inside: true })
  })

  it('applies display origin, crop and downscale', () => {
    // Secondary display to the right of the primary, a region cropped out of it, output halved.
    const g: Geometry = {
      displayBounds: { x: 1440, y: 0, width: 1440, height: 900 },
      scale: 2,
      cropPx: { x: 200, y: 100, width: 1000, height: 600 },
      outScale: 0.5,
      outWidth: 500,
      outHeight: 300
    }
    expect(mapPoint(g, 1640, 100)).toEqual({ x: 100, y: 50, inside: true })
    expect(mapPoint(g, 1490, 0)).toEqual({ x: -50, y: -50, inside: false })
    expect(mapPoint(g, 2039, 50)).toEqual({ x: 499, y: 0, inside: true })
    expect(mapPoint(g, 2040, 50)).toEqual({ x: 500, y: 0, inside: false })
  })

  it('rounds to whole pixels', () => {
    const g: Geometry = { ...identity, outScale: 0.5, outWidth: 500, outHeight: 300 }
    expect(mapPoint(g, 3, 5)).toEqual({ x: 2, y: 3, inside: true })
  })
})

describe('wordsAround', () => {
  const word = (start: number, text: string): TranscriptWord => ({ start, end: start + 0.3, text })

  it('is empty when nothing was said nearby', () => {
    expect(wordsAround([], 1)).toBe('')
    expect(wordsAround([word(10, 'later')], 1)).toBe('')
  })

  it('keeps words from 1.5 s before to 0.5 s after the instant', () => {
    const words = [word(0, ' hello'), word(0.5, ' world'), word(1.4, ' soon'), word(1.6, ' late')]
    expect(wordsAround(words, 1)).toBe('hello world soon')
  })

  it('caps the result at the last 10 words', () => {
    const words = Array.from({ length: 12 }, (_, i) => word(i * 0.1, `w${i}`))
    expect(wordsAround(words, 1)).toBe('w2 w3 w4 w5 w6 w7 w8 w9 w10 w11')
  })
})

describe('clipToDuration', () => {
  it('drops entries past the end and clamps the one straddling it', () => {
    const items = [
      { start: 0, end: 1, text: 'a' },
      { start: 1.5, end: 2.5, text: 'b' },
      { start: 2, end: 3, text: 'c' }
    ]
    expect(clipToDuration(items, 2000)).toEqual([
      { start: 0, end: 1, text: 'a' },
      { start: 1.5, end: 2, text: 'b' }
    ])
  })
})

describe('formatTime', () => {
  it('formats mm:ss.mmm under an hour', () => {
    expect(formatTime(0)).toBe('00:00.000')
    expect(formatTime(1234)).toBe('00:01.234')
    expect(formatTime(65_000)).toBe('01:05.000')
    expect(formatTime(599_999)).toBe('09:59.999')
  })

  it('adds the hours only when needed', () => {
    expect(formatTime(3_600_000)).toBe('1:00:00.000')
    expect(formatTime(3_661_500)).toBe('1:01:01.500')
  })

  it('clamps negative values to zero', () => {
    expect(formatTime(-5)).toBe('00:00.000')
  })
})

describe('sampleAt', () => {
  const samples: CursorSample[] = [
    { t: 100, x: 1, y: 1 },
    { t: 200, x: 2, y: 2 },
    { t: 300, x: 3, y: 3 }
  ]

  it('returns null without samples', () => {
    expect(sampleAt([], 150)).toBeNull()
  })

  it('returns the first sample before the first timestamp', () => {
    expect(sampleAt(samples, 50)).toBe(samples[0])
  })

  it('returns the exact match', () => {
    expect(sampleAt(samples, 200)).toBe(samples[1])
  })

  it('returns the last sample at or before the instant', () => {
    expect(sampleAt(samples, 250)).toBe(samples[1])
    expect(sampleAt(samples, 1000)).toBe(samples[2])
  })
})

describe('buildTimeline', () => {
  const t0 = 1_700_000_000_000
  const createdAt = new Date(2026, 8, 18, 10, 30, 0)
  const title = `# Traccia — recorded on ${createdAt.toLocaleString('en-US')}`

  it('writes a video timeline with clicks and the words said around them', () => {
    const out = buildTimeline({
      createdAt,
      format: 'mp4',
      mediaName: 'recording.mp4',
      width: 1000,
      height: 600,
      fps: 30,
      durationMs: 5000,
      audio: true,
      whisperModel: 'base',
      language: 'en',
      t0,
      samples: [],
      clicks: [
        { t: t0 - 10, button: 'left', x: 1, y: 1 },
        { t: t0 + 1000, button: 'left', x: 10, y: 20 },
        { t: t0 + 3200, button: 'right', x: 2000, y: 20 },
        { t: t0 + 6000, button: 'left', x: 1, y: 1 }
      ],
      segments: [
        { start: 0.5, end: 2, text: 'open the menu' },
        { start: 2.5, end: 4, text: 'and click save' },
        { start: 4.5, end: 7, text: 'trailing' },
        { start: 5.5, end: 6, text: 'padding junk' }
      ],
      words: [
        { start: 0.5, end: 0.8, text: 'open' },
        { start: 0.9, end: 1.1, text: 'the' },
        { start: 1.2, end: 1.5, text: 'menu' },
        { start: 2.5, end: 2.7, text: 'and' },
        { start: 2.8, end: 3, text: 'click' },
        { start: 3.1, end: 3.5, text: 'save' }
      ],
      cursorHz: 10,
      geometry: identity,
      warnings: ['Accessibility permission missing']
    })

    expect(out.split('\n')).toEqual([
      title,
      '# Video: recording.mp4 (1000x600, 30 fps, duration 00:05.000)',
      '# Audio: microphone, transcribed with Whisper base (language: en)',
      '# Cursor: only mouse clicks are listed (coordinates in video pixels, origin at the top-left corner); the full pointer movement is in recording-raw.txt',
      '#',
      '# Line format:',
      '#   mm:ss.mmm click left|right|middle X,Y "words"  mouse click and the words being spoken at that moment',
      '#   [mm:ss.mmm → mm:ss.mmm] text          transcribed speech',
      '#',
      '# Warning: Accessibility permission missing',
      '',
      '[00:00.500 → 00:02.000] open the menu',
      '00:01.000 click left 10,20 "open the menu"',
      '[00:02.500 → 00:04.000] and click save',
      '00:03.200 click right 2000,20 (outside) "and click save"',
      '[00:04.500 → 00:05.000] trailing',
      ''
    ])
  })

  it('writes a frame timeline with the pointer movement in full mode', () => {
    const out = buildTimeline({
      createdAt,
      format: 'jpg',
      mediaName: 'frames',
      width: 1000,
      height: 600,
      fps: 2,
      durationMs: 1500,
      audio: false,
      t0,
      samples: [
        { t: t0, x: 10, y: 10 },
        { t: t0 + 50, x: 12, y: 10 }, // too soon at 10 Hz
        { t: t0 + 100, x: 12, y: 10 },
        { t: t0 + 200, x: 12, y: 10 }, // did not move
        { t: t0 + 400, x: 2000, y: 10 }, // outside
        { t: t0 + 600, x: 30, y: 40 },
        { t: t0 + 7000, x: 50, y: 50 } // after the end
      ],
      clicks: [{ t: t0 + 600, button: 'middle', x: 30, y: 40 }],
      segments: null,
      cursorHz: 10,
      geometry: identity,
      frames: [
        { file: 'frames/frame_00001.jpg', tMs: 0 },
        { file: 'frames/frame_00002.jpg', tMs: 500 },
        { file: 'frames/frame_00003.jpg', tMs: 1000 }
      ],
      skippedFrames: 3,
      warnings: [],
      cursorMode: 'full'
    })

    expect(out.split('\n')).toEqual([
      title,
      '# Frames: folder frames/ (1000x600, 2 fps, 3 frames; 3 identical frames skipped), duration 00:01.500',
      '# Audio: none',
      '# Cursor: coordinates in image pixels, origin at the top-left corner; sampled at 10 Hz only when it moves',
      '#',
      '# Line format:',
      '#   mm:ss.mmm frame <file> cursor X,Y      image captured at that instant and pointer position',
      '#   mm:ss.mmm cursor X,Y                   pointer position',
      '#   mm:ss.mmm click left|right|middle X,Y  mouse click',
      '',
      '00:00.000 frame frames/frame_00001.jpg cursor 10,10',
      '00:00.000 cursor 10,10',
      '00:00.100 cursor 12,10',
      '00:00.500 frame frames/frame_00002.jpg cursor outside',
      '00:00.600 cursor 30,40',
      '00:00.600 click middle 30,40',
      '00:01.000 frame frames/frame_00003.jpg cursor 30,40',
      ''
    ])
  })

  it('says when the audio was recorded but not transcribed', () => {
    const out = buildTimeline({
      createdAt,
      format: 'mov',
      mediaName: 'recording.mov',
      width: 1000,
      height: 600,
      fps: 30,
      durationMs: 1000,
      audio: true,
      t0,
      samples: [],
      clicks: [],
      segments: null,
      cursorHz: 10,
      geometry: identity,
      warnings: []
    })
    const lines = out.split('\n')
    expect(lines[2]).toBe('# Audio: microphone (no transcription)')
    expect(lines.slice(5)).toEqual(['# Line format:', '#   mm:ss.mmm click left|right|middle X,Y  mouse click', '', ''])
  })
})
