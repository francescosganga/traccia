import { StrictMode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { setLanguage, t } from '../../shared/i18n'
import type { AppState, RecordingInfo } from '../../shared/types'
import { formatDuration } from './format'

/** The two choices most often regretted after a long recording: the format and whether the voice is in. */
function describe(info: RecordingInfo): string {
  const format = info.format === 'jpg' ? `JPG ${info.jpgFps} fps` : info.format.toUpperCase()
  return `${format} · ${info.audio ? t('controls.mic') : t('controls.noMic')}`
}

function Controls() {
  const [state, setState] = useState<AppState>({ status: 'idle' })
  const [now, setNow] = useState(Date.now())
  const [ready, setReady] = useState(false)

  useEffect(() => {
    void window.api.settings.get().then((s) => {
      setLanguage(s.uiLanguage)
      setReady(true)
    })
    void window.api.recording.state().then(setState)
    const off = window.api.recording.onState(setState)
    const timer = setInterval(() => setNow(Date.now()), 250)
    return () => {
      off()
      clearInterval(timer)
    }
  }, [])

  if (!ready) return null
  const info = state.status === 'recording' || state.status === 'countdown' ? state.info : null

  return (
    <div className="controls">
      <div className="time">
        <div className="main">
          {state.status === 'recording' && (
            <>
              <span className="rec-dot" /> {formatDuration(now - state.startedAt)}
            </>
          )}
          {state.status === 'countdown' && (
            <span className="countdown">{state.seconds > 0 ? t('controls.startingIn', { n: state.seconds }) : t('controls.starting')}</span>
          )}
          {state.status !== 'recording' && state.status !== 'countdown' && <span className="dim">—</span>}
        </div>
        {info && <div className="meta">{describe(info)}</div>}
      </div>
      <button className="btn primary stop" onClick={() => window.api.recording.stop()}>
        {t('common.stop')}
      </button>
    </div>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Controls />
  </StrictMode>
)
