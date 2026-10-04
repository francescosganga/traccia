import { StrictMode, useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { setLanguage, t } from '../../shared/i18n'
import type { AppState, RecordingInfo } from '../../shared/types'
import type { WebcamLayout } from '../../shared/webcam'
import { Icon } from './components/Icon'
import { Segmented } from './components/Segmented'
import { CornerPicker, shapeOptions } from './components/WebcamPicker'
import { formatDuration } from './format'

// Height of the bar, and the space between it and the webcam menu above
const BAR = 60
const GAP = 8

/** The two choices most often regretted after a long recording: the format and whether the voice is in, with its level. */
function Meta({ info }: { info: RecordingInfo }) {
  const bar = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    if (!info.audio) return
    return window.api.recording.onLevel((level) => {
      if (bar.current) bar.current.style.transform = `scaleX(${level})`
    })
  }, [info.audio])
  const format = info.format === 'jpg' ? `JPG ${info.jpgFps} fps` : info.format.toUpperCase()
  return (
    <div className="meta">
      {format} · {info.audio ? t('controls.mic') : t('controls.noMic')}
      {info.audio && (
        <span className="meter" title={t('mic.level')} aria-hidden="true">
          <span ref={bar} />
        </span>
      )}
    </div>
  )
}

function Controls() {
  const [state, setState] = useState<AppState>({ status: 'idle' })
  const [now, setNow] = useState(Date.now())
  const [ready, setReady] = useState(false)
  const [menu, setMenu] = useState(false)
  const panel = useRef<HTMLDivElement>(null)
  const info = state.status === 'recording' || state.status === 'countdown' ? state.info : null
  const webcam = info?.webcam ?? null

  // The window grows upwards while the menu is open; it closes on Escape or a click elsewhere
  useEffect(() => {
    if (!menu || !panel.current) {
      window.api.controls.resize(BAR)
      return
    }
    const el = panel.current
    const fit = () => window.api.controls.resize(BAR + GAP + el.offsetHeight)
    fit()
    const observer = new ResizeObserver(fit)
    observer.observe(el)
    const close = () => setMenu(false)
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close()
    window.addEventListener('blur', close)
    window.addEventListener('keydown', onKey)
    return () => {
      observer.disconnect()
      window.removeEventListener('blur', close)
      window.removeEventListener('keydown', onKey)
    }
  }, [menu])
  useEffect(() => {
    if (!webcam) setMenu(false)
  }, [!webcam])

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
  const change = (patch: Partial<WebcamLayout>) => window.api.recording.setWebcamLayout(patch)

  return (
    <div className="controls-root">
      {menu && webcam && (
        <div className="controls-menu" ref={panel}>
          <Segmented options={shapeOptions()} value={webcam.shape} onChange={(shape) => change({ shape })} />
          <div className="row">
            <CornerPicker shape={webcam.shape} corner={webcam.corner} onChange={(corner) => change({ corner })} />
            <button className="btn sm" onClick={() => change({ visible: !webcam.visible })}>
              <Icon name={webcam.visible ? 'webcam-off' : 'webcam'} />
              {webcam.visible ? t('controls.hideWebcam') : t('controls.showWebcam')}
            </button>
          </div>
        </div>
      )}
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
          {info && <Meta info={info} />}
        </div>
        {webcam && (
          <button
            className={`btn ghost icon-btn webcam-btn ${menu ? 'active' : ''}`}
            aria-label={t('controls.webcam')}
            aria-expanded={menu}
            title={t('controls.webcam')}
            onClick={() => setMenu((open) => !open)}
          >
            <Icon name={webcam.visible ? 'webcam' : 'webcam-off'} />
          </button>
        )}
        <button className="btn primary stop" onClick={() => window.api.recording.stop()}>
          {t('common.stop')}
        </button>
      </div>
    </div>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Controls />
  </StrictMode>
)
