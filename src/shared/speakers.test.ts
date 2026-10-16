import { describe, expect, it } from 'vitest'
import { labelSpeakers, renameSpeakers, speechText } from './speakers'
import type { TranscriptResult } from './types'

const transcript: TranscriptResult = {
  segments: [{ start: 0, end: 3, text: 'hello yes silence' }],
  words: [{ start: 0, end: 1, text: ' hello' }, { start: 1, end: 2, text: ' yes' }, { start: 2, end: 3, text: ' silence' }]
}

describe('speaker alignment', () => {
  it('renames phrases and words without merging IDs, and supports resetting a name', () => {
    const labeled = labelSpeakers(transcript, 'system', [{ start: 0, end: 3, speaker: '1' }])
    const named = renameSpeakers(labeled, { system_1: '  Anna Rossi  ' })
    expect(named.words.every((w) => w.speaker === 'system_1' && w.speakerName === 'Anna Rossi')).toBe(true)
    expect(speechText(named.segments[0])).toContain('[Anna Rossi]')
    expect(labeled.segments[0].speakerName).toBeUndefined()
    expect(speechText(renameSpeakers(named, { system_1: '' }).segments[0])).toContain('[system_1]')
    expect(renameSpeakers(named, {}).segments[0].speakerName).toBe('Anna Rossi')
  })

  it('rejects unknown speakers and names that would break exported timeline lines', () => {
    const labeled = labelSpeakers(transcript, 'microphone', [{ start: 0, end: 3, speaker: '1' }])
    for (const names of [null, [], { system_1: 'Name' }, { microphone_1: 4 }, { microphone_1: 'a\nb' }, { microphone_1: 'x'.repeat(81) }]) {
      expect(() => renameSpeakers(labeled, names)).toThrow()
    }
  })

  it('splits a Whisper phrase at speaker changes and leaves uncovered speech unassigned', () => {
    const result = labelSpeakers(transcript, 'microphone', [{ start: 0, end: 1, speaker: '1' }, { start: 1, end: 2, speaker: '2' }])
    expect(result.segments.map((s) => [s.text, s.speaker])).toEqual([['hello', 'microphone_1'], ['yes', 'microphone_2'], ['silence', undefined]])
    expect(result.words.map((w) => w.source)).toEqual(['microphone', 'microphone', 'microphone'])
  })

  it('does not identify a single microphone voice as the user or merge identities across sources', () => {
    const turns = [{ start: 0, end: 3, speaker: '1' }]
    expect(labelSpeakers(transcript, 'microphone', turns).segments[0].speaker).toBe('microphone_1')
    expect(labelSpeakers(transcript, 'system', turns).segments[0].speaker).toBe('system_1')
    expect(labelSpeakers(transcript, 'microphone').segments[0].speaker).toBeUndefined()
  })

  it('handles chunk timestamps and zero-duration words without losing the text', () => {
    const result = labelSpeakers({ segments: [{ start: 1, end: 3, text: 'chunk' }], words: [] }, 'system', [{ start: 0, end: 4, speaker: '2' }])
    expect(speechText(result.segments[0])).toBe('[system_2] chunk')
    const word = { start: 1, end: 1, text: 'yes' }
    expect(labelSpeakers({ segments: [word], words: [word] }, 'microphone', [{ start: 0, end: 2, speaker: '1' }]).words[0].speaker).toBe('microphone_1')
  })

  it('retains legacy text and source-only fallback labels', () => {
    expect(speechText({ start: 0, end: 1, text: 'old' })).toBe('old')
    expect(speechText({ start: 0, end: 1, text: 'new', source: 'system' })).toBe('[system] new')
  })

  it('retains uncertain speech without displaying or exporting an invented identity', () => {
    const result = labelSpeakers(transcript, 'microphone', [{ start: 0, end: 3 }])
    expect(result.words.every((w) => w.source === 'microphone' && w.speaker === undefined)).toBe(true)
    expect(speechText(result.segments[0])).toBe('[microphone] hello yes silence')
  })
})
