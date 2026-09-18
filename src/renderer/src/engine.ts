/**
 * Capture engine: lives in the (hidden) main window and does the actual recording
 * with getDisplayMedia + getUserMedia + MediaRecorder. Chunks are streamed to the
 * main process, which writes them to disk.
 */

import { t } from '../../shared/i18n'

const MIME_CANDIDATES = [
  'video/webm;codecs=h264,opus',
  'video/webm;codecs=avc1,opus',
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp8,opus',
  'video/webm'
]

function pickMimeType(): string {
  for (const m of MIME_CANDIDATES) if (MediaRecorder.isTypeSupported(m)) return m
  return ''
}

function bitrateFor(width: number, height: number): number {
  return Math.max(2_000_000, Math.min(40_000_000, Math.round(width * height * 30 * 0.1)))
}

export function installEngine(): void {
  let recorder: MediaRecorder | null = null
  let streams: MediaStream[] = []
  let queue: Promise<void> = Promise.resolve()

  const cleanup = () => {
    for (const s of streams) for (const t of s.getTracks()) t.stop()
    streams = []
    recorder = null
  }

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
      if (cmd.audio) {
        try {
          const mic = await navigator.mediaDevices.getUserMedia({
            audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
            video: false
          })
          streams.push(mic)
          tracks.push(...mic.getAudioTracks())
          hasAudio = true
        } catch (e) {
          console.warn('microphone unavailable, recording without audio', e)
        }
      }

      const { width = 0, height = 0 } = videoTrack.getSettings()
      const mimeType = pickMimeType()
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
      rec.onstart = () => window.api.engine.started({ t0: Date.now(), width, height, mimeType: rec.mimeType || mimeType, hasAudio })
      rec.onerror = (e) => {
        cleanup()
        window.api.engine.error(t('err.recorder', { error: (e as unknown as { error?: Error }).error?.message ?? 'unknown' }))
      }
      rec.onstop = () => {
        cleanup()
        void queue.then(() => window.api.engine.stopped())
      }
      // The OS can end the capture (e.g. permission revoked): treat it as a stop.
      videoTrack.onended = () => {
        if (rec.state !== 'inactive') rec.stop()
      }
      rec.start(1000)
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
