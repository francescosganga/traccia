import { describe, expect, it } from 'vitest'
import type { EditPart } from '../shared/edit-list'
import type { RecordingJson } from '../shared/recording-reader'
import { editRecordingJson, joinGraph, keptFrames, keptSegments, muteFilter, overrideLayout } from './edit'

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
      { start: 0.5, end: 1, text: 'one' },
      { start: 3, end: 4.9, text: 'two more' },
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
      ],
      track: { file: 'webcam.webm', offsetMs: 40 }
    }
  }
}

/** The parts that keep `ranges` in that order and cut out the rest. */
function keeping(meta: RecordingJson, ...ranges: [number, number][]): EditPart[] {
  const kept: EditPart[] = ranges.map(([from, to]) => ({ from, to }))
  const cuts = [0, ...ranges.flat().sort((a, b) => a - b), meta.durationMs]
  const removed: EditPart[] = []
  for (let i = 0; i < cuts.length; i += 2) if (cuts[i] < cuts[i + 1]) removed.push({ from: cuts[i], to: cuts[i + 1], removed: true })
  return [...kept, ...removed]
}

const edit = (meta: RecordingJson, ...ranges: [number, number][]) => editRecordingJson(meta, keeping(meta, ...ranges))

describe('editRecordingJson: one part kept', () => {
  const trimmed = edit(jpgRecording(), [2000, 6000])

  it('keeps the part, moved to the start', () => {
    expect(trimmed.durationMs).toBe(4000)
    expect(trimmed.edited).toEqual({ kept: [{ fromMs: 2000, toMs: 6000 }] })
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

  it('keeps of each phrase the words left, and drops what is outside', () => {
    expect(trimmed.transcript).toEqual([
      { start: 1, end: 2.9, text: 'two more' },
      { start: 3, end: 3.5, text: 'three' }
    ])
    expect(trimmed.words.map((w) => w.text)).toEqual([' two', ' more', ' three'])
    // Without word timestamps a phrase can only be clamped
    const noWords = edit({ ...jpgRecording(), words: [] }, [2000, 6000])
    expect(noWords.transcript).toEqual([
      { start: 1, end: 2.9, text: 'two more' },
      { start: 3, end: 4, text: 'three end' }
    ])
  })

  it('drops a word that ends at the cut and keeps an instant one on it', () => {
    const meta = { ...jpgRecording(), words: [{ start: 1.5, end: 2, text: ' before' }, { start: 2, end: 2, text: ' at' }] }
    expect(edit(meta, [2000, 6000]).words).toEqual([{ start: 0, end: 0, text: ' at' }])
  })

  it('recomputes the words spoken around each click', () => {
    // At 1000 ms the original click had "one"; trimmed from 900 ms, " one" is clamped but still there
    expect(edit(jpgRecording(), [900, 3000]).clicks[0]).toMatchObject({ t: 100, speech: 'one' })
    // Cut right after " two": it is gone from the result, so from the click too
    const meta = { ...jpgRecording(), clicks: [{ t: 3500, button: 'left' as const, x: 0, y: 0, speech: 'two more' }] }
    expect(edit(meta, [3450, 6000]).clicks[0].speech).toBe('more')
  })

  it('makes the frame on screen at the cut the first one and renumbers them', () => {
    expect(trimmed.frames).toEqual([
      { file: 'frames/frame_00001.jpg', tMs: 0 },
      { file: 'frames/frame_00002.jpg', tMs: 2000 }
    ])
    const segments = keptSegments(keeping(jpgRecording(), [2000, 6000]))
    expect(keptFrames(jpgRecording().frames!, segments).map((f) => f.frame.file)).toEqual(['frames/frame_00002.jpg', 'frames/frame_00003.jpg'])
    // A frame taken exactly at the cut is the first one
    expect(edit(jpgRecording(), [1500, 6000]).frames!.map((f) => f.tMs)).toEqual([0, 2500])
  })

  it('counts the identical frames skipped in the part kept', () => {
    // Taken in (2000, 6000): 2500 … 5500, seven; kept: 4000
    expect(trimmed.skippedFrames).toBe(6)
    expect(edit(jpgRecording(), [0, 2000]).skippedFrames).toBe(2)
    // Without the count in the original there is nothing honest to say
    expect(edit({ ...jpgRecording(), skippedFrames: undefined }, [2000, 6000]).skippedFrames).toBeUndefined()
  })

  it('starts the webcam with the layout it had at the cut', () => {
    const t = edit(videoRecording(), [4000, 9000])
    expect(t.webcam?.video).toBe('recording.mp4')
    expect(t.webcam?.track).toEqual({ file: 'webcam.webm', offsetMs: 40 })
    expect(t.webcam?.layout.map(({ t, shape, visible }) => ({ t, shape, visible }))).toEqual([
      { t: 0, shape: 'circle', visible: true },
      { t: 3000, shape: 'circle', visible: false }
    ])
    expect(edit(videoRecording(), [1000, 2500]).webcam?.layout.map((e) => e.t)).toEqual([0])
    expect(t.frames).toBeUndefined()
  })

  it('reads the part kept by the first editor, which only trimmed', () => {
    const old = { ...edit(jpgRecording(), [2000, 6000]), edited: undefined, trimmed: { fromMs: 2000, toMs: 6000 } }
    const again = edit(old, [1000, 3000])
    expect(again.edited).toEqual({ kept: [{ fromMs: 3000, toMs: 5000 }] })
    expect(again.trimmed).toBeUndefined()
  })

  it('refuses parts that do not cover the recording, or a result too short', () => {
    expect(() => edit(jpgRecording(), [2000, 2500])).toThrow(RangeError)
    expect(() => editRecordingJson(jpgRecording(), [{ from: 0, to: 9000 }])).toThrow(RangeError)
    expect(() => editRecordingJson(jpgRecording(), [{ from: 0, to: 10_000 }])).toThrow(RangeError)
  })
})

describe('editRecordingJson: parts moved and cut', () => {
  // The last 4 s first, then the first 2 s; 2-6 s cut out
  const moved = edit(jpgRecording(), [6000, 10_000], [0, 2000])

  it('plays the parts in their order', () => {
    expect(moved.durationMs).toBe(6000)
    expect(moved.edited).toEqual({
      kept: [
        { fromMs: 6000, toMs: 10_000 },
        { fromMs: 0, toMs: 2000 }
      ]
    })
    expect(moved.clicks.map(({ t, x }) => [t, x])).toEqual([
      [3000, 90],
      [5000, 10]
    ])
  })

  it('starts each part with the pointer where it was', () => {
    // The pointer at 6000 is the sample at 5950; at the join (4000) the one before 0 does not exist
    expect(moved.cursor[0]).toEqual([0, 59, 59])
    const join = moved.cursor.findIndex(([t]) => t >= 4000)
    expect(moved.cursor.slice(join - 1, join + 1)).toEqual([
      [3950, 99, 99],
      [4050, 0, 0]
    ])
    // The one carried to 0, 40 from 6050 to 9950, 20 from 50 to 1950
    expect(moved.cursor.length).toBe(61)
  })

  it('keeps of a phrase cut by a part the words in it', () => {
    // "three end" (5-9 s) starts before the part that begins at 6 s: only " end" (8.5-9 s) is in it
    expect(moved.transcript).toEqual([
      { start: 2.5, end: 3, text: 'end' },
      { start: 4.5, end: 5, text: 'one' }
    ])
    expect(edit(jpgRecording(), [5600, 9000]).transcript).toEqual([{ start: 2.9, end: 3.4, text: 'end' }])
    // A word cut in two keeps its piece, like the phrase
    expect(edit(jpgRecording(), [5200, 9000]).transcript).toEqual([{ start: 0, end: 3.8, text: 'three end' }])
  })

  it('gives each part the frame on screen at its start, once', () => {
    expect(moved.frames).toEqual([
      { file: 'frames/frame_00001.jpg', tMs: 0 },
      { file: 'frames/frame_00002.jpg', tMs: 2000 },
      { file: 'frames/frame_00003.jpg', tMs: 4000 },
      { file: 'frames/frame_00004.jpg', tMs: 5500 }
    ])
    const sources = keptFrames(jpgRecording().frames!, keptSegments(keeping(jpgRecording(), [6000, 10_000], [0, 2000])))
    expect(sources.map((f) => f.frame.tMs)).toEqual([4000, 8000, 0, 1500])
    // Two parts with the same frame on screen across the join: it is not repeated
    const still = edit(jpgRecording(), [4500, 5500], [6000, 7000])
    expect(still.frames).toEqual([{ file: 'frames/frame_00001.jpg', tMs: 0 }])
  })

  it('counts the frames skipped in every part', () => {
    // (6000, 10000): 6500 … 9500, seven, kept 8000; (0, 2000): 500 … 1500, three, kept 1500
    expect(moved.skippedFrames).toBe(8)
  })

  it('carries the webcam layout of each part', () => {
    const v = edit(videoRecording(), [6000, 10_000], [0, 2000])
    expect(v.webcam?.layout.map(({ t, shape, visible }) => ({ t, shape, visible }))).toEqual([
      { t: 0, shape: 'circle', visible: true },
      { t: 1000, shape: 'circle', visible: false },
      { t: 4000, shape: 'square', visible: true }
    ])
  })
})

describe('editRecordingJson: audio and webcam', () => {
  it('silences a part and drops what was said in it', () => {
    const parts: EditPart[] = [
      { from: 0, to: 3000 },
      { from: 3000, to: 5000, muted: true },
      { from: 5000, to: 10_000 }
    ]
    const out = editRecordingJson(jpgRecording(), parts)
    expect(out.durationMs).toBe(10_000)
    expect(out.muted).toEqual([{ fromMs: 3000, toMs: 5000 }])
    expect(out.words.map((w) => w.text)).toEqual([' one', ' three', ' end'])
    expect(out.transcript!.map((s) => s.text)).toEqual(['one', 'three end'])
    // The click at 4.5 s had "two more three"; what is left is the word said after the silence
    expect(out.clicks[1].speech).toBe('three')
    // Silenced once more elsewhere: both ranges stay, those touching are one
    const twice = editRecordingJson(out, [
      { from: 0, to: 5000 },
      { from: 5000, to: 6000, muted: true },
      { from: 6000, to: 10_000 }
    ])
    expect(twice.muted).toEqual([{ fromMs: 3000, toMs: 6000 }])
    // A cut moves the silenced ranges with the rest
    expect(edit(out, [4000, 10_000]).muted).toEqual([{ fromMs: 0, toMs: 1000 }])
    expect(edit(out, [5000, 10_000]).muted).toBeUndefined()
  })

  it('without word timestamps drops the phrases touched by the silence', () => {
    const out = editRecordingJson({ ...jpgRecording(), words: [] }, [
      { from: 0, to: 4000, muted: true },
      { from: 4000, to: 10_000 }
    ])
    expect(out.transcript!.map((s) => s.text)).toEqual(['three end'])
  })

  it('lays each part its own webcam layout, then the recorded one resumes', () => {
    const hidden = { shape: 'circle' as const, corner: 'top-left' as const, visible: false }
    const out = editRecordingJson(videoRecording(), [
      { from: 0, to: 4000 },
      { from: 4000, to: 6000, webcam: hidden },
      { from: 6000, to: 10_000 }
    ])
    expect(out.durationMs).toBe(10_000)
    expect(out.webcam?.layout.map(({ t, shape, visible }) => ({ t, shape, visible }))).toEqual([
      { t: 0, shape: 'square', visible: true },
      { t: 3000, shape: 'circle', visible: true },
      { t: 4000, shape: 'circle', visible: false },
      { t: 6000, shape: 'circle', visible: true },
      { t: 7000, shape: 'circle', visible: false }
    ])
    // A new shape and corner get their rectangle in the output
    const moved = editRecordingJson(videoRecording(), [
      { from: 0, to: 2000, webcam: { shape: 'rectangle', corner: 'top-right', visible: true } },
      { from: 2000, to: 10_000 }
    ])
    expect(moved.webcam?.layout[0]).toMatchObject({ t: 0, shape: 'rectangle', corner: 'top-right', rect: { x: 504, y: 18, width: 278, height: 156 } })
    expect(moved.webcam?.layout[1]).toMatchObject({ t: 2000, shape: 'square', corner: 'bottom-right' })
  })

  it('overrides the layout up to the end of the recording', () => {
    const layout = videoRecording().webcam!.layout
    expect(overrideLayout(layout, [{ from: 8000, to: 10_000, layout: { shape: 'square', corner: 'top-right', visible: true } }], 10_000).map((e) => e.t)).toEqual([0, 3000, 7000, 8000])
  })
})

describe('editRecordingJson: twice equals once', () => {
  /** The parts that, on the original, do what `second` does on the result of `first`. */
  function composed(meta: RecordingJson, first: [number, number][], second: [number, number][]): EditPart[] {
    const twice = edit(edit(meta, ...first), ...second)
    return keeping(meta, ...twice.edited!.kept.map((r): [number, number] => [r.fromMs, r.toMs]))
  }

  const cases: [number, number][][][] = [
    [[[2000, 6000]], [[1000, 3000]]],
    [[[1234, 8765]], [[0, 5000]]],
    [[[1500, 10_000]], [[2500, 8500]]],
    [[[0, 9000]], [[4000, 9000]]],
    [[[333, 7777]], [[1167, 2667]]],
    [[[6000, 10_000], [0, 2000]], [[3000, 5000], [500, 2500]]],
    [[[0, 3000], [5000, 10_000]], [[2000, 6000]]],
    [[[5000, 10_000], [0, 4000]], [[4500, 9000], [0, 1000]]],
    [[[0, 2500], [7000, 10_000], [4000, 6000]], [[2000, 7500]]]
  ]

  it('gives the same result edited twice as edited once', () => {
    for (const [first, second] of cases) {
      for (const make of [jpgRecording, videoRecording]) {
        const twice = edit(edit(make(), ...first), ...second)
        expect(twice).toEqual(editRecordingJson(make(), composed(make(), first, second)))
      }
    }
  })

  it('counts skipped frames on a grid that is not whole milliseconds', () => {
    // 3 fps for 10 s: 30 frames taken at round(i * 333.33) ms, one in four kept
    const slots = Array.from({ length: 30 }, (_, i) => Math.round((i * 1000) / 3))
    const frames = slots.filter((_, i) => i % 4 === 0).map((tMs, n) => ({ file: `frames/frame_${String(n + 1).padStart(5, '0')}.jpg`, tMs }))
    const meta = { ...jpgRecording(), fps: 3, frames, skippedFrames: 30 - frames.length }
    const once = edit(meta, [1500, 7400])
    // Taken in (1500, 7400): 1667 … 7333, eighteen; kept: 2667, 4000, 5333, 6667
    expect(once.skippedFrames).toBe(14)
    expect(edit(once, [700, 4000])).toEqual(edit(meta, [2200, 5500]))
    const moved = edit(meta, [6000, 10_000], [1000, 4000])
    expect(edit(moved, [3000, 6000])).toEqual(editRecordingJson(meta, composed(meta, [[6000, 10_000], [1000, 4000]], [[3000, 6000]])))
  })
})

describe('ffmpeg arguments', () => {
  it('plays the cuts one after the other, the frame on screen held and the sound padded', () => {
    const { inputs, graph } = joinGraph(
      [
        { input: 'in.mp4', from: 6000, to: 8000 },
        { input: 'in.mp4', from: 0, to: 1500 }
      ],
      { first: 0, fps: 30, video: true, audio: true, label: 's' }
    )
    expect(inputs).toEqual(['-noaccurate_seek', '-ss', '6.000', '-i', 'in.mp4', '-i', 'in.mp4'])
    expect(graph.split(';')).toEqual([
      '[0:v]fps=30,tpad=stop=-1:stop_mode=clone,trim=start=0:end=2.000,setpts=PTS-STARTPTS[sv0]',
      '[0:a]atrim=start=0:end=2.000,asetpts=PTS-STARTPTS,apad=whole_dur=2.000[sa0]',
      '[1:v]fps=30,tpad=stop=-1:stop_mode=clone,trim=start=0:end=1.500,setpts=PTS-STARTPTS[sv1]',
      '[1:a]atrim=start=0:end=1.500,asetpts=PTS-STARTPTS,apad=whole_dur=1.500[sa1]',
      '[sv0][sa0][sv1][sa1]concat=n=2:v=1:a=1[sv][sa]'
    ])
  })

  it('holds the first frame of a webcam that started after the screen', () => {
    const { inputs, graph } = joinGraph([{ input: 'webcam.webm', from: -40, to: 960 }], { first: 2, fps: 30, video: true, audio: false, label: 'w' })
    expect(inputs).toEqual(['-i', 'webcam.webm'])
    expect(graph).toBe('[2:v]fps=30,tpad=start_mode=clone:start_duration=0.040:stop=-1:stop_mode=clone,trim=start=0:end=1.000,setpts=PTS-STARTPTS[wv0];[wv0]concat=n=1:v=1:a=0[wv]')
  })

  it('silences the ranges to the sample', () => {
    expect(muteFilter([{ fromMs: 400, toMs: 700 }, { fromMs: 2000, toMs: 2500 }])).toBe(
      "aeval=exprs='val(ch)*(1-between(t,0.400,0.700))*(1-between(t,2.000,2.500))':channel_layout=same"
    )
  })
})
