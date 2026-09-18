import { app } from 'electron'
import type { AppState, RecordingRequest } from '../shared/types'

/**
 * Development helper: TRACCIA_AUTOTEST=<seconds> records the primary screen for that
 * long right after startup, then quits once processing finished. Useful to exercise
 * the whole pipeline without clicking through the UI.
 */
export function setupAutotest(start: (req: RecordingRequest) => Promise<void>, stop: () => void): (state: AppState) => void {
  const seconds = Number(process.env.TRACCIA_AUTOTEST)
  if (!seconds) return () => {}
  const mode = (process.env.TRACCIA_AUTOTEST_MODE as RecordingRequest['mode']) || 'screen'
  const region = process.env.TRACCIA_AUTOTEST_REGION?.split(',').map(Number)
  let stopping = false
  setTimeout(() => {
    console.log(`[autotest] starting ${mode} recording for ${seconds}s`)
    void start({ mode, region: region && region.length === 4 ? { x: region[0], y: region[1], width: region[2], height: region[3] } : undefined })
  }, 3000)
  return (state) => {
    console.log('[autotest] state:', JSON.stringify(state))
    if (state.status === 'recording' && !stopping) {
      stopping = true
      setTimeout(stop, seconds * 1000)
    }
    if (state.status === 'done' || state.status === 'error') setTimeout(() => app.quit(), 500)
  }
}
