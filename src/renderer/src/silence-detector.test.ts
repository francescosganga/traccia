import { describe, expect, it } from 'vitest'
import { SilenceDetector } from './silence-detector'

describe('dictation endpoint', () => {
  it('waits through a short pause and restarts the silence timeout when speaking resumes', () => {
    const detector = new SilenceDetector(0)
    for (let ms = 80; ms <= 400; ms += 80) expect(detector.update(0.04, ms)).toBe('continue')
    expect(detector.update(0, 1200)).toBe('continue')
    expect(detector.update(0.04, 1280)).toBe('continue')
    expect(detector.update(0, 2600)).toBe('continue')
    expect(detector.update(0, 2680)).toBe('silence')
  })

  it('does not classify an isolated click or quiet background as speech', () => {
    const detector = new SilenceDetector(0)
    for (let ms = 80; ms < 8000; ms += 80) expect(detector.update(ms === 800 ? 0.2 : 0.002, ms)).toBe('continue')
    expect(detector.update(0.002, 8000)).toBe('empty')
  })

  it('does not stop during sustained speech', () => {
    const detector = new SilenceDetector(0)
    for (let ms = 80; ms < 20000; ms += 80) expect(detector.update(0.02, ms)).toBe('continue')
  })
})
