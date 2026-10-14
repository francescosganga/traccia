import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { basename, join } from 'path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { listRecordings, readRecordingJson, type RecordingJson } from '../shared/recording-reader'
import { resizedDimensions, resizeOptions } from '../shared/resize'
import { wholeRecording } from '../shared/edit-list'
import { editRecording, recordingMedia } from './edit-recording'
import * as ffmpeg from './ffmpeg'
import { resizeRecording, resizeRecordingJson } from './resize-recording'

vi.mock('electron', () => ({ app: { isPackaged: false } }))

const dirs: string[] = []
afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

function metadata(format: RecordingJson['format'] = 'mp4'): RecordingJson {
  return {
    version: 1, app: 'traccia', createdAt: '2026-10-01T10:00:00Z', title: 'Demo', format,
    media: format === 'jpg' ? 'frames/' : `recording.${format}`,
    timeline: 'recording.txt', rawTimeline: 'recording-raw.txt', width: 1920, height: 1080, fps: 25, durationMs: 400,
    display: { id: 1, bounds: { x: 0, y: 0, width: 1920, height: 1080 }, scaleFactor: 1 },
    capture: { width: 1920, height: 1080, mimeType: 'video/webm' }, region: null,
    cropPx: { x: 0, y: 0, width: 1920, height: 1080 }, audio: true,
    whisper: { model: 'tiny', language: 'en' }, cursor: [[0, 960, 540], [200, -30, 1100]],
    clicks: [{ t: 200, x: 960, y: 540, button: 'left', speech: 'hello' }],
    transcript: [{ start: 0, end: 0.4, text: 'hello', speaker: 'microphone_1', speakerName: 'Anna' }],
    words: [{ start: 0, end: 0.4, text: 'hello' }], warnings: [], cursorHz: 10, clicksTracked: true
  }
}

async function fixture(meta: RecordingJson): Promise<{ root: string; dir: string }> {
  const root = await mkdtemp(join(tmpdir(), 'traccia-resize-'))
  dirs.push(root)
  const dir = join(root, "demo user's recording")
  await mkdir(dir)
  await writeFile(join(dir, 'recording.json'), JSON.stringify(meta))
  await writeFile(join(dir, 'recording.txt'), 'original timeline')
  return { root, dir }
}

const opts = { cursorHz: 10, onProgress: () => {} }

describe('resize choices and geometry', () => {
  it('offers only lower heights, including native, portrait and region captures', () => {
    expect(resizeOptions('mp4', 3840, 2160)).toEqual(['1080', '720', '480'])
    expect(resizeOptions('mov', 1920, 1080)).toEqual(['720', '480'])
    expect(resizeOptions('webm', 1280, 720)).toEqual(['480'])
    expect(resizeOptions('jpg', 640, 480)).toEqual([])
    expect(resizeOptions('mp4', 600, 800)).toEqual(['720', '480'])
    expect(resizeOptions('m4a', 1920, 1080)).toEqual([])
    expect(resizeOptions('mp4', 1920, NaN)).toEqual([])
    expect(resizedDimensions(1512, 982, '720')).toEqual({ width: 1108, height: 720 })
    expect(() => resizedDimensions(1920, 1080, '1080')).toThrow()
  })

  it('scales click, pointer and webcam coordinates without changing time, audio or edit mappings', () => {
    const meta = metadata()
    meta.edited = { kept: [{ fromMs: 400, toMs: 800 }] }
    meta.webcam = { video: 'composite.mp4', track: { file: 'webcam.webm', offsetMs: 30 }, layout: [
      { t: 100, shape: 'circle', corner: 'bottom-right', visible: true, rect: { x: 1500, y: 750, width: 300, height: 300 } }
    ] }
    const before = structuredClone(meta)
    const result = resizeRecordingJson(meta, '720')
    expect(result).toMatchObject({ width: 1280, height: 720, cursor: [[0, 640, 360], [200, -20, 733]] })
    expect(result.clicks[0]).toEqual({ ...meta.clicks[0], x: 640, y: 360 })
    expect(result.webcam?.layout[0].rect).toEqual({ x: 1000, y: 500, width: 200, height: 200 })
    for (const key of ['durationMs', 'transcript', 'words', 'capture', 'cropPx', 'region', 'edited'] as const) expect(result[key]).toEqual(meta[key])
    expect(result.webcam?.track).toEqual(meta.webcam.track)
    expect(meta).toEqual(before)
  })
})

describe('creating resized recordings', () => {
  for (const format of ['mp4', 'mov', 'webm'] as const) {
    it(`encodes a playable ${format} copy, retaining audio and leaving source files intact`, async () => {
      const meta = metadata(format)
      const { root, dir } = await fixture(meta)
      // Software encoding keeps the test independent of macOS hardware encoder permissions.
      vi.spyOn(ffmpeg, 'videoCodecArgs').mockResolvedValue(format === 'webm' ? ffmpeg.VP9_ARGS : ffmpeg.h264EncoderArgs('libx264', 1280, 720))
      await ffmpeg.runFfmpeg(['-f', 'lavfi', '-i', 'color=c=blue:s=1920x1080:r=25:d=0.4', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=0.4',
        ...(format === 'webm' ? [...ffmpeg.VP9_ARGS, '-c:a', 'libopus'] : [...ffmpeg.h264EncoderArgs('libx264', 1920, 1080), '-c:a', 'aac']), join(dir, meta.media)])
      const originalVideo = await readFile(join(dir, meta.media))
      const result = await resizeRecording(dir, '720', opts)
      expect(result).toMatchObject({ width: 1280, height: 720, format, resized: true })
      expect(await ffmpeg.hasAudioStream(result.videoPath)).toBe(true)
      const pixels = await ffmpeg.ffmpegOutput(['-i', result.videoPath, '-frames:v', '1', '-pix_fmt', 'rgb24', '-f', 'rawvideo', 'pipe:1'])
      expect(pixels.length).toBe(1280 * 720 * 3)
      expect(await readFile(join(dir, meta.media))).toEqual(originalVideo)
      expect(await readRecordingJson(dir)).toEqual(meta)
      expect(await readFile(join(dir, 'recording.txt'), 'utf8')).toBe('original timeline')
      const saved = await readRecordingJson(result.dir)
      expect(saved.transcript).toEqual(meta.transcript)
      expect(saved.clicks[0]).toMatchObject({ x: 640, y: 360 })
      for (const path of [result.txtPath, result.rawTxtPath]) {
        const text = await readFile(path, 'utf8')
        expect(text).toContain('1280x720')
        expect(text).toContain('Anna')
      }
      expect(await readFile(result.promptPath, 'utf8')).toContain(result.dir)
      expect((await listRecordings(root)).map((entry) => entry.dir)).toEqual([result.dir, dir])
    }, 30000)
  }

  it('keeps sparse JPG timestamps, skipped counts and separate audio; repeated copies have separate folders', async () => {
    const meta = metadata('jpg')
    meta.frames = [{ file: 'frames/one.jpg', tMs: 0 }, { file: 'frames/three.jpg', tMs: 300 }]
    meta.skippedFrames = 4
    meta.audioTracks = { microphone: 'microphone.m4a' }
    const { dir } = await fixture(meta)
    await mkdir(join(dir, 'frames'))
    for (const frame of meta.frames) await ffmpeg.runFfmpeg(['-f', 'lavfi', '-i', 'color=c=red:s=1920x1080', '-frames:v', '1', join(dir, frame.file)])
    for (const name of ['audio.m4a', 'microphone.m4a']) await writeFile(join(dir, name), 'unchanged audio')
    const first = await resizeRecording(dir, '720', opts)
    const second = await resizeRecording(dir, '720', opts)
    expect(first.dir).not.toBe(second.dir)
    const saved = await readRecordingJson(first.dir)
    expect(saved.frames?.map((frame) => frame.tMs)).toEqual([0, 300])
    expect(saved.skippedFrames).toBe(4)
    expect(await readdir(join(first.dir, 'frames'))).toHaveLength(2)
    for (const frame of saved.frames!) {
      const pixels = await ffmpeg.ffmpegOutput(['-i', join(first.dir, frame.file), '-pix_fmt', 'rgb24', '-f', 'rawvideo', 'pipe:1'])
      expect(pixels.length).toBe(1280 * 720 * 3)
    }
    for (const name of ['audio.m4a', 'microphone.m4a']) expect(await readFile(join(first.dir, name), 'utf8')).toBe('unchanged audio')
  }, 30000)

  it('removes partial output on encoding failure, and rejects upscaling and audio-only recordings', async () => {
    const meta = metadata()
    const { root, dir } = await fixture(meta)
    await writeFile(join(dir, meta.media), 'broken video')
    vi.spyOn(ffmpeg, 'videoCodecArgs').mockResolvedValue([])
    await expect(resizeRecording(dir, '720', opts)).rejects.toThrow()
    await expect(resizeRecording(dir, '1080', opts)).rejects.toThrow()
    expect(await readdir(root)).toEqual([basename(dir)])
    expect(await readRecordingJson(dir)).toEqual(meta)
    await writeFile(join(dir, 'recording.json'), JSON.stringify({ ...meta, format: 'm4a' }))
    await expect(resizeRecording(dir, '720', opts)).rejects.toThrow()
  })

  it('retains an edited webcam track and mapping, and creates its own original backup on a later edit', async () => {
    const meta = metadata()
    meta.audio = false
    meta.durationMs = 1200
    meta.edited = { kept: [{ fromMs: 400, toMs: 1600 }] }
    meta.webcam = { video: 'composite.mp4', track: { file: 'webcam.webm', offsetMs: 0 }, layout: [
      { t: 0, visible: true, corner: 'bottom-right', shape: 'circle', rect: { x: 1500, y: 750, width: 300, height: 300 } }
    ] }
    const { dir } = await fixture(meta)
    vi.spyOn(ffmpeg, 'videoCodecArgs').mockResolvedValue(ffmpeg.h264EncoderArgs('libx264', 1280, 720))
    for (const name of [meta.media, meta.webcam.video, meta.webcam.track!.file]) {
      await ffmpeg.runFfmpeg(['-f', 'lavfi', '-i', 'color=c=blue:s=1920x1080:r=25:d=1.6',
        ...(name.endsWith('.webm') ? ffmpeg.VP9_ARGS : ffmpeg.h264EncoderArgs('libx264', 1920, 1080)), join(dir, name)])
    }
    const result = await resizeRecording(dir, '720', opts)
    const media = await recordingMedia(result.dir)
    expect(media.webcam?.editing).toBe('full')
    expect(media.webcam?.track?.kept).toEqual(meta.edited.kept)
    expect(media.edited).toBe(false)
    const parts = wholeRecording(meta.durationMs).map((part) => ({ ...part, webcam: { visible: false, shape: 'circle' as const, corner: 'bottom-right' as const } }))
    await editRecording(result.dir, parts, opts)
    expect(await readdir(join(result.dir, 'original'))).toContain('recording.json')
    expect((await recordingMedia(result.dir)).edited).toBe(true)
    expect(await readRecordingJson(dir)).toEqual(meta)
  }, 30000)
})
