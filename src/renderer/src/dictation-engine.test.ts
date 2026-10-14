import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DictationCapture } from '../../shared/dictation'
import { installDictationEngine } from './dictation-engine'

const media = vi.hoisted(() => ({ openMic: vi.fn(), close: vi.fn(), rms: 0.05 }))
vi.mock('./media', () => ({ openMic: media.openMic, levelMeter: () => ({ read: () => 0.5, readRms: () => media.rms, close: media.close }) }))

class Track {
  label = 'Test mic'
  stop = vi.fn()
  onended: (() => void) | null = null
}
class Recorder {
  static instance: Recorder | null = null
  static isTypeSupported() { return true }
  state = 'inactive'
  onstart: (() => void) | null = null
  onstop: (() => void) | null = null
  ondataavailable: ((event: { data: { size: number; arrayBuffer(): Promise<ArrayBuffer> } }) => void) | null = null
  constructor() { Recorder.instance = this }
  start() { this.state = 'recording'; this.onstart?.() }
  stop() { this.state = 'inactive'; this.onstop?.() }
}

let capture: (cmd: DictationCapture) => Promise<void>
let stop: (id: number) => void
let cancel: () => void
let track: Track
const started = vi.fn()
const stopped = vi.fn()
const chunk = vi.fn()
const error = vi.fn()
const empty = vi.fn()
const drain = async () => { for (let i = 0; i < 12; i++) await Promise.resolve() }

beforeEach(() => {
  vi.useFakeTimers()
  vi.clearAllMocks()
  Recorder.instance = null
  media.rms = 0.05
  track = new Track()
  media.openMic.mockResolvedValue({ stream: { getTracks: () => [track], getAudioTracks: () => [track] }, fallback: false, callQuality: false })
  chunk.mockResolvedValue(undefined)
  stopped.mockResolvedValue(undefined)
  vi.stubGlobal('MediaRecorder', Recorder)
  vi.stubGlobal('window', { api: { dictation: {
    onCapture: (cb: typeof capture) => { capture = cb }, onStop: (cb: typeof stop) => { stop = cb }, onCancel: (cb: typeof cancel) => { cancel = cb },
    started, stopped, chunk, error, empty
  } } })
  installDictationEngine(() => {})
})
afterEach(() => { cancel(); vi.useRealTimers(); vi.unstubAllGlobals() })

describe('dictation microphone lifecycle', () => {
  it('closes a microphone that finishes opening after cancellation', async () => {
    let resolve!: (value: unknown) => void
    media.openMic.mockReturnValue(new Promise((r) => { resolve = r }))
    const opening = capture({ id: 1, mic: null })
    cancel()
    resolve({ stream: { getTracks: () => [track] } })
    await opening
    expect(track.stop).toHaveBeenCalledOnce()
    expect(started).not.toHaveBeenCalled()
  })

  it('waits for all audio writes before reporting stopped and releases the microphone immediately', async () => {
    let resolve!: () => void
    chunk.mockReturnValue(new Promise<void>((r) => { resolve = r }))
    await capture({ id: 1, mic: null })
    Recorder.instance!.ondataavailable!({ data: { size: 4, arrayBuffer: async () => new ArrayBuffer(4) } })
    stop(1)
    await drain()
    expect(track.stop).toHaveBeenCalledOnce()
    expect(stopped).not.toHaveBeenCalled()
    resolve()
    await drain()
    expect(stopped).toHaveBeenCalledWith(1, false)
  })

  it('does not transcribe discarded audio or obey an old stop command', async () => {
    await capture({ id: 2, mic: null })
    stop(1)
    expect(Recorder.instance!.state).toBe('recording')
    cancel()
    await drain()
    expect(stopped).not.toHaveBeenCalled()
    expect(track.stop).toHaveBeenCalledOnce()
  })

  it('stops after speech followed by silence without a UI command', async () => {
    await capture({ id: 4, mic: null })
    await vi.advanceTimersByTimeAsync(400)
    media.rms = 0
    await vi.advanceTimersByTimeAsync(1600)
    expect(stopped).toHaveBeenCalledWith(4, false)
    expect(track.stop).toHaveBeenCalledOnce()
    expect(empty).not.toHaveBeenCalled()
  })

  it('discards initial silence instead of transcribing it', async () => {
    media.rms = 0
    await capture({ id: 5, mic: null })
    await vi.advanceTimersByTimeAsync(8100)
    expect(empty).toHaveBeenCalledWith(5)
    expect(stopped).not.toHaveBeenCalled()
    expect(track.stop).toHaveBeenCalledOnce()
  })

  it('preserves captured audio when the microphone disconnects', async () => {
    await capture({ id: 3, mic: null })
    track.onended!()
    await drain()
    expect(stopped).toHaveBeenCalledWith(3, true)
    expect(media.close).toHaveBeenCalled()
  })
})
