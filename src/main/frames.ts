import { mkdir, readFile, readdir, rename, rm, unlink } from 'fs/promises'
import { join } from 'path'
import { runFfmpeg } from './ffmpeg'
import type { FrameRef } from '../shared/recording-reader'
import { mapPoint, sampleAt, type Geometry } from './timeline'
import type { CursorSample } from '../shared/types'

const THUMB_WIDTH = 480
const DIFF_THRESHOLD = 28 // gray levels
const MIN_CHANGED_PIXELS = 8
const CURSOR_MASK_RADIUS = 14 // thumbnail pixels

export interface ExtractOptions {
  input: string
  recordingDir: string
  fps: number
  filters: string[]
  durationMs: number
  skipUnchanged: boolean
  geometry: Geometry
  samples: CursorSample[]
  t0: number
  onProgress: (fraction: number) => void
}

/**
 * Extracts JPEG frames at the requested rate. When `skipUnchanged` is on, ffmpeg also
 * writes small grayscale thumbnails that are compared in Node to drop frames where
 * nothing but the cursor changed.
 */
export async function extractFrames(opts: ExtractOptions): Promise<{ frames: FrameRef[]; skipped: number }> {
  const framesDir = join(opts.recordingDir, 'frames')
  await rm(framesDir, { recursive: true, force: true })
  await mkdir(framesDir, { recursive: true })
  const thumbsPath = join(opts.recordingDir, 'thumbs.raw')

  const chain = [`fps=${opts.fps}`, ...opts.filters].join(',')
  const args = ['-i', opts.input]
  if (opts.skipUnchanged) {
    args.push(
      '-filter_complex',
      `[0:v]${chain},split=2[a][b];[b]scale=${THUMB_WIDTH}:-2,format=gray[t]`,
      '-map', '[a]', '-q:v', '3', '-start_number', '1', join(framesDir, 'tmp_%05d.jpg'),
      '-map', '[t]', '-f', 'rawvideo', thumbsPath
    )
  } else {
    args.push('-vf', chain, '-q:v', '3', '-start_number', '1', join(framesDir, 'tmp_%05d.jpg'))
  }
  await runFfmpeg(args, { durationMs: opts.durationMs, onProgress: opts.onProgress })

  const files = (await readdir(framesDir)).filter((f) => f.startsWith('tmp_')).sort()
  const frameMs = 1000 / opts.fps
  let keep: boolean[] = files.map(() => true)

  if (opts.skipUnchanged && files.length > 1) {
    try {
      keep = computeKeepMask(await readFile(thumbsPath), files.length, opts, frameMs)
    } catch (e) {
      console.error('frame dedup failed, keeping all frames', e)
    }
  }
  await rm(thumbsPath, { force: true })

  const frames: FrameRef[] = []
  let skipped = 0
  let n = 0
  for (let i = 0; i < files.length; i++) {
    const src = join(framesDir, files[i])
    if (!keep[i]) {
      skipped++
      await unlink(src)
      continue
    }
    n++
    const name = `frame_${String(n).padStart(5, '0')}.jpg`
    await rename(src, join(framesDir, name))
    frames.push({ file: `frames/${name}`, tMs: Math.round(i * frameMs) })
  }
  return { frames, skipped }
}

/**
 * Which frames to keep: each grayscale thumbnail is compared with the last kept one, ignoring
 * a small square around the pointer. `buf` is the raw THUMB_WIDTH-wide stream written by ffmpeg.
 */
export function computeKeepMask(
  buf: Buffer,
  count: number,
  opts: Pick<ExtractOptions, 'geometry' | 'samples' | 't0'>,
  frameMs: number
): boolean[] {
  const w = THUMB_WIDTH
  const h = Math.floor(buf.length / (w * count))
  if (h <= 0 || w * h * count !== buf.length) throw new Error(`unexpected thumbnail buffer size ${buf.length}`)
  const thumbScale = w / opts.geometry.outWidth

  const cursorAt = (i: number): { x: number; y: number } | null => {
    const s = sampleAt(opts.samples, opts.t0 + i * frameMs)
    if (!s) return null
    const p = mapPoint(opts.geometry, s.x, s.y)
    return { x: p.x * thumbScale, y: p.y * thumbScale }
  }
  const masked = (x: number, y: number, c: { x: number; y: number } | null): boolean =>
    !!c && Math.abs(x - c.x) <= CURSOR_MASK_RADIUS && Math.abs(y - c.y) <= CURSOR_MASK_RADIUS

  const keep: boolean[] = new Array(count).fill(false)
  keep[0] = true
  let ref = 0
  for (let i = 1; i < count; i++) {
    const a = ref * w * h
    const b = i * w * h
    const ca = cursorAt(ref)
    const cb = cursorAt(i)
    let changed = 0
    outer: for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const idx = y * w + x
        if (Math.abs(buf[a + idx] - buf[b + idx]) <= DIFF_THRESHOLD) continue
        if (masked(x, y, ca) || masked(x, y, cb)) continue
        if (++changed >= MIN_CHANGED_PIXELS) break outer
      }
    }
    if (changed >= MIN_CHANGED_PIXELS) {
      keep[i] = true
      ref = i
    }
  }
  return keep
}
