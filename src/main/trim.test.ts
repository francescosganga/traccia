import { describe, expect, it } from 'vitest'
import type { RecordingJson } from '../shared/recording-reader'
import { keptFrames, trimAudioArgs, trimRecordingJson, trimVideoArgs } from './trim'

// 10 s at 2 fps: 20 frames taken (0, 500 … 9500 ms), 4 kept because the others were identical.
function jpgRecording(): RecordingJson {
  return {
    version: 1,
    app: 'traccia',
    createdAt: '2026-10-01T10:00:00.000Z',
    format: 'jpg',
    media: 'frames/',
    timeline: 'recording.txt',
    rawTimeline: 'recording-raw.txt',
    prompt: 'PROMPT.md',
    width: 800,
    height: 600,
    fps: 2,
    durationMs: 10_000,
    display: { id: 1, bounds: { x: 0, y: 0, width: 800, height: 600 }, scaleFactor: 1 },
    capture: { width: 800, height: 600, mimeType: 'video/webm' },
    region: null,
    cropPx: { x: 0, y: 0, width: 800, height: 600 },
    audio: true,
    systemAudio: false,
    whisper: { model: 'base', language: 'en' },
    cursor: Array.from({ length: 100 }, (_, k): [number, number, number] => [50 + k * 100, k, k]),
    clicks: [
      { t: 1000, button: 'left', x: 10, y: 10, speech: 'one' },
      { t: 4500, button: 'right', x: 45, y: 45, speech: 'two more three' },
      { t: 9000, button: 'left', x: 90, y: 90, speech: 'end' }
    ],
    transcript: [
      { start: 0.5, end: 2.5, text: 'one' },
      { start: 3, end: 5, text: 'two more' },
      { start: 5, end: 9, text: 'three end' }
    ],
    words: [
      { start: 0.5, end: 1, text: ' one' },
      { start: 3, end: 3.4, text: ' two' },
      { start: 3.6, end: 4.9, text: ' more' },
      { start: 5, end: 5.5, text: ' three' },
      { start: 8.5, end: 9, text: ' end' }
    ],
    frames: [
      { file: 'frames/frame_00001.jpg', tMs: 0 },
      { file: 'frames/frame_00002.jpg', tMs: 1500 },
      { file: 'frames/frame_00003.jpg', tMs: 4000 },
      { file: 'frames/frame_00004.jpg', tMs: 8000 }
    ],
    skippedFrames: 16,
    cursorHz: 10,
    clicksTracked: true,
    warnings: []
  }
}

function videoRecording(): RecordingJson {
  const meta = jpgRecording()
  delete meta.frames
  return {
    ...meta,
    format: 'mp4',
    media: 'recording-screen.mp4',
    fps: 30,
    skippedFrames: 0,
    webcam: {
      video: 'recording.mp4',
      layout: [
        { t: 0, shape: 'square', corner: 'bottom-right', visible: true, rect: { x: 600, y: 400, width: 156, height: 156 } },
        { t: 3000, shape: 'circle', corner: 'top-left', visible: true, rect: { x: 18, y: 18, width: 156, height: 156 } },
        { t: 7000, shape: 'circle', corner: 'top-left', visible: false, rect: { x: 18, y: 18, width: 156, height: 156 } }
      ]
    }
  }
}

describe('trimRecordingJson', () => {
  const trimmed = trimRecordingJson(jpgRecording(), 2000, 6000)

  it('keeps the part in range, shifted to its start', () => {
    expect(trimmed.durationMs).toBe(4000)
    expect(trimmed.trimmed).toEqual({ fromMs: 2000, toMs: 6000 })
    expect(trimmed.clicks).toEqual([{ t: 2500, button: 'right', x: 45, y: 45, speech: 'two more three' }])
  })

  it('starts the pointer where it was at the cut', () => {
    // The samples are at 50, 150 … ms: the one at 1950 is where the pointer was at 2000
    expect(trimmed.cursor.slice(0, 2)).toEqual([
      [0, 19, 19],
      [50, 20, 20]
    ])
    expect(trimmed.cursor[trimmed.cursor.length - 1]).toEqual([3950, 59, 59])
  })

  it('clamps the speech crossing a boundary and drops what is outside', () => {
    expect(trimmed.transcript).toEqual([
      { start: 0, end: 0.5, text: 'one' },
      { start: 1, end: 3, text: 'two more' },
      { start: 3, end: 4, text: 'three end' }
    ])
    expect(trimmed.words.map((w) => w.text)).toEqual([' two', ' more', ' three'])
  })

  it('drops a word that ends at the cut and keeps an instant one on it', () => {
    const meta = { ...jpgRecording(), words: [{ start: 1.5, end: 2, text: ' before' }, { start: 2, end: 2, text: ' at' }] }
    expect(trimRecordingJson(meta, 2000, 6000).words).toEqual([{ start: 0, end: 0, text: ' at' }])
  })

  it('recomputes the words spoken around each click', () => {
    // At 1000 ms the original click had "one"; trimmed from 900 ms, " one" is clamped but still there
    const near = trimRecordingJson(jpgRecording(), 900, 3000)
    expect(near.clicks[0]).toMatchObject({ t: 100, speech: 'one' })
    // Cut right after " two": it is gone from the trimmed recording, so from the click too
    const meta = { ...jpgRecording(), clicks: [{ t: 3500, button: 'left' as const, x: 0, y: 0, speech: 'two more' }] }
    expect(trimRecordingJson(meta, 3450, 6000).clicks[0].speech).toBe('more')
  })

  it('makes the frame on screen at the cut the first one and renumbers them', () => {
    expect(trimmed.frames).toEqual([
      { file: 'frames/frame_00001.jpg', tMs: 0 },
      { file: 'frames/frame_00002.jpg', tMs: 2000 }
    ])
    expect(keptFrames(jpgRecording().frames!, 2000, 6000).map((f) => f.file)).toEqual(['frames/frame_00002.jpg', 'frames/frame_00003.jpg'])
  })

  it('keeps a frame taken exactly at the cut as the first one', () => {
    expect(keptFrames(jpgRecording().frames!, 1500, 6000).map((f) => f.tMs)).toEqual([1500, 4000])
    expect(keptFrames(jpgRecording().frames!, 0, 4000).map((f) => f.tMs)).toEqual([0, 1500])
  })

  it('counts the identical frames skipped in the part kept', () => {
    // Taken in (2000, 6000): 2500 … 5500, seven; kept: 4000
    expect(trimmed.skippedFrames).toBe(6)
    expect(trimRecordingJson(jpgRecording(), 0, 2000).skippedFrames).toBe(2)
    // Without the count in the original there is nothing honest to say
    expect(trimRecordingJson({ ...jpgRecording(), skippedFrames: undefined }, 2000, 6000).skippedFrames).toBeUndefined()
  })

  it('starts the webcam with the layout it had at the cut', () => {
    const t = trimRecordingJson(videoRecording(), 4000, 9000)
    expect(t.webcam?.video).toBe('recording.mp4')
    expect(t.webcam?.layout.map(({ t, shape, visible }) => ({ t, shape, visible }))).toEqual([
      { t: 0, shape: 'circle', visible: true },
      { t: 3000, shape: 'circle', visible: false }
    ])
    expect(trimRecordingJson(videoRecording(), 1000, 2500).webcam?.layout.map((e) => e.t)).toEqual([0])
    expect(t.frames).toBeUndefined()
  })

  it('gives the same result trimmed twice as trimmed once', () => {
    for (const [a, b, c, d] of [
      [2000, 6000, 1000, 3000],
      [1234, 8765, 0, 5000],
      [1500, 10_000, 2500, 8500],
      [0, 9000, 4000, 9000],
      [333, 7777, 1167, 2667]
    ]) {
      for (const make of [jpgRecording, videoRecording]) {
        const twice = trimRecordingJson(trimRecordingJson(make(), a, b), c, d)
        expect(twice).toEqual(trimRecordingJson(make(), a + c, a + d))
        expect(twice.trimmed).toEqual({ fromMs: a + c, toMs: a + d })
      }
    }
  })

  it('counts skipped frames on a grid that is not whole milliseconds', () => {
    // 3 fps for 10 s: 30 frames taken at round(i * 333.33) ms, one in four kept
    const slots = Array.from({ length: 30 }, (_, i) => Math.round((i * 1000) / 3))
    const frames = slots.filter((_, i) => i % 4 === 0).map((tMs, n) => ({ file: `frames/frame_${String(n + 1).padStart(5, '0')}.jpg`, tMs }))
    const meta = { ...jpgRecording(), fps: 3, frames, skippedFrames: 30 - frames.length }
    const once = trimRecordingJson(meta, 1500, 7400)
    // Taken in (1500, 7400): 1667 … 7333, eighteen; kept: 2667, 4000, 5333, 6667
    expect(once.skippedFrames).toBe(14)
    expect(trimRecordingJson(once, 700, 4000)).toEqual(trimRecordingJson(meta, 2200, 5500))
  })

  it('refuses a part too short, outside the recording, or the whole of it', () => {
    expect(() => trimRecordingJson(jpgRecording(), 2000, 2500)).toThrow(RangeError)
    expect(() => trimRecordingJson(jpgRecording(), -1, 5000)).toThrow(RangeError)
    expect(() => trimRecordingJson(jpgRecording(), 5000, 10_001)).toThrow(RangeError)
    expect(() => trimRecordingJson(jpgRecording(), 0, 10_000)).toThrow(RangeError)
  })
})

describe('trim arguments', () => {
  it('keeps the frame on screen at the cut and cuts the audio with it', () => {
    expect(trimVideoArgs('in.mp4', 'out.mp4', 1500, 4250, 30, ['-c:v', 'libx264'])).toEqual([
      '-noaccurate_seek', '-ss', '1.500', '-i', 'in.mp4', '-t', '2.750',
      '-vf', 'fps=30,trim=start=0,setpts=PTS-STARTPTS',
      '-af', 'atrim=start=0,asetpts=PTS-STARTPTS',
      '-c:v', 'libx264', 'out.mp4'
    ])
    expect(trimAudioArgs('audio.m4a', 'out.m4a', 1500, 4250)).toEqual(['-ss', '1.500', '-i', 'audio.m4a', '-t', '2.750', '-vn', '-c:a', 'aac', '-b:a', '128k', 'out.m4a'])
  })
})
