import { levelMeter, openMic, type LevelMeter } from './media'
import { SilenceDetector } from './silence-detector'

/** A separate recorder avoids changing the recording engine's screen/conversation contract. */
export function installDictationEngine(onLevel: (level: number) => void): void {
  let generation = 0
  let recorder: MediaRecorder | null = null
  let stream: MediaStream | null = null
  let meter: LevelMeter | null = null
  let timer: ReturnType<typeof setInterval> | null = null
  let activeId = 0

  const cleanup = () => {
    if (timer) clearInterval(timer)
    timer = null
    meter?.close()
    meter = null
    stream?.getTracks().forEach((track) => track.stop())
    stream = null
    recorder = null
    onLevel(0)
  }

  window.api.dictation.onCapture(async (command) => {
    const run = ++generation
    activeId = command.id
    cleanup()
    try {
      const mic = await openMic(command.mic)
      if (run !== generation) { mic.stream.getTracks().forEach((track) => track.stop()); return }
      stream = mic.stream
      meter = levelMeter(stream)
      const mimeType = ['audio/webm;codecs=opus', 'audio/webm'].find((type) => MediaRecorder.isTypeSupported(type))
      const rec = new MediaRecorder(stream, { mimeType, audioBitsPerSecond: 128_000 })
      recorder = rec
      let queue = Promise.resolve()
      let failed = false
      let interrupted = false
      rec.ondataavailable = (event) => {
        if (!event.data.size || run !== generation) return
        queue = queue.then(async () => {
          if (run === generation) await window.api.dictation.chunk(command.id, await event.data.arrayBuffer())
        }).catch((error) => {
          failed = true
          console.error('dictation audio write failed', error)
          window.api.dictation.error(command.id)
        })
      }
      rec.onstart = () => {
        if (run !== generation) return
        window.api.dictation.started(command.id, { fallback: mic.fallback, callQuality: mic.callQuality, micName: stream?.getAudioTracks()[0]?.label ?? '' })
        const detector = new SilenceDetector(performance.now())
        timer = setInterval(() => {
          onLevel(meter?.read() ?? 0)
          const endpoint = detector.update(meter?.readRms() ?? 0, performance.now())
          if (endpoint === 'empty') {
            ++generation
            if (rec.state !== 'inactive') rec.stop()
            cleanup()
            window.api.dictation.empty(command.id)
          } else if (endpoint === 'silence' && rec.state !== 'inactive') rec.stop()
        }, 80)
      }
      rec.onstop = () => {
        if (run === generation) cleanup()
        void queue.then(() => {
          if (run === generation && !failed) return window.api.dictation.stopped(command.id, interrupted)
        }).catch((error) => { console.error('dictation stop failed', error); window.api.dictation.error(command.id) })
      }
      rec.onerror = (error) => {
        console.error('dictation recorder failed', error)
        if (run === generation) { ++generation; cleanup(); window.api.dictation.error(command.id) }
      }
      stream.getAudioTracks()[0].onended = () => {
        interrupted = true
        if (rec.state !== 'inactive') rec.stop()
      }
      rec.start(500)
    } catch (error) {
      console.error('cannot open dictation microphone', error)
      if (run === generation) { cleanup(); window.api.dictation.error(command.id) }
    }
  })
  window.api.dictation.onStop((id) => {
    if (id === activeId && recorder?.state !== 'inactive') recorder?.stop()
  })
  window.api.dictation.onCancel(() => {
    ++generation
    if (recorder?.state !== 'inactive') recorder?.stop()
    cleanup()
  })
}
