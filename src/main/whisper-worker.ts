/**
 * Runs inside an Electron utility process. Downloads Whisper models and transcribes
 * audio with @huggingface/transformers (ONNX runtime, CPU) so the main process never blocks.
 *
 * Messages in:  { id, type: 'download', model }
 *               { id, type: 'transcribe', model, audioPath, language }
 * Messages out: { id, type: 'progress', progress, file? }
 *               { id, type: 'result', segments }
 *               { id, type: 'error', error }
 */
import { readFileSync } from 'fs'
import type { TranscriptResult, TranscriptSegment, TranscriptWord } from '../shared/types'

// eslint-disable-next-line @typescript-eslint/no-require-imports
const tf = require('@huggingface/transformers') as {
  pipeline: (task: string, model: string, opts: Record<string, unknown>) => Promise<AsrPipeline>
  env: Record<string, unknown>
}

type AsrPipeline = (
  audio: Float32Array,
  opts: Record<string, unknown>
) => Promise<{ text: string; chunks?: { timestamp: [number, number | null]; text: string }[] }>

tf.env.cacheDir = process.env.MODELS_DIR
tf.env.allowRemoteModels = true

const port = process.parentPort
const loaded = new Map<string, Promise<AsrPipeline>>()

/** The "_timestamped" exports include cross-attentions, needed for word-level timestamps. */
function hfId(model: string): string {
  return `onnx-community/whisper-${model}_timestamped`
}

function load(model: string, id: number, reportProgress: boolean): Promise<AsrPipeline> {
  const key = hfId(model)
  if (!loaded.has(key)) {
    const files = new Map<string, { loaded: number; total: number }>()
    let lastSent = 0
    const p = tf.pipeline('automatic-speech-recognition', key, {
      dtype: 'q8',
      progress_callback: (ev: { status: string; file?: string; loaded?: number; total?: number }) => {
        if (!reportProgress || !ev.file) return
        if (ev.status === 'progress' || ev.status === 'done') {
          const total = ev.total ?? files.get(ev.file)?.total ?? 0
          files.set(ev.file, { loaded: ev.status === 'done' ? total : (ev.loaded ?? 0), total })
        }
        let l = 0
        let t = 0
        for (const f of files.values()) {
          l += f.loaded
          t += f.total
        }
        const now = Date.now()
        if (t > 0 && (now - lastSent > 250 || ev.status === 'done')) {
          lastSent = now
          port.postMessage({ id, type: 'progress', progress: l / t, file: ev.file })
        }
      }
    })
    p.catch(() => loaded.delete(key))
    loaded.set(key, p)
  }
  return loaded.get(key)!
}

const SAMPLE_RATE = 16000
const PIECE_SECONDS = 600

// Phrase splitting: a new segment starts after sentence punctuation, after a pause,
// after clause punctuation once the phrase is long enough, or at a hard duration cap.
const PAUSE_SECONDS = 0.7
const CLAUSE_MIN_SECONDS = 1.5
const MAX_SEGMENT_SECONDS = 6
const SENTENCE_END = /[.!?…]["')\]]*$/
const CLAUSE_END = /[,;:]["')\]]*$/

/** A segment that still knows which words it was built from. */
interface Phrase extends TranscriptSegment {
  words: TranscriptWord[]
}

function groupWords(words: TranscriptWord[]): Phrase[] {
  const phrases: Phrase[] = []
  let cur: Phrase | null = null
  const flush = () => {
    if (cur && cur.text) phrases.push(cur)
    cur = null
  }
  for (const w of words) {
    const text = w.text.trim()
    if (!text) continue
    if (cur && (w.start - cur.end > PAUSE_SECONDS || cur.end - cur.start >= MAX_SEGMENT_SECONDS)) flush()
    if (!cur) cur = { start: w.start, end: w.end, text, words: [w] }
    else {
      cur.text += ' ' + text
      cur.end = Math.max(cur.end, w.end)
      cur.words.push(w)
    }
    if (SENTENCE_END.test(text) || (CLAUSE_END.test(text) && cur.end - cur.start >= CLAUSE_MIN_SECONDS)) flush()
  }
  flush()
  return phrases
}

// Whisper pads audio shorter than 30 s with silence and, on silence, sometimes "transcribes" the
// subtitle credits it saw in training ("Sottotitoli e revisione a cura di QTSS", "Subtitles by the
// Amara.org community", ...). Only what real speech never produces is dropped: text timestamped
// past the end of the audio, phrases with no duration at all, and those credit lines. Single
// zero-length words are kept: real transcripts contain them (sub-word tokens such as "l" + "'altro").
const CREDIT_LINES = [
  /\bamara\.org\b/i,
  /\bqtss\b/i,
  /^sottotitoli (e revisione )?a cura di\b/i,
  /^sottotitoli creati dalla comunit/i,
  /^subtitles by\b/i,
  /^subs by\b/i
]

function isHallucination(seg: TranscriptSegment): boolean {
  return seg.end <= seg.start || CREDIT_LINES.some((re) => re.test(seg.text.trim()))
}

/** Drops entries starting at or after `audioEnd` (seconds) and clamps the others to it. */
function clipToAudio<T extends { start: number; end: number }>(items: T[], audioEnd: number): T[] {
  return items.filter((x) => x.start < audioEnd).map((x) => (x.end > audioEnd ? { ...x, end: audioEnd } : x))
}

async function transcribe(id: number, model: string, audioPath: string, language: string): Promise<void> {
  const asr = await load(model, id, false)
  const buf = readFileSync(audioPath)
  const audio = new Float32Array(buf.buffer, buf.byteOffset, Math.floor(buf.byteLength / 4))
  const totalSec = audio.length / SAMPLE_RATE
  const result: TranscriptResult = { segments: [], words: [] }
  const common = { language: language === 'auto' ? undefined : language, task: 'transcribe', chunk_length_s: 30, stride_length_s: 5 }

  // Long recordings are processed in 10-minute pieces so we can report progress and bound memory.
  const pieces = Math.max(1, Math.ceil(totalSec / PIECE_SECONDS))
  for (let i = 0; i < pieces; i++) {
    const from = i * PIECE_SECONDS * SAMPLE_RATE
    const to = Math.min(audio.length, (i + 1) * PIECE_SECONDS * SAMPLE_RATE)
    const piece = audio.subarray(from, to)
    const offset = from / SAMPLE_RATE
    const pieceEnd = piece.length / SAMPLE_RATE
    const audioEnd = offset + pieceEnd
    port.postMessage({ id, type: 'progress', progress: i / pieces })

    let words: TranscriptWord[] | null = null
    try {
      const out = await asr(piece, { ...common, return_timestamps: 'word' })
      let lastEnd = 0
      words = (out.chunks ?? []).map((c) => {
        const start = Math.max(lastEnd, c.timestamp[0] ?? lastEnd)
        const end = Math.max(start, c.timestamp[1] ?? start + 0.3)
        lastEnd = end
        return { start: offset + start, end: offset + end, text: c.text }
      })
    } catch (e) {
      console.warn('word-level timestamps unavailable, falling back to chunk timestamps:', (e as Error).message)
    }

    if (words) {
      const inAudio = clipToAudio(words, audioEnd)
      const phrases = groupWords(inAudio)
      const kept = phrases.filter((p) => !isHallucination(p))
      const dropped = words.length - inAudio.length + (phrases.length - kept.length)
      if (dropped) console.log(`dropped ${dropped} hallucinated word(s)/phrase(s) from piece ${i + 1}/${pieces}`)
      result.words.push(...kept.flatMap((p) => p.words))
      result.segments.push(...kept.map((p) => ({ start: p.start, end: p.end, text: p.text })))
    } else {
      const out = await asr(piece, { ...common, return_timestamps: true })
      const chunks = out.chunks ?? [{ timestamp: [0, pieceEnd], text: out.text }]
      const segments: TranscriptSegment[] = []
      for (const c of chunks) {
        const text = c.text.trim()
        if (!text) continue
        segments.push({ start: offset + (c.timestamp[0] ?? 0), end: offset + (c.timestamp[1] ?? pieceEnd), text })
      }
      const kept = clipToAudio(segments, audioEnd).filter((s) => !isHallucination(s))
      if (kept.length < segments.length) console.log(`dropped ${segments.length - kept.length} hallucinated segment(s) from piece ${i + 1}/${pieces}`)
      result.segments.push(...kept)
    }
  }
  port.postMessage({ id, type: 'result', result })
}

port.on('message', (e) => {
  const msg = e.data as { id: number; type: string; model: string; audioPath?: string; language?: string }
  const fail = (err: unknown) => port.postMessage({ id: msg.id, type: 'error', error: String((err as Error)?.message ?? err) })
  try {
    if (msg.type === 'download') {
      load(msg.model, msg.id, true)
        .then(() => port.postMessage({ id: msg.id, type: 'result' }))
        .catch(fail)
    } else if (msg.type === 'transcribe') {
      transcribe(msg.id, msg.model, msg.audioPath!, msg.language ?? 'auto').catch(fail)
    }
  } catch (err) {
    fail(err)
  }
})
