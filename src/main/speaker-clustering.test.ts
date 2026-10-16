import { describe, expect, it } from 'vitest'
import { clusterVoices, type VoiceSample } from './speaker-clustering'

const voice = (start: number, duration: number, embedding: number[]): VoiceSample => ({ start, end: start + duration, embedding })

describe('automatic speaker profiles', () => {
  it('keeps one voice together across pauses and short interjections', () => {
    const turns = clusterVoices([
      voice(0, 4, [1, 0, 0]), voice(10, 4, [0.95, 0.05, 0]),
      voice(50, 0.4, [0.8, 0.2, 0]), voice(80, 4, [0.9, 0.1, 0])
    ])
    expect(turns.map((s) => s.speaker)).toEqual(['1', '1', '1', '1'])
  })

  it('discovers a new voice arriving late without a supplied speaker count', () => {
    const turns = clusterVoices([
      voice(0, 6, [1, 0]), voice(10, 6, [1, 0]),
      voice(1800, 6, [0, 1]), voice(1810, 6, [0, 1])
    ])
    expect(turns.map((s) => s.speaker)).toEqual(['1', '1', '2', '2'])
  })

  it('does not invent a new person from brief noise or force an ambiguous voice into an existing profile', () => {
    const turns = clusterVoices([
      voice(0, 6, [1, 0, 0]), voice(10, 6, [0, 1, 0]),
      voice(20, 0.5, [0, 0, 1]), voice(30, 0.5, [1, 1, 0])
    ])
    expect(turns.map((s) => s.speaker)).toEqual(['1', '2', undefined, undefined])
  })

  it('does not count overlapping detections twice as evidence for a new identity', () => {
    const samples = Array.from({ length: 20 }, (_, i) => voice(i * 7, 6, [1, 0]))
    samples.push(voice(150, 6, [0, 1]), voice(151, 5, [0, 1]))
    const turns = clusterVoices(samples)
    expect(turns.slice(-2).map((s) => s.speaker)).toEqual([undefined, undefined])
  })

  it('keeps speech without a profile when evidence is insufficient or embeddings are invalid', () => {
    const turns = clusterVoices([voice(0, 0.4, [1, 0]), voice(3, 6, []), voice(10, 6, [NaN, 0])])
    expect(turns).toHaveLength(3)
    expect(turns.every((s) => s.speaker === undefined)).toBe(true)
    expect(clusterVoices([])).toEqual([])
  })

  it('samples the end as well as the beginning of very long recordings', () => {
    const samples = Array.from({ length: 650 }, (_, i) => voice(i * 7, 6, i < 620 ? [1, 0] : [0, 1]))
    const turns = clusterVoices(samples)
    expect(turns[0].speaker).toBe('1')
    expect(turns.at(-1)?.speaker).toBe('2')
  })
})
