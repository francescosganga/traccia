// Trimming a recording: what recording.json and ffmpeg get. Kept free of electron imports so it can be tested.
import type { FrameRef, RecordingJson } from '../shared/recording-reader'
import { MIN_TRIM_MS } from '../shared/time'
import { wordsAround } from './timeline'

/** Checks the part to keep against the recording and rounds it to whole ms; throws when there is nothing sensible to keep. */
export function trimRange(meta: Pick<RecordingJson, 'durationMs'>, fromMs: number, toMs: number): { from: number; to: number } {
  const from = Math.round(fromMs)
  const to = Math.round(toMs)
  if (!Number.isFinite(from) || !Number.isFinite(to) || from < 0 || to > meta.durationMs || to - from < MIN_TRIM_MS) {
    throw new RangeError(`cannot keep ${fromMs}-${toMs} ms of a ${meta.durationMs} ms recording`)
  }
  if (from === 0 && to === meta.durationMs) throw new RangeError('nothing to trim')
  return { from, to }
}

/** Seconds kept to the ms, so shifted transcript times do not grow float noise. */
const round3 = (s: number) => Math.round(s * 1000) / 1000

/**
 * Transcript entries (seconds) that overlap the part kept, clamped to it and shifted to its start.
 * One that only touches `from` with its end is dropped; a zero-length one at `from` is kept.
 */
function trimSpans<T extends { start: number; end: number }>(items: T[], from: number, to: number): T[] {
  const a = from / 1000
  const b = to / 1000
  return items
    .filter((s) => s.start < b && (s.end > a || s.start >= a))
    .map((s) => ({ ...s, start: round3(Math.max(s.start, a) - a), end: round3(Math.min(s.end, b) - a) }))
}

/**
 * The frames of a JPG recording that stay, in order: the one on screen at `from` (the last taken
 * at or before it, which becomes the first) and the ones taken after it, before `to`.
 */
export function keptFrames(frames: FrameRef[], fromMs: number, toMs: number): FrameRef[] {
  let first = -1
  for (let i = 0; i < frames.length && frames[i].tMs <= fromMs; i++) first = i
  return frames.filter((f, i) => i === first || (f.tMs > fromMs && f.tMs < toMs))
}

/**
 * Identical frames skipped between `from` and `to`. Frames are taken on a fixed grid (frame i at
 * round(i * 1000 / fps) ms of the original recording) and the skipped ones are the grid points
 * without a file. The grid points of this recording are its first frame (at 0) and then
 * frames.length + skippedFrames - 1 consecutive ones after the start of the part kept by earlier
 * trims. Undefined when the recording does not say how many were skipped.
 */
function skippedFrames(meta: RecordingJson, from: number, to: number): number | undefined {
  if (meta.skippedFrames === undefined || !meta.frames?.length) return undefined
  const frameMs = 1000 / meta.fps
  const offset = meta.trimmed?.fromMs ?? 0
  const points = meta.frames.length + meta.skippedFrames
  let i = Math.floor(offset / frameMs)
  while (Math.round(i * frameMs) <= offset) i++
  let inRange = 0
  for (let n = 1; n < points; n++, i++) {
    const t = Math.round(i * frameMs) - offset
    if (t > from && t < to) inRange++
  }
  return inRange - meta.frames.filter((f) => f.tMs > from && f.tMs < to).length
}

const frameName = (n: number) => `frames/frame_${String(n).padStart(5, '0')}.jpg`

/**
 * recording.json of the part between `fromMs` and `toMs`, with every time shifted to its start.
 * The state at `from` (pointer position, webcam layout, frame on screen) becomes the state at 0;
 * transcript entries crossing a boundary are clamped to it. JPG frames are renumbered from
 * frame_00001.jpg, in the order of keptFrames(). `trimmed` is relative to the original recording,
 * whatever the number of trims.
 */
export function trimRecordingJson(meta: RecordingJson, fromMs: number, toMs: number): RecordingJson {
  const { from, to } = trimRange(meta, fromMs, toMs)
  const inside = (t: number) => t >= from && t <= to

  const cursor = meta.cursor.filter(([t]) => inside(t)).map(([t, x, y]): [number, number, number] => [t - from, x, y])
  const before = meta.cursor.filter(([t]) => t < from).pop()
  if (before && (cursor.length === 0 || cursor[0][0] > 0)) cursor.unshift([0, before[1], before[2]])

  const words = trimSpans(meta.words ?? [], from, to)
  const clicks = meta.clicks
    .filter((c) => inside(c.t))
    .map((c) => ({ ...c, t: c.t - from, speech: wordsAround(words, (c.t - from) / 1000) }))

  const out: RecordingJson = {
    ...meta,
    durationMs: to - from,
    cursor,
    clicks,
    transcript: meta.transcript ? trimSpans(meta.transcript, from, to) : null,
    words,
    trimmed: { fromMs: (meta.trimmed?.fromMs ?? 0) + from, toMs: (meta.trimmed?.fromMs ?? 0) + to }
  }

  if (meta.frames) {
    out.frames = keptFrames(meta.frames, from, to).map((f, i) => ({ file: frameName(i + 1), tMs: Math.max(0, f.tMs - from) }))
    out.skippedFrames = skippedFrames(meta, from, to)
  }

  if (meta.webcam) {
    const layout = meta.webcam.layout
    const atFrom = layout.filter((e) => e.t <= from).pop()
    const later = layout.filter((e) => e.t > from && e.t < to).map((e) => ({ ...e, t: e.t - from }))
    out.webcam = { ...meta.webcam, layout: atFrom ? [{ ...atFrom, t: 0 }, ...later] : later }
  }
  return out
}

const sec = (ms: number) => (ms / 1000).toFixed(3)

/**
 * ffmpeg arguments that cut [from, to) out of a recording.<ext> and encode it again with `codec`.
 * A stream copy would cut at keyframes, and an accurate seek would drop the frame on screen at
 * `from` when the screen had not changed for a while (MediaRecorder writes frames only on change),
 * putting a later picture at 00:00. So the seek keeps what precedes `from` (with negative
 * timestamps), the fps filter holds the last frame over every gap, and the trims drop what comes
 * before 0.
 */
export function trimVideoArgs(input: string, output: string, from: number, to: number, fps: number, codec: string[]): string[] {
  return [
    '-noaccurate_seek', '-ss', sec(from), '-i', input, '-t', sec(to - from),
    '-vf', `fps=${fps},trim=start=0,setpts=PTS-STARTPTS`,
    // Ignored when there is no audio track
    '-af', 'atrim=start=0,asetpts=PTS-STARTPTS',
    ...codec, output
  ]
}

/** ffmpeg arguments that cut [from, to) out of audio.m4a; audio has no gaps, so the default accurate seek is right. */
export function trimAudioArgs(input: string, output: string, from: number, to: number): string[] {
  return ['-ss', sec(from), '-i', input, '-t', sec(to - from), '-vn', '-c:a', 'aac', '-b:a', '128k', output]
}
