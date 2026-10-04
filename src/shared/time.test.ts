import { describe, expect, it } from 'vitest'
import { formatTime, parseTime } from './time'

describe('parseTime', () => {
  it('reads back what formatTime writes', () => {
    for (const ms of [0, 1234, 65_000, 599_999, 3_661_500]) expect(parseTime(formatTime(ms))).toBe(ms)
  })

  it('takes the shorter forms people type', () => {
    expect(parseTime('65.25')).toBe(65_250)
    expect(parseTime('1:05')).toBe(65_000)
    expect(parseTime(' 0:02,5 ')).toBe(2500)
    expect(parseTime('12.')).toBe(12_000)
  })

  it('refuses what is not a time', () => {
    for (const text of ['', 'abc', '1:75', '1:60:00', '-3', '1:2:3:4', '1.2.3']) expect(parseTime(text)).toBeNull()
  })
})
