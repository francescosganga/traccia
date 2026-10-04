// recording.txt, recording-raw.txt and PROMPT.md: written by the session at the end of a recording,
// and written again from recording.json when the recording changes afterwards.
import { allTranslations, type TranslationKey } from '../shared/i18n'
import type { RecordingJson } from '../shared/recording-reader'
import { buildPrompt } from './prompt'
import { buildTimeline, type Geometry, type TimelineInput } from './timeline'

export interface RecordingTexts {
  /** recording.txt: clicks, speech and frames */
  txt: string
  /** recording-raw.txt: the same plus the pointer movement */
  rawTxt: string
  /** PROMPT.md: what an AI needs to know to read the folder, with absolute paths */
  prompt: string
}

/** The three texts of the recording in `dir`, from the same data. */
export function recordingTexts(input: TimelineInput, dir: string, clicksTracked: boolean): RecordingTexts {
  return {
    txt: buildTimeline({ ...input, cursorMode: 'clicks' }),
    rawTxt: buildTimeline({ ...input, cursorMode: 'full' }),
    prompt: buildPrompt({
      dir,
      format: input.format,
      mediaName: input.mediaName,
      webcam: input.webcam,
      width: input.width,
      height: input.height,
      fps: input.fps,
      durationMs: input.durationMs,
      audio: input.audio,
      systemAudio: input.systemAudio,
      transcribed: input.segments !== null,
      hasWords: (input.words?.length ?? 0) > 0,
      whisperModel: input.whisperModel,
      language: input.language,
      clicksTracked,
      cursorHz: input.cursorHz,
      frames: input.frames?.length,
      skippedFrames: input.skippedFrames,
      warnings: input.warnings
    })
  }
}

/**
 * recording.json is in output pixels and ms from the start already: through this geometry
 * mapPoint returns the stored coordinates, and still tells which ones are outside the picture.
 */
function outputGeometry(width: number, height: number): Geometry {
  const area = { x: 0, y: 0, width, height }
  return { displayBounds: area, scale: 1, cropPx: area, outScale: 1, outWidth: width, outHeight: height }
}

// Warnings are stored in the language of the moment, so they are recognised in every language; a {placeholder} ends the fixed part.
const NO_CLICKS_WARNINGS: TranslationKey[] = ['warn.clicksNoAccessibility', 'warn.clicksHookFailed']
const isNoClicksWarning = (warning: string): boolean =>
  NO_CLICKS_WARNINGS.flatMap(allTranslations).some((text) => warning.startsWith(text.split('{')[0]))

/**
 * What the texts are built from, read back from recording.json. Recordings made before the JSON
 * stored the cursor rate and whether clicks were tracked get `fallbackCursorHz` (the current
 * setting), and clicks count as tracked unless there are none and a warning says they were not.
 */
export function textsInputFromJson(meta: RecordingJson, fallbackCursorHz: number): { input: TimelineInput; clicksTracked: boolean } {
  const warnings = meta.warnings ?? []
  return {
    input: {
      createdAt: new Date(meta.createdAt),
      format: meta.format,
      mediaName: meta.media,
      webcam: meta.webcam ? { video: meta.webcam.video, cleanCopy: meta.media !== meta.webcam.video, layout: meta.webcam.layout } : undefined,
      width: meta.width,
      height: meta.height,
      fps: meta.fps,
      durationMs: meta.durationMs,
      audio: meta.audio,
      systemAudio: meta.systemAudio,
      whisperModel: meta.whisper?.model,
      language: meta.whisper?.language,
      t0: 0,
      samples: meta.cursor.map(([t, x, y]) => ({ t, x, y })),
      clicks: meta.clicks.map(({ t, button, x, y }) => ({ t, button, x, y })),
      segments: meta.transcript,
      words: meta.words ?? [],
      cursorHz: meta.cursorHz ?? fallbackCursorHz,
      geometry: outputGeometry(meta.width, meta.height),
      frames: meta.frames,
      skippedFrames: meta.skippedFrames,
      warnings
    },
    clicksTracked: meta.clicksTracked ?? (meta.clicks.length > 0 || !warnings.some(isNoClicksWarning))
  }
}
