import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { EngineStartCommand } from '../../shared/types'
import { installEngine } from './engine'

const media = vi.hoisted(() => ({ openMic: vi.fn(), openCamera: vi.fn() }))
vi.mock('./media', () => ({ ...media, levelMeter: () => ({ read: () => 0, close: () => {} }) }))

class Track {
  readyState = 'live'
  onended: (() => void) | null = null
  constructor(readonly kind: 'audio' | 'video') {}
  getSettings() { return this.kind === 'video' ? { width: 1920, height: 1080 } : {} }
  stop() { this.readyState = 'ended' }
}
class Stream {
  constructor(private tracks: Track[]) {}
  getTracks() { return this.tracks }
  getAudioTracks() { return this.tracks.filter((t) => t.kind === 'audio') }
  getVideoTracks() { return this.tracks.filter((t) => t.kind === 'video') }
}
class Recorder {
  static instances: Recorder[] = []
  static isTypeSupported() { return true }
  state = 'inactive'
  onstart: (() => void) | null = null
  onstop: (() => void) | null = null
  mimeType: string
  constructor(readonly stream: Stream, options: MediaRecorderOptions) {
    this.mimeType = options.mimeType ?? ''
    Recorder.instances.push(this)
  }
  start() { this.state = 'recording'; this.onstart?.() }
  stop() { this.state = 'inactive'; this.onstop?.() }
  addEventListener(_type: string, cb: () => void) { this.onstop = cb }
}

let start: (command: EngineStartCommand) => Promise<void>
const display = vi.fn()
const started = vi.fn()
const error = vi.fn()
const command: EngineStartCommand = { audioOnly: true, audio: true, micDevice: null, systemAudio: false, webcam: false, webcamDevice: null, frameRate: 30 }

beforeEach(() => {
  vi.useFakeTimers()
  vi.clearAllMocks()
  Recorder.instances = []
  vi.stubGlobal('MediaStream', Stream)
  vi.stubGlobal('MediaRecorder', Recorder)
  vi.stubGlobal('navigator', { mediaDevices: { getDisplayMedia: display } })
  vi.stubGlobal('window', { api: { engine: {
    onStart: (cb: typeof start) => { start = cb }, onStop: () => {},
    started, error, chunk: () => {}, sideChunk: () => {}, sideStarted: () => {}, level: () => {}, stopped: () => {}
  } } })
  media.openMic.mockResolvedValue({ stream: new Stream([new Track('audio')]), fallback: false, callQuality: false })
  display.mockResolvedValue(new Stream([new Track('video'), new Track('audio')]))
  installEngine()
})
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

describe('audio-only capture', () => {
  it('records a microphone without requesting screen capture', async () => {
    await start(command)
    expect(display).not.toHaveBeenCalled()
    expect(Recorder.instances).toHaveLength(1)
    expect(Recorder.instances[0].stream.getVideoTracks()).toHaveLength(0)
    expect(started).toHaveBeenCalledWith(expect.objectContaining({ width: 0, height: 0, hasAudio: true, mimeType: 'audio/webm;codecs=opus' }))
  })

  it('keeps microphone and loopback on separate recorders without encoding screen pixels', async () => {
    await start({ ...command, systemAudio: true })
    expect(display).toHaveBeenCalledOnce()
    expect(Recorder.instances).toHaveLength(2)
    for (const recorder of Recorder.instances) expect(recorder.stream.getVideoTracks()).toHaveLength(0)
    expect(Recorder.instances[0].stream.getAudioTracks()[0]).not.toBe(Recorder.instances[1].stream.getAudioTracks()[0])
    expect(started).toHaveBeenCalledWith(expect.objectContaining({ hasAudio: true, hasSystemAudio: true }))
  })

  it('records system audio with the microphone disabled or unavailable', async () => {
    await start({ ...command, audio: false, systemAudio: true })
    expect(media.openMic).not.toHaveBeenCalled()
    expect(started).toHaveBeenCalledWith(expect.objectContaining({ hasAudio: false, hasSystemAudio: true }))
    for (const recorder of Recorder.instances) expect(recorder.stream.getVideoTracks()).toHaveLength(0)
  })

  it('fails clearly if no audio source is available', async () => {
    await start({ ...command, audio: false })
    expect(error).toHaveBeenCalledOnce()
    expect(started).not.toHaveBeenCalled()
    expect(Recorder.instances).toHaveLength(0)
  })

  it('still captures video in screen mode', async () => {
    await start({ ...command, audioOnly: false })
    expect(Recorder.instances.at(-1)?.stream.getVideoTracks()).toHaveLength(1)
    expect(started).toHaveBeenCalledWith(expect.objectContaining({ width: 1920, height: 1080 }))
  })
})
