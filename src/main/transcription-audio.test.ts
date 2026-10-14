import { describe, expect, it } from 'vitest'
import { transcriptionStart } from './transcription-audio'

describe('audio prepared for Whisper', () => {
  const rate = 16000

  it('retains the offset after a delayed system source starts playing', () => {
    const audio = new Float32Array(rate * 10)
    audio.fill(0.1, Math.round(rate * 6.7))
    const start = transcriptionStart(audio, rate)!
    expect(start / rate).toBeCloseTo(6.4)
    // Whisper timestamps are relative to this view, then shifted back for speaker alignment.
    expect(0.3 + start / rate).toBeCloseTo(6.7)
    expect(audio.subarray(start)[Math.round(rate * 0.3)]).toBeCloseTo(0.1)
  })

  it('skips silent sources, including an empty or partial frame', () => {
    expect(transcriptionStart(new Float32Array(0), rate)).toBeNull()
    expect(transcriptionStart(new Float32Array(rate * 3).fill(0.00001), rate)).toBeNull()
    expect(transcriptionStart(new Float32Array(12), rate)).toBeNull()
  })

  it('preserves quiet speech and speech already at the beginning', () => {
    expect(transcriptionStart(new Float32Array(rate).fill(0.002), rate)).toBe(0)
    expect(transcriptionStart(new Float32Array(12).fill(0.1), rate)).toBe(0)
  })
})
