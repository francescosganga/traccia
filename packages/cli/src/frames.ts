import { execFile } from 'child_process'
import { accessSync, constants, readFileSync } from 'fs'
import { delimiter, join, sep } from 'path'
import { formatTime, listFrames, sampleTimes, selectFrames, type RecordingJson } from '../../../src/shared/recording-reader'

/** Widest image handed to a model: enough to read UI text, cheap in tokens. */
export const MAX_WIDTH = 1024
export const JPEG_QUALITY = 72

export interface RenderedFrame {
  tMs: number
  /** The frame file ("frames/frame_00003.jpg"), or the video a still was extracted from */
  label: string
  jpeg: Buffer
}

export interface FrameSelection {
  from?: number
  to?: number
  max: number
  maxWidth?: number
}

/**
 * Frames of a recording as JPEGs no wider than `maxWidth`: the stored JPGs for a JPG
 * recording, otherwise stills extracted from the video with ffmpeg.
 */
export async function renderFrames(dir: string, meta: RecordingJson, sel: FrameSelection): Promise<RenderedFrame[]> {
  const maxWidth = sel.maxWidth ?? MAX_WIDTH
  if (meta.format === 'jpg') {
    const picked = selectFrames(listFrames(dir, meta), sel)
    const out: RenderedFrame[] = []
    for (const f of picked) out.push({ tMs: f.tMs, label: f.file, jpeg: await downscale(f.path, maxWidth) })
    return out
  }
  const ffmpeg = findFfmpeg()
  if (!ffmpeg) {
    throw new Error(
      'this is a video recording and ffmpeg was not found: install ffmpeg (or set TRACCIA_FFMPEG to its path) to extract frames, ' +
        'or record in JPG mode'
    )
  }
  const video = join(dir, meta.media)
  const out: RenderedFrame[] = []
  for (const tMs of sampleTimes(meta.durationMs, sel)) {
    out.push({ tMs, label: meta.media, jpeg: await extractStill(ffmpeg, video, tMs, maxWidth) })
  }
  return out
}

type Sharp = typeof import('sharp').default

let sharpModule: Sharp | null | undefined

/** Loads sharp on first use; a missing or broken native build degrades to the original file. */
function loadSharp(): Sharp | null {
  if (sharpModule !== undefined) return sharpModule
  try {
    // The bundle is CommonJS, so this is sharp's CJS entry: the function itself.
    sharpModule = require('sharp') as Sharp
  } catch (e) {
    console.error('sharp is not available, frames are sent at their original size:', (e as Error).message)
    sharpModule = null
  }
  return sharpModule
}

export async function downscale(path: string, maxWidth: number): Promise<Buffer> {
  const sharp = loadSharp()
  if (!sharp) return readFileSync(path)
  return sharp(path).resize({ width: maxWidth, withoutEnlargement: true }).jpeg({ quality: JPEG_QUALITY }).toBuffer()
}

function extractStill(ffmpeg: string, video: string, tMs: number, maxWidth: number): Promise<Buffer> {
  const args = [
    '-hide_banner', '-loglevel', 'error',
    '-ss', (tMs / 1000).toFixed(3),
    '-i', video,
    '-frames:v', '1',
    '-vf', `scale='min(${maxWidth},iw)':-2`,
    '-q:v', '4',
    '-f', 'image2pipe', '-vcodec', 'mjpeg', 'pipe:1'
  ]
  return new Promise((resolve, reject) => {
    execFile(ffmpeg, args, { encoding: 'buffer', maxBuffer: 64 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) reject(new Error(`ffmpeg failed at ${formatTime(tMs)}: ${stderr.toString().trim() || err.message}`))
      else if (!stdout.length) reject(new Error(`ffmpeg produced no frame at ${formatTime(tMs)}`))
      else resolve(stdout)
    })
  })
}

let ffmpegPath: string | null | undefined

const FFMPEG_IN_APP = 'app.asar.unpacked/node_modules/ffmpeg-static/ffmpeg'

/**
 * ffmpeg from TRACCIA_FFMPEG, the app this script is bundled in (cli/traccia.cjs inside
 * app.asar), the PATH, the ffmpeg-static package when installed next to the CLI (the
 * monorepo), or the app installed in /Applications.
 */
export function findFfmpeg(): string | null {
  if (ffmpegPath !== undefined) return ffmpegPath
  const candidates: string[] = []
  if (process.env.TRACCIA_FFMPEG) candidates.push(process.env.TRACCIA_FFMPEG)
  const asar = __dirname.indexOf(`${sep}app.asar${sep}`)
  if (asar >= 0) candidates.push(join(__dirname.slice(0, asar), FFMPEG_IN_APP + (process.platform === 'win32' ? '.exe' : '')))
  for (const dir of (process.env.PATH ?? '').split(delimiter)) if (dir) candidates.push(join(dir, 'ffmpeg'))
  try {
    const p = require('ffmpeg-static') as string | null
    if (p) candidates.push(p)
  } catch {
    // not installed: fine
  }
  if (process.platform === 'darwin') candidates.push(join('/Applications/Traccia.app/Contents/Resources', FFMPEG_IN_APP))
  ffmpegPath = candidates.find(isExecutable) ?? null
  return ffmpegPath
}

function isExecutable(path: string): boolean {
  try {
    accessSync(path, constants.X_OK)
    return true
  } catch {
    return false
  }
}
