export type Activity = 'recording' | 'dictation' | 'models' | 'editing'

/** A lease is acquired before any await, including permission prompts and region selection. */
export class ActivityGate {
  private lease: { kind: Activity } | null = null

  get current(): Activity | null { return this.lease?.kind ?? null }

  acquire(kind: Activity): (() => void) | null {
    if (this.lease) return null
    const lease = { kind }
    this.lease = lease
    return () => { if (this.lease === lease) this.lease = null }
  }
}

export const activities = new ActivityGate()
