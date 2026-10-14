import { existsSync } from 'fs'
import { copyFile, mkdir, mkdtemp, realpath, rename, rm, writeFile } from 'fs/promises'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'path'
import { t } from '../shared/i18n'
import { readRecordingJson, type RecordingJson } from '../shared/recording-reader'
import { resizedDimensions, resizeOptions, type ResizeResolution } from '../shared/resize'
import type { ProcessingProgress, RecordingResult } from '../shared/types'
import { runFfmpeg, videoCodecArgs } from './ffmpeg'
import { recordingTexts, textsInputFromJson } from './texts'

/** Coordinates already refer to output pixels; capture geometry and timestamps stay as recorded. */
export function resizeRecordingJson(meta: RecordingJson, target: ResizeResolution): RecordingJson {
  if (!resizeOptions(meta.format, meta.width, meta.height).includes(target)) throw new RangeError('invalid resize resolution')
  const { width, height } = resizedDimensions(meta.width, meta.height, target)
  const x = (value: number) => Math.round(value * width / meta.width)
  const y = (value: number) => Math.round(value * height / meta.height)
  return {
    ...meta, width, height,
    cursor: meta.cursor.map(([time, px, py]) => [time, x(px), y(py)]),
    clicks: meta.clicks.map((click) => ({ ...click, x: x(click.x), y: y(click.y) })),
    webcam: meta.webcam ? {
      ...meta.webcam,
      layout: meta.webcam.layout.map((event) => ({
        ...event, rect: { x: x(event.rect.x), y: y(event.rect.y), width: x(event.rect.width), height: y(event.rect.height) }
      }))
    } : undefined
  }
}

/** Creates a complete independent recording beside the source, publishing it only after every file succeeds. */
export async function resizeRecording(dir: string, target: ResizeResolution, opts: {
  cursorHz: number
  onProgress: (progress: ProcessingProgress) => void
}): Promise<RecordingResult> {
  dir = resolve(dir)
  const sourceRoot = await realpath(dir)
  const meta = await readRecordingJson(dir)
  const json = resizeRecordingJson(meta, target)
  const staging = await mkdtemp(join(dirname(dir), '.resize-'))
  const output = join(dirname(dir), `${basename(dir)}-${target}p-${basename(staging).slice('.resize-'.length)}`)
  const source = async (name: string): Promise<string> => {
    const path = await realpath(resolve(dir, name))
    const rel = relative(sourceRoot, path)
    if (isAbsolute(name) || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel) || !rel) throw new Error('invalid recording file path')
    return path
  }
  const destination = async (name: string): Promise<string> => {
    const path = resolve(staging, name)
    const rel = relative(staging, path)
    if (isAbsolute(name) || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel) || !rel) throw new Error('invalid recording file path')
    await mkdir(dirname(path), { recursive: true })
    return path
  }
  const copied = new Set<string>()
  const copy = async (name: string) => {
    if (copied.has(name)) return
    await copyFile(await source(name), await destination(name))
    copied.add(name)
  }
  const step = t('resize.progress', { resolution: target })
  const progress = (value: number) => opts.onProgress({ step, progress: value })
  try {
    progress(0)
    const scale = `scale=${json.width}:${json.height}:flags=lanczos,setsar=1`
    if (meta.format === 'jpg') {
      if (!meta.frames?.length) throw new Error('recording has no frames')
      // The concat list preserves sparse, deduplicated frames without inventing intermediate ones.
      const paths: string[] = []
      for (const frame of meta.frames) paths.push(await source(frame.file))
      const manifest = join(staging, '.frames.txt')
      await writeFile(manifest, paths.map((path) => `file '${path.replace(/'/g, "'\\''")}'`).join('\n') + '\n')
      await mkdir(join(staging, 'frames'))
      await runFfmpeg(['-f', 'concat', '-safe', '0', '-i', manifest, '-vf', scale, '-fps_mode', 'passthrough', '-q:v', '3', '-start_number', '1', join(staging, 'frames/frame_%05d.jpg')], {
        durationMs: paths.length * 40, onProgress: progress
      })
      json.media = 'frames/'
      json.frames = meta.frames.map((frame, i) => ({ ...frame, file: `frames/frame_${String(i + 1).padStart(5, '0')}.jpg` }))
      for (const frame of json.frames) {
        if (!existsSync(join(staging, frame.file))) throw new Error('resized frame missing')
      }
      await rm(manifest)
      if (existsSync(join(dir, 'audio.m4a'))) await copy('audio.m4a')
    } else {
      const videos = [...new Set([meta.media, ...(meta.webcam ? [meta.webcam.video] : [])])]
      for (const [i, name] of videos.entries()) {
        await runFfmpeg(['-i', await source(name), '-map', '0:v:0', '-map', '0:a?', '-vf', scale,
          ...(await videoCodecArgs(meta.format, json.width, json.height)), '-c:a', 'copy', await destination(name)], {
          durationMs: meta.durationMs, onProgress: (value) => progress((i + value) / videos.length)
        })
      }
    }
    for (const name of Object.values(meta.audioTracks ?? {})) if (name) await copy(name)
    // Keep the source track and edit mapping together so webcam edits remain possible on the copy.
    if (meta.webcam?.track) await copy(meta.webcam.track.file)

    json.title = `${meta.title || basename(dir)} · ${target}p`
    json.createdAt = new Date().toISOString()
    json.timeline = 'recording.txt'
    json.rawTimeline = 'recording-raw.txt'
    json.prompt = 'PROMPT.md'
    const after = textsInputFromJson(json, opts.cursorHz)
    json.cursorHz = after.input.cursorHz
    json.clicksTracked = after.clicksTracked
    const texts = recordingTexts(after.input, output, after.clicksTracked)
    await writeFile(join(staging, 'recording.txt'), texts.txt)
    await writeFile(join(staging, 'recording-raw.txt'), texts.rawTxt)
    await writeFile(join(staging, 'PROMPT.md'), texts.prompt)
    await writeFile(join(staging, 'recording.json'), JSON.stringify(json))
    await rename(staging, output)
  } finally {
    await rm(staging, { recursive: true, force: true }).catch((error) => console.error('cannot remove resize staging', staging, error))
  }
  return {
    dir: output, mediaPath: join(output, json.media), videoPath: join(output, json.webcam?.video ?? json.media),
    txtPath: join(output, 'recording.txt'), rawTxtPath: join(output, 'recording-raw.txt'), jsonPath: join(output, 'recording.json'),
    promptPath: join(output, 'PROMPT.md'), durationMs: json.durationMs, format: json.format, width: json.width, height: json.height,
    frames: json.frames?.length, skippedFrames: json.skippedFrames, transcriptSegments: json.transcript?.length,
    warnings: json.warnings ?? [], resized: true
  }
}
