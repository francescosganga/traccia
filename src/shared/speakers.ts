import type { AudioSource, SpeakerTurn, TranscriptResult, TranscriptSegment, TranscriptWord } from './types'
import { t } from './i18n'

/** Apply names to phrases and words together, retaining source-scoped speaker identities. Empty names reset the label. */
export function renameSpeakers(result: TranscriptResult, input: unknown): TranscriptResult {
  if (input === undefined) return result
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error(t('speakers.invalidNames'))
  const ids = new Set([...result.segments, ...result.words].map((s) => s.speaker).filter(Boolean))
  const names = new Map<string, string>()
  for (const [id, value] of Object.entries(input)) {
    if (!ids.has(id) || typeof value !== 'string' || value.length > 80 || /[\u0000-\u001f\u007f]/.test(value)) throw new Error(t('speakers.invalidNames'))
    names.set(id, value.trim())
  }
  const rename = <T extends TranscriptSegment>(span: T): T => {
    if (!span.speaker || !names.has(span.speaker)) return span
    const next = { ...span }
    const name = names.get(span.speaker)
    if (name) next.speakerName = name
    else delete next.speakerName
    return next
  }
  return { segments: result.segments.map(rename), words: result.words.map(rename) }
}

/** Match by greatest temporal overlap; silence stays unassigned instead of inventing a speaker. */
function speakerAt(span: { start: number; end: number }, turns: SpeakerTurn[]): string | undefined {
  let best = 0
  let speaker: string | undefined
  for (const turn of turns) {
    const overlap = Math.min(Math.max(span.end, span.start + 0.001), turn.end) - Math.max(span.start, turn.start)
    if (overlap > best) {
      best = overlap
      speaker = turn.speaker
    }
  }
  return speaker
}

/** Speaker identities are local to a source: a voice on the mic is never assumed to be the remote voice. */
export function labelSpeakers(result: TranscriptResult, source: AudioSource, turns?: SpeakerTurn[]): TranscriptResult {
  const label = (span: TranscriptSegment): TranscriptSegment => {
    const id = turns ? speakerAt(span, turns) : undefined
    return { ...span, source, speaker: id === undefined ? undefined : `${source}_${id}` }
  }
  const words: TranscriptWord[] = result.words.map(label)
  const segments: TranscriptSegment[] = []
  const assigned = new Set<TranscriptWord>()
  for (const phrase of result.segments) {
    const inside = words.filter((w) => {
      if (assigned.has(w) || w.start < phrase.start || w.start > phrase.end || w.end > phrase.end) return false
      assigned.add(w)
      return true
    })
    if (!inside.length) {
      segments.push(label(phrase))
      continue
    }
    let current: TranscriptSegment | undefined
    for (const word of inside) {
      if (!current || current.speaker !== word.speaker) {
        current = { ...word, text: word.text.trim() }
        segments.push(current)
      } else {
        current.text += ' ' + word.text.trim()
        current.end = Math.max(current.end, word.end)
      }
    }
  }
  return { segments, words }
}

/** Stable labels in exported text, including the source when diarization was unavailable. */
export function speechText(span: TranscriptSegment): string {
  const label = span.speakerName || span.speaker || span.source
  return label ? `[${label}] ${span.text}` : span.text
}
