import { protocol } from 'electron'
import { createReadStream } from 'fs'
import { realpath, stat } from 'fs/promises'
import { extname, resolve } from 'path'
import { Readable } from 'stream'
import { MEDIA_SCHEME, mediaPath } from '../shared/media-url'
import { getSettings } from './settings'

// .mov is QuickTime's flavour of MP4: Chromium plays the H.264 inside when it is served as MP4
const TYPES: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.mov': 'video/mp4',
  '.webm': 'video/webm',
  '.m4a': 'audio/mp4',
  '.jpg': 'image/jpeg'
}

/** Call before app.whenReady. `stream` lets a <video> seek with range requests. */
export function registerMediaScheme(): void {
  protocol.registerSchemesAsPrivileged([{ scheme: MEDIA_SCHEME, privileges: { standard: true, secure: true, stream: true } }])
}

/**
 * Serves the files of the recordings to the main window (the trim view), read-only and only from
 * inside the configured output folder, symlinks resolved. Range requests are answered by hand:
 * seeking a video needs them.
 */
export function handleMediaProtocol(): void {
  protocol.handle(MEDIA_SCHEME, async (request) => {
    if (request.method !== 'GET' && request.method !== 'HEAD') return new Response(null, { status: 405 })
    const root = resolve(getSettings().outputDir)
    const path = mediaPath(request.url, root)
    if (!path) return new Response(null, { status: 403 })
    let file: string
    let size: number
    try {
      file = await realpath(path)
      if (!file.startsWith((await realpath(root)) + '/')) return new Response(null, { status: 403 })
      const s = await stat(file)
      if (!s.isFile()) return new Response(null, { status: 404 })
      size = s.size
    } catch {
      return new Response(null, { status: 404 })
    }

    const headers: Record<string, string> = { 'Content-Type': TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream', 'Accept-Ranges': 'bytes' }
    let start = 0
    let end = size - 1
    const range = /^bytes=(\d*)-(\d*)$/.exec(request.headers.get('range') ?? '')
    if (range && (range[1] || range[2])) {
      // "bytes=-500" is the last 500 bytes
      start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]))
      end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1
      if (start > end) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } })
      headers['Content-Range'] = `bytes ${start}-${end}/${size}`
    }
    headers['Content-Length'] = String(Math.max(0, end - start + 1))
    const status = headers['Content-Range'] ? 206 : 200
    if (request.method === 'HEAD' || size === 0) return new Response(null, { status, headers })
    const body = Readable.toWeb(createReadStream(file, { start, end })) as ReadableStream<Uint8Array>
    return new Response(body, { status, headers })
  })
}
