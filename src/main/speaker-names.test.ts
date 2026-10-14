import { mkdtemp, readFile, rm, writeFile, access } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { wholeRecording } from '../shared/edit-list'
import type { RecordingJson } from '../shared/recording-reader'
import { transcriptText } from '../shared/recording-reader'
import { editRecording } from './edit-recording'
import { editRecordingJson } from './edit'
import { runFfmpeg } from './ffmpeg'

vi.mock('./ffmpeg', () => ({ runFfmpeg: vi.fn(), hasAudioStream: vi.fn(), ffmpegOutput: vi.fn(), videoCodecArgs: vi.fn() }))
const dirs: string[] = []
afterEach(async () => { await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))) })

describe('saving speaker names', () => {
  it('rewrites both exports and JSON, leaves media untouched, and retains names through a later cut', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'traccia-names-'))
    dirs.push(dir)
    const span = { start: 0.5, end: 1.5, text: 'hello', speaker: 'system_1', source: 'system' as const }
    const meta: RecordingJson = {
      version: 1, app: 'traccia', createdAt: '2026-10-14T10:00:00Z', format: 'm4a', media: 'audio.m4a',
      timeline: 'recording.txt', rawTimeline: 'recording-raw.txt', width: 0, height: 0, fps: 0, durationMs: 3000,
      display: { id: 1, bounds: { x: 0, y: 0, width: 100, height: 100 }, scaleFactor: 1 },
      capture: { width: 0, height: 0, mimeType: 'audio/webm' }, region: null, cropPx: { x: 0, y: 0, width: 0, height: 0 },
      audio: false, systemAudio: true, conversation: true, audioTracks: { system: 'system.m4a' },
      whisper: { model: 'small', language: 'en' }, cursor: [], clicks: [], transcript: [span], words: [span], warnings: []
    }
    await writeFile(join(dir, 'recording.json'), JSON.stringify(meta))
    for (const name of ['audio.m4a', 'system.m4a']) await writeFile(join(dir, name), 'unchanged audio')
    const opts = { cursorHz: 10, onProgress: () => {}, speakerNames: { system_1: 'Anna' } }
    await editRecording(dir, wholeRecording(3000), opts)
    const saved: RecordingJson = JSON.parse(await readFile(join(dir, 'recording.json'), 'utf8'))
    expect(saved.transcript?.[0]).toEqual({ ...span, speakerName: 'Anna' })
    expect(saved.words[0].speakerName).toBe('Anna')
    expect(transcriptText(saved)).toContain('[Anna] hello')
    for (const name of ['recording.txt', 'recording-raw.txt']) expect(await readFile(join(dir, name), 'utf8')).toContain('[Anna] hello')
    for (const name of ['audio.m4a', 'system.m4a']) expect(await readFile(join(dir, name), 'utf8')).toBe('unchanged audio')
    expect(runFfmpeg).not.toHaveBeenCalled()
    expect(saved.edited).toBeUndefined()
    // A name-only edit must not consume the media editor's first-original backup.
    await expect(access(join(dir, 'original'))).rejects.toThrow()
    const cut = editRecordingJson(saved, [{ from: 0, to: 500, removed: true }, { from: 500, to: 3000 }])
    expect(cut.transcript?.[0]).toMatchObject({ start: 0, end: 1, speaker: 'system_1', speakerName: 'Anna' })
    await editRecording(dir, wholeRecording(3000), { ...opts, speakerNames: { system_1: '' } })
    expect(await readFile(join(dir, 'recording.txt'), 'utf8')).toContain('[system_1] hello')
    const before = await readFile(join(dir, 'recording.json'), 'utf8')
    await expect(editRecording(dir, wholeRecording(3000), { ...opts, speakerNames: { unknown: 'Name' } })).rejects.toThrow()
    expect(await readFile(join(dir, 'recording.json'), 'utf8')).toBe(before)
  })
})
