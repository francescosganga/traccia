import { existsSync } from 'fs'
import { copyFile, link, mkdir, rename, rm, rmdir, writeFile } from 'fs/promises'
import { join } from 'path'
import { t } from '../shared/i18n'
import { listFrames, readRecordingJson, type RecordingJson } from '../shared/recording-reader'
import type { ProcessingProgress, RecordingMedia, RecordingResult } from '../shared/types'
import { ffmpegOutput, runFfmpeg, videoCodecArgs } from './ffmpeg'
import { recordingTexts, textsInputFromJson } from './texts'
import { keptFrames, thumbnailArgs, trimAudioArgs, trimRange, trimRecordingJson, trimVideoArgs } from './trim'

/** Folder inside a trimmed recording with its files as they were before the first trim. */
export const ORIGINAL_DIR = 'original'
// The new files are written here first: until all of them are there, the recording is untouched
const STAGING_DIR = '.trim'
// Where the files replaced by a second trim wait until the new ones are in place
const PREVIOUS_DIR = '.trim-previous'
const TEXT_FILES = ['recording.txt', 'recording-raw.txt', 'PROMPT.md', 'recording.json']

export interface TrimOptions {
  /** For recordings made before recording.json stored it: the current setting */
  cursorHz: number
  onProgress: (p: ProcessingProgress) => void
}

/** The video files of a recording that exist: what the AI reads and, with the webcam, the one people watch. */
function videoFiles(dir: string, meta: RecordingJson): string[] {
  if (meta.format === 'jpg') return []
  const names = [...new Set([meta.media, meta.webcam?.video].filter((n): n is string => !!n))]
  return names.filter((name) => existsSync(join(dir, name)))
}

/** A hard link costs neither time nor space; a copy where links are not supported (FAT drives). */
async function linkOrCopy(src: string, dst: string): Promise<void> {
  await link(src, dst).catch(() => copyFile(src, dst))
}

/**
 * Keeps the part of the recording in `dir` between `fromMs` and `toMs`: the media are encoded
 * again, the frames kept and renumbered, recording.json trimmed and the texts written again from
 * it. Everything is written to a staging folder first; then the files it replaces move to
 * original/ (on the first trim only: original/ keeps the very first version) and the new ones
 * take their place. When something fails the recording is left as it was.
 */
export async function trimRecording(dir: string, fromMs: number, toMs: number, opts: TrimOptions): Promise<RecordingResult> {
  const meta = await readRecordingJson(dir)
  const { from, to } = trimRange(meta, fromMs, toMs)
  // The guesses for older recordings are made on the whole of it, and stored, so the next trim needs none
  const before = textsInputFromJson(meta, opts.cursorHz)
  const json = trimRecordingJson({ ...meta, cursorHz: before.input.cursorHz, clicksTracked: before.clicksTracked }, from, to)
  json.prompt = 'PROMPT.md'

  const staging = join(dir, STAGING_DIR)
  await rm(staging, { recursive: true, force: true })
  await mkdir(staging)
  const staged: string[] = []
  try {
    const durationMs = to - from
    for (const name of videoFiles(dir, meta)) {
      const step = t('step.trim', { name })
      opts.onProgress({ step, progress: 0 })
      const codec = await videoCodecArgs(meta.format, meta.width, meta.height)
      await runFfmpeg(trimVideoArgs(join(dir, name), join(staging, name), from, to, meta.fps, codec), {
        durationMs,
        onProgress: (progress) => opts.onProgress({ step, progress })
      })
      staged.push(name)
    }
    if (meta.format === 'jpg' && meta.frames && json.frames) {
      opts.onProgress({ step: t('step.trimFrames'), progress: -1 })
      await mkdir(join(staging, 'frames'))
      const sources = keptFrames(meta.frames, from, to)
      for (let i = 0; i < sources.length; i++) await linkOrCopy(join(dir, sources[i].file), join(staging, json.frames[i].file))
      staged.push('frames')
      if (existsSync(join(dir, 'audio.m4a'))) {
        opts.onProgress({ step: t('step.trim', { name: 'audio.m4a' }), progress: -1 })
        await runFfmpeg(trimAudioArgs(join(dir, 'audio.m4a'), join(staging, 'audio.m4a'), from, to))
        staged.push('audio.m4a')
      }
    }

    opts.onProgress({ step: t('step.timeline'), progress: -1 })
    const after = textsInputFromJson(json, opts.cursorHz)
    const texts = recordingTexts(after.input, dir, after.clicksTracked)
    await writeFile(join(staging, 'recording.txt'), texts.txt, 'utf8')
    await writeFile(join(staging, 'recording-raw.txt'), texts.rawTxt, 'utf8')
    await writeFile(join(staging, 'PROMPT.md'), texts.prompt, 'utf8')
    await writeFile(join(staging, 'recording.json'), JSON.stringify(json), 'utf8')
    staged.push(...TEXT_FILES)

    await swapIn(dir, staging, staged)
  } finally {
    await rm(staging, { recursive: true, force: true }).catch((e) => console.error('cannot remove', staging, e))
  }

  return {
    dir,
    mediaPath: join(dir, json.media),
    videoPath: join(dir, json.webcam?.video ?? json.media),
    txtPath: join(dir, 'recording.txt'),
    rawTxtPath: join(dir, 'recording-raw.txt'),
    jsonPath: join(dir, 'recording.json'),
    promptPath: join(dir, 'PROMPT.md'),
    durationMs: json.durationMs,
    format: json.format,
    width: json.width,
    height: json.height,
    frames: json.frames?.length,
    skippedFrames: json.skippedFrames,
    transcriptSegments: json.transcript?.length,
    warnings: json.warnings,
    trimmed: true
  }
}

/**
 * Puts the staged files in place of the current ones, which go to original/ if there is none yet,
 * and are deleted otherwise. Renames only, undone if one fails.
 */
async function swapIn(dir: string, staging: string, names: string[]): Promise<void> {
  const first = !existsSync(join(dir, ORIGINAL_DIR))
  const backup = join(dir, first ? ORIGINAL_DIR : PREVIOUS_DIR)
  await mkdir(backup, { recursive: true })
  const moved: string[] = []
  const placed: string[] = []
  try {
    for (const name of names) {
      if (!existsSync(join(dir, name))) continue
      await rename(join(dir, name), join(backup, name))
      moved.push(name)
    }
    for (const name of names) {
      await rename(join(staging, name), join(dir, name))
      placed.push(name)
    }
  } catch (e) {
    let restored = true
    for (const name of placed) await rename(join(dir, name), join(staging, name)).catch(() => (restored = false))
    for (const name of moved) await rename(join(backup, name), join(dir, name)).catch(() => (restored = false))
    if (!restored) console.error('trim: could not put every file back in', dir, '; the previous ones are in', backup)
    // Removed only if empty: never lose a file that could not be put back
    await rmdir(backup).catch(() => {})
    throw e
  }
  if (!first) await rm(backup, { recursive: true, force: true })
}

/** What the trim view plays: the video (with the webcam, if there is one), or the frames and audio of a JPG recording. */
export async function recordingMedia(dir: string): Promise<RecordingMedia> {
  const meta = await readRecordingJson(dir)
  const audio = join(dir, 'audio.m4a')
  const video = videoFiles(dir, meta).pop()
  return {
    format: meta.format,
    durationMs: meta.durationMs,
    width: meta.width,
    height: meta.height,
    fps: meta.fps,
    video: video ? join(dir, video) : null,
    audio: meta.format === 'jpg' && existsSync(audio) ? audio : null,
    frames: listFrames(dir, meta).map(({ path, tMs }) => ({ path, tMs })),
    transcript: meta.transcript ?? [],
    clicks: meta.clicks.map(({ t, button }) => ({ t, button })),
    trimmed: meta.trimmed !== undefined
  }
}

// Twice the height of the strip on a Retina screen
const THUMBNAIL_HEIGHT = 96
// The trim view asks for a whole strip at once: a few ffmpeg at a time
const THUMBNAIL_JOBS = 3
let thumbnailJobs = 0
const thumbnailQueue: (() => void)[] = []

async function oneOfFew<T>(job: () => Promise<T>): Promise<T> {
  if (thumbnailJobs >= THUMBNAIL_JOBS) await new Promise<void>((resolve) => thumbnailQueue.push(resolve))
  thumbnailJobs++
  try {
    return await job()
  } finally {
    thumbnailJobs--
    thumbnailQueue.shift()?.()
  }
}

/** The frame of the video on screen at `tMs`, small, as a data URL for the trim timeline; null when there is none. */
export async function recordingThumbnail(dir: string, tMs: number): Promise<string | null> {
  const meta = await readRecordingJson(dir)
  const video = videoFiles(dir, meta).pop()
  if (!video) return null
  try {
    const jpeg = await oneOfFew(() => ffmpegOutput(thumbnailArgs(join(dir, video), tMs, meta.fps, THUMBNAIL_HEIGHT)))
    return jpeg.length ? `data:image/jpeg;base64,${jpeg.toString('base64')}` : null
  } catch (e) {
    console.error('thumbnail failed', dir, tMs, e)
    return null
  }
}
