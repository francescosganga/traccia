/**
 * Capture engine: lives in the (hidden) main window and does the actual recording
 * with getDisplayMedia + getUserMedia + MediaRecorder. Chunks are streamed to the
 * main process, which writes them to disk. The webcam, when asked for, has its own
 * recorder and file: it is laid over the screen only when the video is put together.
 */

import { t } from '../../shared/i18n'
import { levelMeter, openCamera, openMic, type LevelMeter } from './media'

const MIME_CANDIDATES = [
  'video/webm;codecs=h264,opus',
  'video/webm;codecs=avc1,opus',
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp8,opus',
  'video/webm'
]

// The webcam file is an intermediate, deleted once composited: VP8 is cheap to encode
const WEBCAM_MIME_CANDIDATES = ['video/webm;codecs=vp8', 'video/webm']
const WEBCAM_BITRATE = 2_500_000

function pickMimeType(candidates: string[]): string {
  for (const m of candidates) if (MediaRecorder.isTypeSupported(m)) return m
  return ''
}

// How often the widget receives the microphone level while recording
const LEVEL_INTERVAL = 66

function bitrateFor(width: number, height: number): number {
  return Math.max(2_000_000, Math.min(40_000_000, Math.round(width * height * 30 * 0.1)))
}

export function installEngine(): void {
  let recorder: MediaRecorder | null = null
  let streams: MediaStream[] = []
  let queue: Promise<void> = Promise.resolve()
  let webcam: MediaRecorder | null = null
  let webcamQueue: Promise<void> = Promise.resolve()
  let meter: LevelMeter | null = null
  let levelTimer: ReturnType<typeof setInterval> | null = null

  const cleanup = () => {
    if (levelTimer) clearInterval(levelTimer)
    levelTimer = null
    meter?.close()
    meter = null
    for (const s of streams) for (const t of s.getTracks()) t.stop()
    streams = []
    recorder = null
    webcam = null
  }

  /** Stops the webcam recorder; resolves once its last chunk is queued. */
  const stopWebcam = (): Promise<void> =>
    new Promise((resolve) => {
      if (!webcam || webcam.state === 'inactive') return resolve()
      webcam.addEventListener('stop', () => resolve(), { once: true })
      webcam.stop()
    })

  window.api.engine.onStart(async (cmd) => {
    try {
      const screenStream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: { ideal: cmd.frameRate, max: cmd.frameRate } },
        audio: false
      })
      streams.push(screenStream)
      const videoTrack = screenStream.getVideoTracks()[0]
      const tracks: MediaStreamTrack[] = [videoTrack]

      let hasAudio = false
      let micFallback = false
      if (cmd.audio) {
        try {
          const mic = await openMic(cmd.micDevice)
          streams.push(mic.stream)
          tracks.push(...mic.stream.getAudioTracks())
          hasAudio = true
          micFallback = mic.fallback
          // Measured on the recorded track itself: a microphone denied silently shows as a flat bar
          meter = levelMeter(mic.stream)
        } catch (e) {
          console.warn('microphone unavailable, recording without audio', e)
        }
      }

      if (cmd.webcam) {
        try {
          const camera = await openCamera(cmd.webcamDevice)
          streams.push(camera)
          const cam = new MediaRecorder(camera, { mimeType: pickMimeType(WEBCAM_MIME_CANDIDATES) || undefined, videoBitsPerSecond: WEBCAM_BITRATE })
          cam.ondataavailable = (e) => {
            if (e.data.size === 0) return
            webcamQueue = webcamQueue.then(async () => window.api.engine.webcamChunk(await e.data.arrayBuffer()))
          }
          // The two recorders start a few ms apart: the main process lines them up from these times
          cam.onstart = () => window.api.engine.webcamStarted(Date.now())
          // A webcam lost midway leaves the screen recording alone: the video gets what was recorded
          cam.onerror = (e) => console.error('webcam recorder error', e)
          webcam = cam
        } catch (e) {
          console.warn('webcam unavailable, recording without it', e)
        }
      }

      const { width = 0, height = 0 } = videoTrack.getSettings()
      const mimeType = pickMimeType(MIME_CANDIDATES)
      const rec = new MediaRecorder(new MediaStream(tracks), {
        mimeType: mimeType || undefined,
        videoBitsPerSecond: bitrateFor(width, height),
        audioBitsPerSecond: 128_000
      })
      recorder = rec

      rec.ondataavailable = (e) => {
        if (e.data.size === 0) return
        // Keep chunk order deterministic even though arrayBuffer() is async.
        queue = queue.then(async () => window.api.engine.chunk(await e.data.arrayBuffer()))
      }
      rec.onstart = () => {
        window.api.engine.started({ t0: Date.now(), width, height, mimeType: rec.mimeType || mimeType, hasAudio, micFallback, hasWebcam: !!webcam })
        // setInterval, not requestAnimationFrame: this window is hidden while recording
        if (meter) levelTimer = setInterval(() => meter && window.api.engine.level(meter.read()), LEVEL_INTERVAL)
      }
      rec.onerror = (e) => {
        cleanup()
        window.api.engine.error(t('err.recorder', { error: (e as unknown as { error?: Error }).error?.message ?? 'unknown' }))
      }
      rec.onstop = () => {
        void stopWebcam()
          .then(() => {
            const flushed = Promise.all([queue, webcamQueue])
            cleanup()
            return flushed
          })
          .then(() => window.api.engine.stopped())
      }
      // The OS can end the capture (e.g. permission revoked): treat it as a stop.
      videoTrack.onended = () => {
        if (rec.state !== 'inactive') rec.stop()
      }
      rec.start(1000)
      webcam?.start(1000)
    } catch (e) {
      cleanup()
      const err = e as Error
      const hint = /permission|denied|NotAllowed/i.test(err.name + err.message) ? ' ' + t('err.capturePermissionHint') : ''
      window.api.engine.error(t('err.captureFailed', { error: err.message }) + hint)
    }
  })

  window.api.engine.onStop(() => {
    if (recorder && recorder.state !== 'inactive') recorder.stop()
    else {
      cleanup()
      window.api.engine.stopped()
    }
  })
}
