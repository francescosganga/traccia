import { describe, expect, it } from 'vitest'
import { transcriptionStart, transcriptionWindows, transcriptionPieces, restoreSpeechTime } from './transcription-audio'

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

  it('excludes internal silence while preserving the original offsets and short answers', () => {
    expect(transcriptionWindows(100, [{ start: 2, end: 10 }, { start: 80, end: 80.5 }])).toEqual([
      { start: 1.6, end: 10.4 }, { start: 79.6, end: 80.9 }
    ])
  })

  it('merges overlaps and nearby speech so no audio is transcribed twice', () => {
    expect(transcriptionWindows(10, [{ start: 3, end: 6 }, { start: 0, end: 4 }, { start: 7, end: 12 }])).toEqual([
      { start: 0, end: 10 }
    ])
  })

  it('distinguishes detected silence from unavailable speech detection', () => {
    expect(transcriptionWindows(900, [])).toEqual([])
    expect(transcriptionWindows(900)).toEqual([{ start: 0, end: 600 }, { start: 600, end: 900 }])
    expect(transcriptionWindows(0)).toEqual([])
    expect(transcriptionWindows(10, [{ start: NaN, end: 5 }, { start: 8, end: 7 }, { start: 11, end: 13 }])).toEqual([])
  })

  it('gives short answers shared audio context and restores timestamps across removed silences', () => {
    const audio = new Float32Array(rate * 100)
    audio.fill(0.1, rate * 2, rate * 3)
    audio.fill(0.2, rate * 80, rate * 81)
    const pieces = [...transcriptionPieces(audio, rate, [{ start: 2, end: 3 }, { start: 80, end: 81 }])]
    expect(pieces).toHaveLength(1)
    const piece = pieces[0]
    expect(piece.audio.length).toBe(rate * 2)
    expect(piece.audio[rate]).toBeCloseTo(0.2)
    expect(restoreSpeechTime({ start: 1.2, end: 1.5 }, piece.spans, 0)).toEqual({ start: 80.2, end: 80.5 })
    expect(restoreSpeechTime({ start: 0.8, end: 1.2 }, piece.spans, 0)).toEqual({ start: 2.8, end: 3 })
    expect(restoreSpeechTime({ start: 1, end: 1.1 }, piece.spans, 0)).toEqual({ start: 80, end: 80.1 })
    expect(restoreSpeechTime({ start: 0, end: 0.2 }, piece.spans, 1.2)).toEqual({ start: 80.2, end: 80.4 })
    expect(restoreSpeechTime({ start: 2, end: 5 }, piece.spans, 0)).toBeUndefined()
  })

  it('bounds compacted pieces and preserves the clock for chunk-only fallback and unfiltered audio', () => {
    const audio = new Float32Array(1300)
    const pieces = [...transcriptionPieces(audio, 1, [{ start: 0, end: 650 }, { start: 1000, end: 1300 }])]
    expect(pieces.map((p) => p.audio.length)).toEqual([600, 350])
    expect(restoreSpeechTime({ start: 45, end: 60 }, pieces[1].spans, 0, false)).toEqual({ start: 645, end: 1010 })
    expect(restoreSpeechTime({ start: 10, end: 800 }, pieces[1].spans, 0, false)).toEqual({ start: 610, end: 1300 })
    expect([...transcriptionPieces(audio, 1, [])]).toEqual([])
  })
})
