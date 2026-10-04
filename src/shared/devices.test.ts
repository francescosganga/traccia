import { describe, expect, it } from 'vitest'
import { setLanguage } from './i18n'
import { findDevice, systemDefaultLabel } from './devices'

const devices = [
  { id: 'a1', label: 'MacBook Pro Microphone' },
  { id: 'b2', label: 'USB Microphone' }
]

describe('findDevice', () => {
  it('finds the device by id', () => {
    expect(findDevice({ id: 'b2', label: 'renamed' }, devices)).toEqual(devices[1])
  })

  it('falls back to the label when the id changed (another origin, a reinstall)', () => {
    expect(findDevice({ id: 'stale', label: 'USB Microphone' }, devices)).toEqual(devices[1])
  })

  it('returns undefined when the device is not connected', () => {
    expect(findDevice({ id: 'c3', label: 'AirPods' }, devices)).toBeUndefined()
  })
})

describe('systemDefaultLabel', () => {
  it('names the device the system uses, when known', () => {
    setLanguage('en')
    expect(systemDefaultLabel({ devices, defaultLabel: 'USB Microphone' })).toBe('System default — USB Microphone')
    expect(systemDefaultLabel({ devices, defaultLabel: null })).toBe('System default')
  })
})
