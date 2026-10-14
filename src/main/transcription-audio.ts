/** Exclude leading silence from inference without changing the recording's clock or audio files. */
export function transcriptionStart(audio: Float32Array, sampleRate: number): number | null {
  const frame = Math.max(1, Math.round(sampleRate * 0.02))
  const padding = Math.round(sampleRate * 0.3)
  for (let from = 0; from < audio.length; from += frame) {
    const to = Math.min(audio.length, from + frame)
    let energy = 0
    for (let i = from; i < to; i++) energy += audio[i] * audio[i]
    // A conservative -60 dB floor preserves quiet speech; padding protects its onset.
    if (Math.sqrt(energy / (to - from)) > 0.001) return Math.max(0, from - padding)
  }
  return null
}
