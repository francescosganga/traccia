// Short pauses and isolated clicks must not end a take or count as speech.
const SILENCE_MS = 1400
const EMPTY_MS = 8000
const MIN_SPEECH_MS = 240

/** Local energy endpoint detection; it never sends microphone samples elsewhere. */
export class SilenceDetector {
  private started: number
  private previous: number
  private speechMs = 0
  private heardSpeech = false
  private lastSound: number
  private noise = 0.002

  constructor(now: number) { this.started = this.previous = this.lastSound = now }

  update(rms: number, now: number): 'continue' | 'silence' | 'empty' {
    const elapsed = Math.min(160, Math.max(0, now - this.previous))
    this.previous = now
    const threshold = Math.max(0.008, this.noise * 3)
    if (rms >= threshold) {
      this.speechMs += elapsed
      if (this.speechMs >= MIN_SPEECH_MS) this.heardSpeech = true
      this.lastSound = now
    } else {
      this.speechMs = 0
      if (rms < threshold / 2) this.noise = this.noise * 0.98 + rms * 0.02
      // A quieter word ending still delays the endpoint after speech has begun.
      if (this.heardSpeech && rms >= threshold / 2) this.lastSound = now
    }
    if (this.heardSpeech && now - this.lastSound >= SILENCE_MS) return 'silence'
    if (!this.heardSpeech && now - this.started >= EMPTY_MS) return 'empty'
    return 'continue'
  }
}
