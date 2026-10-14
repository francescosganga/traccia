import { describe, expect, it } from 'vitest'
import { ActivityGate } from './activity'

describe('activity ownership', () => {
  it('excludes every competing operation until its owner releases', () => {
    const gate = new ActivityGate()
    const release = gate.acquire('dictation')!
    for (const kind of ['recording', 'dictation', 'models', 'editing'] as const) expect(gate.acquire(kind)).toBeNull()
    release()
    expect(gate.acquire('recording')).not.toBeNull()
  })

  it('an old completion cannot release a newer activity', () => {
    const gate = new ActivityGate()
    const old = gate.acquire('dictation')!
    old()
    gate.acquire('recording')
    old()
    expect(gate.current).toBe('recording')
  })
})
