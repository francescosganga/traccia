import { spawn } from 'child_process'
import { app } from 'electron'

/** Path of the bundled ffmpeg binary (unpacked from asar in production). TRACCIA_FFMPEG overrides it. */
export function ffmpegPath(): string {
  if (process.env.TRACCIA_FFMPEG) return process.env.TRACCIA_FFMPEG
  const p = require('ffmpeg-static') as string
  return app.isPackaged ? p.replace('app.asar', 'app.asar.unpacked') : p
}

export interface RunOptions {
  /** Expected output duration in ms, used to compute progress */
  durationMs?: number
  onProgress?: (fraction: number) => void
  signal?: AbortSignal
}

/** Runs ffmpeg and resolves when it exits successfully. Progress is parsed from `-progress pipe:1`. */
export function runFfmpeg(args: string[], opts: RunOptions = {}): Promise<string> {
  return new Promise((resolve, reject) => {
    const full = ['-hide_banner', '-y', '-nostats', '-loglevel', 'error', '-progress', 'pipe:1', ...args]
    const child = spawn(ffmpegPath(), full)
    let stderr = ''
    let stdoutBuf = ''

    child.stdout.on('data', (d) => {
      stdoutBuf += d.toString()
      const lines = stdoutBuf.split('\n')
      stdoutBuf = lines.pop() ?? ''
      for (const line of lines) {
        const m = /^out_time_(us|ms)=(\d+)/.exec(line)
        if (m && opts.durationMs && opts.onProgress) {
          const us = Number(m[2]) // both keys are reported in microseconds by ffmpeg
          opts.onProgress(Math.min(1, us / 1000 / opts.durationMs))
        }
      }
    })
    child.stderr.on('data', (d) => (stderr += d.toString()))
    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0) resolve(stderr)
      else reject(new Error(`ffmpeg exited with code ${code}: ${stderr.trim().slice(-800)}`))
    })
    opts.signal?.addEventListener('abort', () => child.kill('SIGKILL'))
  })
}

let encoderCache: string | null = null

/** Picks a hardware H.264 encoder when available, otherwise libx264. */
export async function h264Encoder(): Promise<string> {
  if (encoderCache) return encoderCache
  encoderCache = 'libx264'
  try {
    const list = await new Promise<string>((resolve) => {
      const child = spawn(ffmpegPath(), ['-hide_banner', '-encoders'])
      let out = ''
      child.stdout.on('data', (d) => (out += d.toString()))
      child.on('close', () => resolve(out))
      child.on('error', () => resolve(''))
    })
    if (process.platform === 'darwin' && /h264_videotoolbox/.test(list)) encoderCache = 'h264_videotoolbox'
  } catch {
    /* keep libx264 */
  }
  return encoderCache
}

export function h264EncoderArgs(encoder: string, width: number, height: number): string[] {
  if (encoder === 'h264_videotoolbox') {
    const bitrate = Math.min(40_000_000, Math.round(width * height * 30 * 0.08))
    return ['-c:v', 'h264_videotoolbox', '-b:v', String(bitrate), '-profile:v', 'high', '-pix_fmt', 'yuv420p']
  }
  return ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '21', '-pix_fmt', 'yuv420p']
}
