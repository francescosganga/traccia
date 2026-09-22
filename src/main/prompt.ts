import { join } from 'path'
import { t } from '../shared/i18n'
import type { OutputFormat } from '../shared/types'
import { formatTime } from '../shared/recording-reader'

export interface PromptInput {
  /** Absolute path of the recording folder */
  dir: string
  format: OutputFormat
  /** 'frames/' or 'recording.<ext>' */
  mediaName: string
  width: number
  height: number
  fps: number
  durationMs: number
  audio: boolean
  transcribed: boolean
  /** Word-level timestamps available (clicks carry the words being spoken) */
  hasWords: boolean
  whisperModel?: string
  language?: string
  clicksTracked: boolean
  cursorHz: number
  frames?: number
  skippedFrames?: number
  warnings: string[]
}

/** "a, b and c" in the UI language. */
function listJoin(items: string[]): string {
  if (items.length <= 1) return items[0] ?? ''
  return items.slice(0, -1).join(', ') + t('prompt.and') + items[items.length - 1]
}

/**
 * PROMPT.md: the instructions an AI needs to make sense of the folder. Written in
 * the UI language, like the header of recording.txt, and with absolute paths so the
 * sentence "read the file .../PROMPT.md" is enough to get an agent started.
 */
export function buildPrompt(input: PromptInput): string {
  const isFrames = input.format === 'jpg'
  const abs = (name: string) => join(input.dir, name)
  const duration = formatTime(input.durationMs)
  const txtPath = abs('recording.txt')
  const mediaPath = abs(input.mediaName)
  const audioPath = abs('audio.m4a')
  const out: string[] = []

  out.push(t('prompt.title'), '')
  out.push(t('prompt.intro', { talking: input.audio ? t('prompt.introTalking') : '' }), '')
  out.push(t('prompt.folder', { dir: input.dir }), '')

  // ---- files ----
  out.push(t('prompt.filesTitle'), '')
  const items: string[] = []
  if (isFrames) items.push(t('prompt.itemFrames'))
  if (input.clicksTracked) items.push(t('prompt.itemClicks', { speech: input.hasWords ? t('prompt.itemClicksSpeech') : '' }))
  if (input.transcribed) items.push(t('prompt.itemTranscript'))
  out.push(t('prompt.fileTxt', { path: txtPath, items: items.length ? listJoin(items) : t('prompt.itemNothing') }))
  if (isFrames) {
    const n = input.frames ?? 0
    const last = `frame_${String(n).padStart(5, '0')}.jpg`
    const skipped = input.skippedFrames ? t('prompt.fileFramesSkipped', { n: input.skippedFrames }) : ''
    out.push(t('prompt.fileFrames', { path: mediaPath, n, w: input.width, h: input.height, fps: input.fps, last }) + skipped)
    if (input.audio) out.push(t('prompt.fileAudio', { path: audioPath }))
  } else {
    const audio = input.audio ? t('prompt.fileVideoAudio') : ''
    out.push(t('prompt.fileVideo', { path: mediaPath, w: input.width, h: input.height, fps: input.fps, duration, audio }))
  }
  out.push(t('prompt.fileRawTxt', { path: abs('recording-raw.txt'), hz: input.cursorHz }))
  out.push(t('prompt.fileJson', { path: abs('recording.json') }), '')

  // ---- how to read the timeline ----
  out.push(t('prompt.readingTitle'), '')
  out.push(t('prompt.readTimes', { duration }))
  if (isFrames) out.push(t('prompt.readPaths', { dir: input.dir }))
  out.push(t('prompt.readCoords', { unit: isFrames ? t('tl.unitImage') : t('tl.unitVideo') }))
  if (input.clicksTracked) {
    out.push(
      t('prompt.readClick', {
        speech: input.hasWords ? t('prompt.readClickSpeech') : '',
        meaning: input.hasWords ? t('prompt.readClickMeaning') : '',
        howToSee: isFrames ? t('prompt.readClickSeeFrame') : t('prompt.readClickSeeVideo')
      })
    )
  }
  if (input.transcribed) out.push(t('prompt.readSpeech', { model: input.whisperModel ?? '', lang: input.language ?? 'auto' }))
  if (!isFrames) out.push(t('prompt.readVideo', { path: mediaPath }))
  if (input.audio && !input.transcribed) {
    const where = isFrames ? t('prompt.noTranscriptFile', { path: audioPath }) : t('prompt.noTranscriptVideo', { path: mediaPath })
    out.push(t('prompt.noTranscript', { where }))
  }
  if (!input.audio) out.push(t('prompt.noAudio', { clicks: input.clicksTracked ? t('prompt.noAudioClicks') : '' }))
  if (!input.clicksTracked) out.push(t('prompt.noClicks'))
  out.push('')

  if (input.warnings.length) {
    out.push(t('prompt.notesTitle'), '')
    for (const w of input.warnings) out.push(t('prompt.warning', { text: w }))
    out.push('')
  }

  // ---- what to do ----
  out.push(t('prompt.todoTitle'), '')
  out.push(t('prompt.todo1', { path: txtPath }))
  if (isFrames) {
    out.push(t('prompt.todo2Frames', { clicks: input.clicksTracked ? t('prompt.todo2FramesClicks') : '' }))
  } else {
    const hints: string[] = []
    if (input.clicksTracked) hints.push(t('prompt.todo2VideoClicks'))
    if (input.transcribed) hints.push(t('prompt.todo2VideoSpeech'))
    out.push(t('prompt.todo2Video', { hints: hints.length ? ` (${listJoin(hints)})` : '' }))
  }
  out.push(input.audio ? t('prompt.todo3') : t('prompt.todo3NoAudio'))

  return out.join('\n') + '\n'
}
