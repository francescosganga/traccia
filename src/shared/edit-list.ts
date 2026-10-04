// The editor's edit list: the recording cut into parts, in the order they play. No Node imports:
// the renderer edits it, the main process checks it and applies it.
import { WEBCAM_CORNERS, WEBCAM_SHAPES, type WebcamLayout } from './webcam'

/** A stretch of the recording as it is now, and what the edit does with it. */
export interface EditPart {
  /** ms of the recording; together the parts cover all of it, each instant once */
  from: number
  to: number
  /** Cut out of the result */
  removed?: boolean
  /** Silenced, with the speech in it dropped from the transcript */
  muted?: boolean
  /** The webcam over this part, instead of the one recorded */
  webcam?: WebcamLayout
}

/** The shortest part a split or a dragged boundary may leave. */
export const MIN_PART_MS = 100
/** The shortest result an edit may leave. */
export const MIN_RESULT_MS = 1000

const length = (p: EditPart) => p.to - p.from

export const wholeRecording = (durationMs: number): EditPart[] => [{ from: 0, to: durationMs }]

/** Where each part starts on the editor's axis, which has the parts side by side in their order. */
export function partStarts(parts: EditPart[]): number[] {
  const starts: number[] = []
  let at = 0
  for (const p of parts) {
    starts.push(at)
    at += length(p)
  }
  return starts
}

/** The part at `ms` of the axis: where two touch, the one that starts there; at the very end, the last. */
export function partAt(parts: EditPart[], ms: number): number {
  let end = 0
  for (let i = 0; i < parts.length; i++) {
    end += length(parts[i])
    if (ms < end) return i
  }
  return parts.length - 1
}

/** The instant of the recording shown at `ms` of the axis. */
export function toSource(parts: EditPart[], ms: number): number {
  const i = partAt(parts, ms)
  const p = parts[i]
  return Math.max(p.from, Math.min(p.to, p.from + ms - partStarts(parts)[i]))
}

/** Where an instant of the recording is on the axis. */
export function toAxis(parts: EditPart[], sourceMs: number): number {
  let at = 0
  let end = 0
  for (const p of parts) {
    if (sourceMs >= p.from && sourceMs < p.to) return at + sourceMs - p.from
    // The very end of the recording belongs to no part: it is where the last part of it ends
    if (sourceMs === p.to) end = at + length(p)
    at += length(p)
  }
  return end
}

/** Drops what is off, so that equal parts compare equal. */
function tidy(p: EditPart): EditPart {
  const out: EditPart = { from: p.from, to: p.to }
  if (p.removed) out.removed = true
  if (p.muted) out.muted = true
  if (p.webcam) out.webcam = p.webcam
  return out
}

/**
 * Splits the part under `ms` of the axis at that instant (moved by `snap`, if given, onto the
 * frames of a video); null when it is too close to one of the ends of the part.
 */
export function splitAt(parts: EditPart[], ms: number, snap?: (sourceMs: number) => number): EditPart[] | null {
  const i = partAt(parts, ms)
  const p = parts[i]
  const at = toSource(parts, ms)
  const s = Math.round(snap ? snap(at) : at)
  if (s - p.from < MIN_PART_MS || p.to - s < MIN_PART_MS) return null
  return [...parts.slice(0, i), { ...p, to: s }, { ...p, from: s }, ...parts.slice(i + 1)]
}

/** The same change on each of the parts `indices`; `webcam: undefined` puts back the webcam recorded. */
export function updateParts(parts: EditPart[], indices: number[], change: Partial<Pick<EditPart, 'removed' | 'muted' | 'webcam'>>): EditPart[] {
  return parts.map((p, i) => (indices.includes(i) ? tidy({ ...p, ...change }) : p))
}

/** Consecutive indices, from the lowest. */
const sortedIndices = (indices: number[]) => [...indices].sort((a, b) => a - b)

/** The parts `indices` can become one: they are side by side, and each continues the previous one in the recording. */
export function canJoin(parts: EditPart[], indices: number[]): boolean {
  const sorted = sortedIndices(indices)
  return sorted.length > 1 && sorted.every((n, k) => k === 0 || (n === sorted[k - 1] + 1 && parts[sorted[k - 1]].to === parts[n].from))
}

/** Joins the parts `indices` (see canJoin) into one, which keeps what the first of them had. */
export function joinParts(parts: EditPart[], indices: number[]): EditPart[] {
  if (!canJoin(parts, indices)) return parts
  const sorted = sortedIndices(indices)
  const first = sorted[0]
  const last = sorted[sorted.length - 1]
  return [...parts.slice(0, first), { ...parts[first], to: parts[last].to }, ...parts.slice(last + 1)]
}

/**
 * Moves the consecutive parts `indices` before the part that is now at `before` (parts.length:
 * to the end). Returns the parts and the indices of the moved ones.
 */
export function moveParts(parts: EditPart[], indices: number[], before: number): { parts: EditPart[]; indices: number[] } {
  const sorted = sortedIndices(indices)
  const first = sorted[0]
  const count = sorted.length
  const block = parts.slice(first, first + count)
  const rest = [...parts.slice(0, first), ...parts.slice(first + count)]
  const at = Math.max(0, Math.min(rest.length, before > first ? before - count : before))
  return { parts: [...rest.slice(0, at), ...block, ...rest.slice(at)], indices: block.map((_, k) => at + k) }
}

/** The boundary after part `i` can be dragged: the next part continues it in the recording. */
export const canMoveBoundary = (parts: EditPart[], i: number): boolean => i + 1 < parts.length && parts[i].to === parts[i + 1].from

/**
 * Moves the boundary after part `i` to `ms` of the axis, which takes from one of the two parts
 * what it gives to the other; null where canMoveBoundary is false.
 */
export function moveBoundary(parts: EditPart[], i: number, ms: number, snap?: (sourceMs: number) => number): EditPart[] | null {
  if (!canMoveBoundary(parts, i)) return null
  const a = parts[i]
  const b = parts[i + 1]
  const at = a.from + ms - partStarts(parts)[i]
  const s = Math.round(Math.max(a.from + MIN_PART_MS, Math.min(b.to - MIN_PART_MS, snap ? snap(at) : at)))
  return [...parts.slice(0, i), { ...a, to: s }, { ...b, from: s }, ...parts.slice(i + 2)]
}

/** How long the result is. */
export const keptDuration = (parts: EditPart[]): number => parts.reduce((sum, p) => sum + (p.removed ? 0 : length(p)), 0)

/** Saving would change something: splits alone do not. */
export function isEdited(parts: EditPart[]): boolean {
  return parts.some((p, i) => p.removed || p.muted || p.webcam || (i > 0 && parts[i - 1].to !== p.from))
}

/** `ms` on the frames of a video at `fps`: cuts there keep the picture and the sound in step at every join. */
export const snapToFrame = (ms: number, fps: number): number => Math.round((Math.round((ms * fps) / 1000) * 1000) / fps)

/**
 * The parts with their ends on the frames of a video at `fps` (the end of the recording stays
 * where it is); a part shorter than a frame disappears.
 */
export function snapParts(parts: EditPart[], fps: number, durationMs: number): EditPart[] {
  const snap = (ms: number) => (ms === durationMs ? ms : Math.min(durationMs, snapToFrame(ms, fps)))
  return parts.map((p) => ({ ...p, from: snap(p.from), to: snap(p.to) })).filter((p) => p.to > p.from)
}

const isLayout = (w: unknown): w is WebcamLayout => {
  const l = w as WebcamLayout
  return !!l && typeof l === 'object' && WEBCAM_SHAPES.includes(l.shape) && WEBCAM_CORNERS.includes(l.corner) && typeof l.visible === 'boolean'
}

/**
 * The edit list as it came from the renderer, checked: whole ms, parts that cover the recording
 * `durationMs` long exactly once, a result long enough, and something to save. Throws a RangeError otherwise.
 */
export function checkParts(input: unknown, durationMs: number): EditPart[] {
  if (!Array.isArray(input) || input.length === 0) throw new RangeError('no parts')
  const parts = input.map((raw: unknown) => {
    const p = raw as EditPart
    if (!p || typeof p !== 'object' || !Number.isInteger(p.from) || !Number.isInteger(p.to) || p.to - p.from < 1) throw new RangeError(`bad part ${JSON.stringify(raw)}`)
    if (p.webcam !== undefined && !isLayout(p.webcam)) throw new RangeError(`bad webcam layout ${JSON.stringify(p.webcam)}`)
    return tidy(p)
  })
  const sorted = [...parts].sort((a, b) => a.from - b.from)
  sorted.forEach((p, i) => {
    if (p.from !== (i === 0 ? 0 : sorted[i - 1].to)) throw new RangeError(`the parts leave out or repeat ${i === 0 ? 0 : sorted[i - 1].to} ms`)
  })
  if (sorted[sorted.length - 1].to !== durationMs) throw new RangeError(`the parts end at ${sorted[sorted.length - 1].to} ms, not ${durationMs}`)
  if (keptDuration(parts) < MIN_RESULT_MS) throw new RangeError(`the result would be ${keptDuration(parts)} ms`)
  if (!isEdited(parts)) throw new RangeError('nothing to edit')
  return parts
}
