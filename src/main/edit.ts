// Editing a recording: what recording.json and ffmpeg get. Kept free of electron imports so it can be tested.
import { checkParts, keptDuration, type EditPart } from '../shared/edit-list'
import type { FrameRef, MsRange, RecordingJson } from '../shared/recording-reader'
import type { TranscriptSegment, TranscriptWord } from '../shared/types'
import { compactLayout, type WebcamLayout, type WebcamLayoutEvent } from '../shared/webcam'
import { placeLayout } from './compose'
import { wordsAround } from './timeline'

/** A stretch of the recording as it is now (ms), and where it starts in the result. */
export interface Segment {
  from: number
  to: number
  at: number
}

/** The parts kept, in the order they play; side by side ones that continue each other in the recording are one. */
export function keptSegments(parts: EditPart[]): Segment[] {
  const out: Segment[] = []
  let at = 0
  for (const p of parts) {
    if (p.removed) continue
    const last = out[out.length - 1]
    if (last && last.to === p.from) last.to = p.to
    else out.push({ from: p.from, to: p.to, at })
    at += p.to - p.from
  }
  return out
}

/** Seconds kept to the ms, so shifted transcript times do not grow float noise. */
const round3 = (s: number) => Math.round(s * 1000) / 1000

interface Span {
  start: number
  end: number
}

/** A transcript entry (seconds) is in [a, b): one that only touches a with its end is not, an instant one at a is. */
const overlaps = (x: Span, a: number, b: number) => x.start < b && (x.end > a || x.start >= a)

/** Sorted, with the ranges that overlap or touch made one. */
function mergeRanges(ranges: MsRange[]): MsRange[] {
  const out: MsRange[] = []
  for (const r of [...ranges].sort((a, b) => a.fromMs - b.fromMs)) {
    const last = out[out.length - 1]
    if (last && r.fromMs <= last.toMs) last.toMs = Math.max(last.toMs, r.toMs)
    else out.push({ ...r })
  }
  return out
}

/**
 * Where each instant goes in the result: the segments are half-open, so an instant at a cut
 * belongs to what follows it; the one at the very end of the recording stays only if the
 * segment holding it also ends the result. Null when the instant is cut out.
 */
function placer(segments: Segment[], durationMs: number): (t: number) => number | null {
  const last = segments[segments.length - 1]
  return (t) => {
    for (const s of segments) if (t >= s.from && t < s.to) return s.at + t - s.from
    return t === durationMs && last.to === durationMs ? last.at + last.to - last.from : null
  }
}

/** The pointer in each segment, starting where it was at the start of the segment. */
function cutCursor(cursor: [number, number, number][], segments: Segment[], durationMs: number): [number, number, number][] {
  const out: [number, number, number][] = []
  const last = segments[segments.length - 1]
  for (const s of segments) {
    const closed = s === last && s.to === durationMs
    const inside = cursor.filter(([t]) => t >= s.from && (t < s.to || (closed && t === s.to)))
    if (!inside.length || inside[0][0] > s.from) {
      const before = cursor.filter(([t]) => t < s.from).pop()
      if (before) out.push([s.at, before[1], before[2]])
    }
    for (const [t, x, y] of inside) out.push([s.at + t - s.from, x, y])
  }
  return out
}

/** The entries in each segment, clamped to it and moved where it plays. */
function cutSpans<T extends Span>(items: T[], segments: Segment[]): T[] {
  const out: T[] = []
  for (const s of segments) {
    const a = s.from / 1000
    const b = s.to / 1000
    const at = s.at / 1000
    for (const x of items) if (overlaps(x, a, b)) out.push({ ...x, start: round3(Math.max(x.start, a) - a + at), end: round3(Math.min(x.end, b) - a + at) })
  }
  return out.sort((p, q) => p.start - q.start)
}

/** The words each phrase was made of: whisper-worker joins them with spaces, a word goes to the first phrase that holds it. */
function wordsOfPhrases(phrases: Span[], words: TranscriptWord[]): TranscriptWord[][] {
  let j = 0
  return phrases.map((p) => {
    const mine: TranscriptWord[] = []
    while (j < words.length && words[j].start < p.start) j++
    while (j < words.length && words[j].start <= p.end && words[j].end <= p.end) mine.push(words[j++])
    return mine
  })
}

/**
 * The phrases in each segment. With word timestamps a phrase keeps only the words in the segment,
 * so its text says what is left of it (none left: the phrase is gone); without, it is clamped.
 */
function cutPhrases(phrases: TranscriptSegment[], words: TranscriptWord[], hasWords: boolean, segments: Segment[]): TranscriptSegment[] {
  if (!hasWords) return cutSpans(phrases, segments)
  const groups = wordsOfPhrases(phrases, words)
  const out: TranscriptSegment[] = []
  for (const s of segments) {
    const a = s.from / 1000
    const b = s.to / 1000
    const at = s.at / 1000
    for (const group of groups) {
      const inside = group.filter((w) => overlaps(w, a, b))
      if (!inside.length) continue
      out.push({
        start: round3(Math.max(Math.min(...inside.map((w) => w.start)), a) - a + at),
        end: round3(Math.min(Math.max(...inside.map((w) => w.end)), b) - a + at),
        text: inside.map((w) => w.text.trim()).join(' ')
      })
    }
  }
  return out.sort((p, q) => p.start - q.start)
}

/** Ranges of the recording where they play in the result, those that end up touching made one. */
function cutRanges(ranges: MsRange[], segments: Segment[]): MsRange[] {
  const out: MsRange[] = []
  for (const s of segments) {
    for (const r of ranges) {
      const from = Math.max(r.fromMs, s.from)
      const to = Math.min(r.toMs, s.to)
      if (from < to) out.push({ fromMs: s.at + from - s.from, toMs: s.at + to - s.from })
    }
  }
  return mergeRanges(out)
}

/**
 * The frames of a JPG recording in the result, in order: in each segment the one on screen at its
 * start (the last taken at or before it), unless it is already the one showing, then the ones
 * taken inside it. `frame` is the source, `tMs` its time in the result.
 */
export function keptFrames(frames: FrameRef[], segments: Segment[]): { frame: FrameRef; tMs: number }[] {
  const out: { frame: FrameRef; tMs: number }[] = []
  for (const s of segments) {
    let first = -1
    for (let i = 0; i < frames.length && frames[i].tMs <= s.from; i++) first = i
    if (first >= 0 && out[out.length - 1]?.frame !== frames[first]) out.push({ frame: frames[first], tMs: s.at })
    for (const f of frames) if (f.tMs > s.from && f.tMs < s.to) out.push({ frame: f, tMs: s.at + f.tMs - s.from })
  }
  return out
}

/** The parts of the original recording the current one is made of, in the order they play. */
export const originalKept = (meta: RecordingJson): MsRange[] => meta.edited?.kept ?? (meta.trimmed ? [meta.trimmed] : [{ fromMs: 0, toMs: meta.durationMs }])

/** originalKept(), each part with where it starts now. */
function originalPieces(meta: RecordingJson): Segment[] {
  let at = 0
  return originalKept(meta).map(({ fromMs, toMs }) => {
    const p = { from: fromMs, to: toMs, at }
    at += toMs - fromMs
    return p
  })
}

/** The segments as parts of the original recording, in the order they play; those that continue each other are one. */
function keptOfOriginal(meta: RecordingJson, segments: Segment[]): MsRange[] {
  const pieces = originalPieces(meta)
  const out: MsRange[] = []
  for (const s of segments) {
    for (const p of pieces) {
      const a = Math.max(s.from, p.at)
      const b = Math.min(s.to, p.at + p.to - p.from)
      if (a >= b) continue
      const fromMs = p.from + a - p.at
      const last = out[out.length - 1]
      if (last && last.toMs === fromMs) last.toMs = p.from + b - p.at
      else out.push({ fromMs, toMs: p.from + b - p.at })
    }
  }
  return out
}

/**
 * Identical frames skipped in the segments. Frames are taken on a fixed grid (frame k at
 * round(k * 1000 / fps) ms of the original recording) and the skipped ones are the grid points
 * without a file. The current recording holds the grid points strictly inside each of its parts
 * of the original (its frames at the start of a part are the frame on screen there, not grid
 * points); counting them from the start of the grid until there are as many as it says, gives
 * the grid it really has. Undefined when the recording does not say how many were skipped.
 */
function skippedFrames(meta: RecordingJson, segments: Segment[]): number | undefined {
  if (meta.skippedFrames === undefined || !meta.frames?.length) return undefined
  const frameMs = 1000 / meta.fps
  const pieces = originalPieces(meta)
  const starts = new Set(pieces.map((p) => p.at))
  let left = meta.frames.length + meta.skippedFrames - meta.frames.filter((f) => starts.has(f.tMs)).length
  const end = Math.max(...pieces.map((p) => p.to))
  const points: number[] = []
  for (let k = 0; left > 0; k++) {
    const g = Math.round(k * frameMs)
    if (g >= end) break
    const p = pieces.find((p) => g > p.from && g < p.to)
    if (!p) continue
    points.push(p.at + g - p.from)
    left--
  }
  const files = new Set(meta.frames.map((f) => f.tMs))
  return points.filter((t) => !files.has(t) && segments.some((s) => t > s.from && t < s.to)).length
}

const frameName = (n: number) => `frames/frame_${String(n).padStart(5, '0')}.jpg`

/** The layout at `t`: the last change at or before it. */
const layoutAt = <T extends WebcamLayoutEvent>(layout: T[], t: number): T | undefined => layout.filter((e) => e.t <= t).pop()

/** The recorded layout with each part's own one in its place; the recorded one resumes after it. */
export function overrideLayout(layout: WebcamLayoutEvent[], overrides: { from: number; to: number; layout: WebcamLayout }[], durationMs: number): WebcamLayoutEvent[] {
  let events = compactLayout(layout)
  for (const o of [...overrides].sort((a, b) => a.from - b.from)) {
    const resume = layoutAt(events, o.to)
    events = [
      ...events.filter((e) => e.t < o.from),
      { ...o.layout, t: o.from },
      ...(resume && o.to < durationMs ? [{ ...resume, t: o.to }] : []),
      ...events.filter((e) => e.t > o.to)
    ]
  }
  return compactLayout(events)
}

/** The layout in each segment, starting with the one it had at the start of the segment. */
function cutLayout(layout: WebcamLayoutEvent[], segments: Segment[]): WebcamLayoutEvent[] {
  const out: WebcamLayoutEvent[] = []
  for (const s of segments) {
    const atFrom = layoutAt(layout, s.from)
    if (atFrom) out.push({ ...atFrom, t: s.at })
    for (const e of layout) if (e.t > s.from && e.t < s.to) out.push({ ...e, t: s.at + e.t - s.from })
  }
  return compactLayout(out)
}

/** Where the edit hides the webcam, in ms of the result: what a recording without its webcam track can still do. */
export function hiddenByEdit(parts: EditPart[]): MsRange[] {
  const out: MsRange[] = []
  let at = 0
  for (const p of parts) {
    if (p.removed) continue
    if (p.webcam && !p.webcam.visible) out.push({ fromMs: at, toMs: at + p.to - p.from })
    at += p.to - p.from
  }
  return mergeRanges(out)
}

/**
 * recording.json after the edit: the parts kept, in their order, each instant moved where it
 * plays. At the start of each part the state of that instant holds (pointer position, webcam
 * layout, frame on screen); transcript entries crossing a cut are clamped to it. The audio
 * silenced takes its words with it. JPG frames are renumbered from frame_00001.jpg in the order
 * of keptFrames(). `edited` is relative to the original recording, whatever the number of edits.
 */
export function editRecordingJson(meta: RecordingJson, input: EditPart[]): RecordingJson {
  const parts = checkParts(input, meta.durationMs)
  const segments = keptSegments(parts)
  const place = placer(segments, meta.durationMs)
  const kept = parts.filter((p) => !p.removed)

  const muted = mergeRanges([...(meta.muted ?? []), ...kept.filter((p) => p.muted).map((p) => ({ fromMs: p.from, toMs: p.to }))])
  const heard = (x: Span) => !muted.some((m) => overlaps(x, m.fromMs / 1000, m.toMs / 1000))
  const sourceWords = (meta.words ?? []).filter(heard)
  const hasWords = (meta.words ?? []).length > 0
  const words = cutSpans(sourceWords, segments)
  const transcript = meta.transcript ? cutPhrases(hasWords ? meta.transcript : meta.transcript.filter(heard), sourceWords, hasWords, segments) : null
  const clicks = meta.clicks
    .flatMap((c) => {
      const t = place(c.t)
      return t === null ? [] : [{ ...c, t }]
    })
    .sort((a, b) => a.t - b.t)
    .map((c) => ({ ...c, speech: wordsAround(words, c.t / 1000) }))

  const out: RecordingJson = {
    ...meta,
    durationMs: keptDuration(parts),
    cursor: cutCursor(meta.cursor, segments, meta.durationMs),
    clicks,
    transcript,
    words,
    edited: { kept: keptOfOriginal(meta, segments) }
  }
  delete out.trimmed
  const mutedAfter = cutRanges(muted, segments)
  if (mutedAfter.length) out.muted = mutedAfter
  else delete out.muted

  if (meta.frames) {
    out.frames = keptFrames(meta.frames, segments).map((f, i) => ({ file: frameName(i + 1), tMs: f.tMs }))
    out.skippedFrames = skippedFrames(meta, segments)
  }

  if (meta.webcam) {
    const overrides = kept.flatMap((p) => (p.webcam ? [{ from: p.from, to: p.to, layout: p.webcam }] : []))
    const layout = cutLayout(overrideLayout(meta.webcam.layout, overrides, meta.durationMs), segments)
    out.webcam = { ...meta.webcam, layout: placeLayout(layout, meta.width, meta.height) }
  }
  return out
}

// ---- ffmpeg ---------------------------------------------------------------------------

const sec = (ms: number) => (ms / 1000).toFixed(3)

/** A stretch of a media file, ms of its own time; `from` below 0 is a stretch that starts before the file does. */
export interface Cut {
  input: string
  from: number
  to: number
}

export interface JoinOptions {
  /** ffmpeg index of the first input */
  first: number
  fps: number
  /** Join the video, the audio, or both */
  video: boolean
  audio: boolean
  /** Prefix of the labels of the result: [<label>v] and [<label>a] */
  label: string
}

/**
 * Inputs and filter graph that play the cuts one after the other. A stream copy would cut at
 * keyframes, and an accurate seek would drop the frame on screen at the cut when the screen had
 * not changed for a while (MediaRecorder writes frames only on change), putting a later picture
 * there. So each cut seeks without accuracy (what precedes it keeps negative timestamps), the
 * fps filter holds the last frame over every gap and tpad past the end of the video, and the
 * trims keep exactly the cut; the audio is cut the same way and padded with silence. Every
 * piece is then exactly as long as its cut, so the concat keeps picture and sound in step at
 * each join, as long as the cuts are on the frames (snapToFrame). A cut that starts before its
 * file (a webcam that started after the screen) begins with its first frame held.
 */
export function joinGraph(cuts: Cut[], { first, fps, video, audio, label }: JoinOptions): { inputs: string[]; graph: string } {
  const inputs: string[] = []
  const graph: string[] = []
  let pieces = ''
  cuts.forEach((c, j) => {
    const i = first + j
    const d = sec(c.to - c.from)
    inputs.push(...(c.from > 0 ? ['-noaccurate_seek', '-ss', sec(c.from)] : []), '-i', c.input)
    if (video) {
      const delay = c.from < 0 ? `start_mode=clone:start_duration=${sec(-c.from)}:` : ''
      graph.push(`[${i}:v]fps=${fps},tpad=${delay}stop=-1:stop_mode=clone,trim=start=0:end=${d},setpts=PTS-STARTPTS[${label}v${j}]`)
      pieces += `[${label}v${j}]`
    }
    if (audio) {
      graph.push(`[${i}:a]atrim=start=0:end=${d},asetpts=PTS-STARTPTS,apad=whole_dur=${d}[${label}a${j}]`)
      pieces += `[${label}a${j}]`
    }
  })
  const outs = (video ? `[${label}v]` : '') + (audio ? `[${label}a]` : '')
  graph.push(`${pieces}concat=n=${cuts.length}:v=${video ? 1 : 0}:a=${audio ? 1 : 0}${outs}`)
  return { inputs, graph: graph.join(';') }
}

/** Audio filter that silences the ranges (ms of the result), to the sample. */
export function muteFilter(ranges: MsRange[]): string {
  const off = ranges.map((r) => `(1-between(t,${sec(r.fromMs)},${sec(r.toMs)}))`).join('*')
  return `aeval=exprs='val(ch)*${off}':channel_layout=same`
}

/** Expression true while one of the ranges (ms) plays, for a filter's enable option. */
export const during = (ranges: MsRange[]): string => ranges.map((r) => `between(t,${sec(r.fromMs)},${sec(r.toMs)})`).join('+')

/** ffmpeg arguments for a JPEG of the frame on screen at `t`, `height` pixels high, on stdout; the seek is the one of joinGraph. */
export function thumbnailArgs(input: string, t: number, fps: number, height: number): string[] {
  return [
    '-noaccurate_seek', '-ss', sec(t), '-i', input, '-an',
    '-vf', `fps=${fps},trim=start=0,scale=-2:${height}`,
    '-frames:v', '1', '-q:v', '5', '-f', 'image2pipe', '-c:v', 'mjpeg', 'pipe:1'
  ]
}
