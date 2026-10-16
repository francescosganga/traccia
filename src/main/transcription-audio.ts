/** Exclude leading silence from inference without changing the recording's clock or audio files. */
export function transcriptionStart(audio: Float32Array, sampleRate: number): number | null {
  const frame = Math.max(1, Math.round(sampleRate * 0.02))
  const padding = Math.round(sampleRate * 0.3)
  for (let from = 0; from < audio.length; from += frame) {
    const to = Math.min(audio.length, from + frame)
    let energy = 0
    for (let i = from; i < to; i++) energy += audio[i] * audio[i]
    // A conservative -60 dB floor preserves quiet speech; padding protects its onset.
    if (Math.sqrt(energy / (to - from)) > 0.001) return Math.max(0, from - padding)
  }
  return null
}

export interface SpeechSpan { start: number; end: number }

/** Merge padded speech islands on the original timeline before preparing inference audio. */
export function transcriptionWindows(duration: number, speech?: SpeechSpan[]): SpeechSpan[] {
  const spans = speech === undefined ? [{ start: 0, end: duration }] : speech
    .filter((s) => Number.isFinite(s.start) && Number.isFinite(s.end) && s.end > s.start && s.end > 0 && s.start < duration)
    .map((s) => ({ start: Math.max(0, s.start - 0.4), end: Math.min(duration, s.end + 0.4) }))
    .sort((a, b) => a.start - b.start)
  const merged: SpeechSpan[] = []
  for (const span of spans) {
    const previous = merged.at(-1)
    if (previous && span.start - previous.end <= 1) previous.end = Math.max(previous.end, span.end)
    else merged.push({ ...span })
  }
  const windows: SpeechSpan[] = []
  for (const span of merged) {
    for (let start = span.start; start < span.end; start += 600) windows.push({ start, end: Math.min(start + 600, span.end) })
  }
  return windows
}

interface SourceSpan extends SpeechSpan { offset: number }
export interface TranscriptionPiece { audio: Float32Array; spans: SourceSpan[] }

/** Compact speech into bounded pieces so short answers share context instead of each becoming a padded 30-second inference. */
export function* transcriptionPieces(audio: Float32Array, sampleRate: number, windows: SpeechSpan[]): Generator<TranscriptionPiece> {
  const limit = sampleRate * 600
  let chunks: Float32Array[] = []
  let spans: SourceSpan[] = []
  let length = 0
  const piece = (): TranscriptionPiece => {
    const compact = new Float32Array(length)
    let offset = 0
    for (const chunk of chunks) {
      compact.set(chunk, offset)
      offset += chunk.length
    }
    return { audio: compact, spans }
  }
  for (const window of windows) {
    const end = Math.min(audio.length, Math.ceil(window.end * sampleRate))
    for (let from = Math.floor(window.start * sampleRate); from < end;) {
      const to = Math.min(end, from + limit - length)
      chunks.push(audio.subarray(from, to))
      spans.push({ start: from / sampleRate, end: to / sampleRate, offset: length / sampleRate })
      length += to - from
      from = to
      if (length === limit) {
        yield piece()
        chunks = []
        spans = []
        length = 0
      }
    }
  }
  if (length) yield piece()
}

/** Restore recording time; a word cannot stretch across a silence removed from inference. */
export function restoreSpeechTime<T extends SpeechSpan>(item: T, spans: SourceSpan[], leading: number, clampWord = true): T | undefined {
  const start = Math.max(0, item.start + leading)
  const end = Math.max(start, item.end + leading)
  const first = spans.find((s) => start >= s.offset && start < s.offset + s.end - s.start)
  if (!first) return undefined
  const last = clampWord ? first : spans.find((s) => end <= s.offset + s.end - s.start) ?? spans.at(-1)!
  return {
    ...item,
    start: first.start + start - first.offset,
    end: Math.min(last.end, last.start + end - last.offset)
  }
}
