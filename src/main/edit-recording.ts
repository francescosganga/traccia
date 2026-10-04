import { existsSync } from 'fs'
import { copyFile, link, mkdir, rename, rm, rmdir, writeFile } from 'fs/promises'
import { join } from 'path'
import { checkParts, snapParts } from '../shared/edit-list'
import { t } from '../shared/i18n'
import { listFrames, readRecordingJson, type MsRange, type RecordingJson } from '../shared/recording-reader'
import type { ProcessingProgress, RecordingMedia, RecordingResult, WebcamEditing } from '../shared/types'
import { webcamGraph } from './compose'
import { during, editRecordingJson, hiddenByEdit, joinGraph, keptFrames, keptSegments, muteFilter, originalKept, thumbnailArgs, type Cut, type Segment } from './edit'
import { ffmpegOutput, hasAudioStream, runFfmpeg, videoCodecArgs } from './ffmpeg'
import { recordingTexts, textsInputFromJson } from './texts'

/** Folder inside an edited recording with its files as they were before the first edit. */
export const ORIGINAL_DIR = 'original'
// The new files are written here first: until all of them are there, the recording is untouched
const STAGING_DIR = '.edit'
// Where the files replaced by a later edit wait until the new ones are in place
const PREVIOUS_DIR = '.edit-previous'
const TEXT_FILES = ['recording.txt', 'recording-raw.txt', 'PROMPT.md', 'recording.json']

export interface EditOptions {
  /** For recordings made before recording.json stored it: the current setting */
  cursorHz: number
  onProgress: (p: ProcessingProgress) => void
}

const exists = (dir: string, name: string | undefined): name is string => !!name && existsSync(join(dir, name))

/** The video without the webcam (or the only video), which the AI reads and the editor shows; null in JPG mode. */
function screenVideo(dir: string, meta: RecordingJson): string | null {
  if (meta.format === 'jpg') return null
  return [meta.media, meta.webcam?.video].find((name) => exists(dir, name)) ?? null
}

/**
 * What the editor can do with the webcam: lay it again from its own track ('full'), only hide
 * it by taking the picture from the video without it ('hide'), or nothing without that video.
 */
export function webcamEditing(dir: string, meta: RecordingJson): WebcamEditing {
  if (!meta.webcam || meta.webcam.video === meta.media || !exists(dir, meta.media) || !exists(dir, meta.webcam.video)) return 'none'
  return exists(dir, meta.webcam.track?.file) ? 'full' : 'hide'
}

/** A hard link costs neither time nor space; a copy where links are not supported (FAT drives). */
async function linkOrCopy(src: string, dst: string): Promise<void> {
  await link(src, dst).catch(() => copyFile(src, dst))
}

/**
 * Applies the edit list `input` (see shared/edit-list.ts) to the recording in `dir`: the media are
 * cut and joined again, silenced where asked and, with the webcam, laid together again; the frames
 * are kept and renumbered, recording.json edited and the texts written again from it. Everything
 * is written to a staging folder first; then the files it replaces move to original/ (on the first
 * edit only: original/ keeps the very first version) and the new ones take their place. When
 * something fails the recording is left as it was.
 */
export async function editRecording(dir: string, input: unknown, opts: EditOptions): Promise<RecordingResult> {
  const meta = await readRecordingJson(dir)
  const checked = checkParts(input, meta.durationMs)
  // Cuts on the frames keep the sound in step at every join (see joinGraph)
  const parts = meta.format === 'jpg' ? checked : snapParts(checked, meta.fps, meta.durationMs)
  const editing = webcamEditing(dir, meta)
  const laid = parts.filter((p) => !p.removed && p.webcam)
  if (laid.length && (editing === 'none' || (editing === 'hide' && laid.some((p) => p.webcam?.visible)))) {
    throw new RangeError(`the webcam of this recording can${editing === 'hide' ? ' only be hidden' : 'not be changed'}`)
  }
  // The guesses for older recordings are made on the whole of it, and stored, so the next edit needs none
  const before = textsInputFromJson(meta, opts.cursorHz)
  const json = editRecordingJson({ ...meta, cursorHz: before.input.cursorHz, clicksTracked: before.clicksTracked }, parts)
  json.prompt = 'PROMPT.md'
  const segments = keptSegments(parts)

  const staging = join(dir, STAGING_DIR)
  await rm(staging, { recursive: true, force: true })
  await mkdir(staging)
  const staged: string[] = []
  try {
    const render = new Renderer(dir, staging, meta, json, segments, opts.onProgress)
    if (meta.format === 'jpg') {
      if (meta.frames && json.frames) {
        opts.onProgress({ step: t('step.editFrames'), progress: -1 })
        await mkdir(join(staging, 'frames'))
        const sources = keptFrames(meta.frames, segments)
        for (let i = 0; i < sources.length; i++) await linkOrCopy(join(dir, sources[i].frame.file), join(staging, json.frames[i].file))
        staged.push('frames')
      }
      if (exists(dir, 'audio.m4a')) {
        await render.audioOnly('audio.m4a')
        staged.push('audio.m4a')
      }
    } else {
      const screen = screenVideo(dir, meta)
      if (screen) {
        await render.cut(screen)
        staged.push(screen)
      }
      const composite = meta.webcam?.video
      if (composite && composite !== screen && exists(dir, composite)) {
        const hidden = hiddenByEdit(parts)
        if (editing === 'full' && json.webcam) await render.layWebcam(composite, meta.media, json)
        else if (editing === 'hide' && hidden.length) await render.hideWebcam(composite, meta.media, hidden)
        else await render.cut(composite)
        staged.push(composite)
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
    edited: true
  }
}

/** The ffmpeg runs of an edit, each writing one file of the recording into the staging folder. */
class Renderer {
  constructor(
    private dir: string,
    private staging: string,
    private meta: RecordingJson,
    private json: RecordingJson,
    private segments: Segment[],
    private onProgress: (p: ProcessingProgress) => void
  ) {}

  /** The segments of a file of the recording. */
  private cuts(name: string): Cut[] {
    return this.segments.map((s) => ({ input: join(this.dir, name), from: s.from, to: s.to }))
  }

  /** The sound of [<label>a] silenced where the edit says, as [aout]. */
  private sound(label: string): { graph: string; map: string } {
    const muted = this.json.muted ?? []
    return muted.length ? { graph: `;[${label}a]${muteFilter(muted)}[aout]`, map: '[aout]' } : { graph: '', map: `[${label}a]` }
  }

  private async run(step: string, name: string, args: string[]): Promise<void> {
    this.onProgress({ step, progress: 0 })
    await runFfmpeg([...args, join(this.staging, name)], {
      durationMs: this.json.durationMs,
      onProgress: (progress) => this.onProgress({ step, progress })
    })
  }

  private async codec(): Promise<string[]> {
    return videoCodecArgs(this.meta.format, this.meta.width, this.meta.height)
  }

  /** A video cut and joined as it is. */
  async cut(name: string): Promise<void> {
    const audio = await hasAudioStream(join(this.dir, name))
    const video = joinGraph(this.cuts(name), { first: 0, fps: this.meta.fps, video: true, audio, label: 'c' })
    const sound = this.sound('c')
    const maps = ['-map', '[cv]', ...(audio ? ['-map', sound.map] : [])]
    await this.run(t('step.edit', { name }), name, [...video.inputs, '-filter_complex', video.graph + (audio ? sound.graph : ''), ...maps, ...(await this.codec())])
  }

  /** The sound of a JPG recording. */
  async audioOnly(name: string): Promise<void> {
    const joined = joinGraph(this.cuts(name), { first: 0, fps: this.meta.fps, video: false, audio: true, label: 'c' })
    const sound = this.sound('c')
    await this.run(t('step.edit', { name }), name, [...joined.inputs, '-filter_complex', joined.graph + sound.graph, '-map', sound.map, '-c:a', 'aac', '-b:a', '128k'])
  }

  /**
   * The video with the webcam laid again from its own track over the video without it, with the
   * layout after the edit. The track is as recorded: its pieces are the parts of the original kept.
   */
  async layWebcam(name: string, screen: string, json: RecordingJson): Promise<void> {
    const track = this.meta.webcam!.track!
    const width = this.meta.width
    const height = this.meta.height
    const graph = webcamGraph({ screenFilters: [], screen: '[sv]', webcam: '[wv]', layout: json.webcam!.layout, width, height, durationMs: json.durationMs })
    // Never shown: the video without the webcam is all there is to it
    if (!graph) return this.copyOf(screen, name)
    const audio = await hasAudioStream(join(this.dir, screen))
    const base = joinGraph(this.cuts(screen), { first: 0, fps: this.meta.fps, video: true, audio, label: 's' })
    const pieces = originalKept(json).map((r) => ({ input: join(this.dir, track.file), from: r.fromMs - track.offsetMs, to: r.toMs - track.offsetMs }))
    const cam = joinGraph(pieces, { first: this.segments.length, fps: this.meta.fps, video: true, audio: false, label: 'w' })
    const sound = this.sound('s')
    const maps = ['-map', '[vout]', ...(audio ? ['-map', sound.map] : [])]
    const filter = `${base.graph};${cam.graph};${graph}${audio ? sound.graph : ''}`
    await this.run(t('step.editWebcam'), name, [...base.inputs, ...cam.inputs, '-filter_complex', filter, ...maps, ...(await this.codec())])
  }

  /** The video with the webcam, where the edit hides it showing the video without it instead. */
  async hideWebcam(name: string, screen: string, hidden: MsRange[]): Promise<void> {
    const audio = await hasAudioStream(join(this.dir, name))
    const withCam = joinGraph(this.cuts(name), { first: 0, fps: this.meta.fps, video: true, audio, label: 'c' })
    const without = joinGraph(this.cuts(screen), { first: this.segments.length, fps: this.meta.fps, video: true, audio: false, label: 's' })
    const sound = this.sound('c')
    const maps = ['-map', '[vout]', ...(audio ? ['-map', sound.map] : [])]
    const filter = `${withCam.graph};${without.graph};[cv][sv]overlay=enable='${during(hidden)}'[vout]${audio ? sound.graph : ''}`
    await this.run(t('step.editWebcam'), name, [...withCam.inputs, ...without.inputs, '-filter_complex', filter, ...maps, ...(await this.codec())])
  }

  /** `name` becomes the same video as `screen` after the edit, already rendered in the staging folder. */
  private async copyOf(screen: string, name: string): Promise<void> {
    await linkOrCopy(join(this.staging, screen), join(this.staging, name))
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
    if (!restored) console.error('edit: could not put every file back in', dir, '; the previous ones are in', backup)
    // Removed only if empty: never lose a file that could not be put back
    await rmdir(backup).catch(() => {})
    throw e
  }
  if (!first) await rm(backup, { recursive: true, force: true })
}

/** What the editor shows: the screen, the webcam over it as it can be edited, the sound, the lanes. */
export async function recordingMedia(dir: string): Promise<RecordingMedia> {
  const meta = await readRecordingJson(dir)
  const audio = join(dir, 'audio.m4a')
  const screen = screenVideo(dir, meta)
  const editing = webcamEditing(dir, meta)
  const track = editing === 'full' ? meta.webcam!.track! : null
  return {
    format: meta.format,
    durationMs: meta.durationMs,
    width: meta.width,
    height: meta.height,
    fps: meta.fps,
    video: screen ? join(dir, screen) : null,
    audio: meta.format === 'jpg' && existsSync(audio) ? audio : null,
    hasAudio: meta.format === 'jpg' ? existsSync(audio) : !!screen && (await hasAudioStream(join(dir, screen))),
    frames: listFrames(dir, meta).map(({ path, tMs }) => ({ path, tMs })),
    transcript: meta.transcript ?? [],
    clicks: meta.clicks.map(({ t, button }) => ({ t, button })),
    muted: meta.muted ?? [],
    webcam: meta.webcam
      ? {
          editing,
          layout: meta.webcam.layout,
          composite: join(dir, meta.webcam.video),
          track: track ? { path: join(dir, track.file), offsetMs: track.offsetMs, kept: originalKept(meta) } : null
        }
      : null,
    edited: meta.edited !== undefined || meta.trimmed !== undefined
  }
}

// Twice the height of the strip on a Retina screen
const THUMBNAIL_HEIGHT = 96
// The editor asks for a whole strip at once: a few ffmpeg at a time
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

/** The frame of the screen at `tMs`, small, as a data URL for the editor's timeline; null when there is none. */
export async function recordingThumbnail(dir: string, tMs: number): Promise<string | null> {
  const meta = await readRecordingJson(dir)
  const video = screenVideo(dir, meta)
  if (!video) return null
  try {
    const jpeg = await oneOfFew(() => ffmpegOutput(thumbnailArgs(join(dir, video), tMs, meta.fps, THUMBNAIL_HEIGHT)))
    return jpeg.length ? `data:image/jpeg;base64,${jpeg.toString('base64')}` : null
  } catch (e) {
    console.error('thumbnail failed', dir, tMs, e)
    return null
  }
}
