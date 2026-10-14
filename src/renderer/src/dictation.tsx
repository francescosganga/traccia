import { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { setLanguage, t } from '../../shared/i18n'
import { dictationActive, DICTATION_MAX_TEXT, type DictationState } from '../../shared/dictation'
import { installDictationEngine } from './dictation-engine'
import { Icon } from './components/Icon'

let reportLevel: (level: number) => void = () => {}
installDictationEngine((level) => reportLevel(level))

function Dictation() {
  const [state, setState] = useState<DictationState | null>(null)
  const [text, setText] = useState('')
  const [level, setLevel] = useState(0)
  const [expanded, setExpanded] = useState(false)
  const [error, setError] = useState('')
  const [, renderLanguage] = useState('')
  const action = (name: string, value?: string) => {
    setError('')
    void window.api.dictation.action(name, value).catch((error) => {
      console.error('dictation action failed', error)
      setError(t('dictation.captureFailed'))
    })
  }
  useEffect(() => {
    reportLevel = setLevel
    const updateLanguage = (s: { uiLanguage: 'it' | 'en' }) => {
      setLanguage(s.uiLanguage)
      renderLanguage(s.uiLanguage)
      document.title = t('dictation.title')
      document.documentElement.lang = s.uiLanguage
    }
    void window.api.settings.get().then(updateLanguage)
    void window.api.dictation.state().then(setState)
    const off = window.api.dictation.onState(setState)
    const offSettings = window.api.settings.onChange(updateLanguage)
    return () => { off(); offSettings(); reportLevel = () => {} }
  }, [])
  useEffect(() => { if (state) setText(state.text) }, [state?.text])
  useEffect(() => { if (state?.phase === 'preparing') setExpanded(false) }, [state?.phase])
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && state?.phase !== 'inserting') {
        event.preventDefault()
        action(state && dictationActive(state.phase) ? 'cancel' : 'close')
      }
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [state?.phase])
  if (!state) return null
  const active = dictationActive(state.phase)
  const compact = active || state.phase === 'done'
  const listening = state.phase === 'listening'
  const busy = ['preparing', 'stopping', 'transcribing', 'inserting'].includes(state.phase)
  const settings = () => void window.api.dictation.settings()
  const edit = () => { setExpanded(true); action('expand') }
  return (
    <main className={`dictation-overlay ${compact ? '' : 'has-recovery'}`}>
      {!compact && <section className="dictation-recovery" aria-label={t('dictation.title')}>
        <div className="dictation-recovery-heading">
          <strong>{t(text ? 'dictation.saved' : state.retry ? 'dictation.error' : 'dictation.title')}</strong>
          <button className="dictation-icon" title={t('dictation.settings')} aria-label={t('dictation.settings')} onClick={settings}><Icon name="settings" /></button>
        </div>
        <p role="status">{error || state.message || t('dictation.autoHint')}</p>
        {expanded && <textarea aria-label={t('dictation.preview')} value={text} maxLength={DICTATION_MAX_TEXT}
          onChange={(event) => { setText(event.target.value); action('text', event.target.value) }} />}
        <div className="dictation-recovery-actions">
          {text && <>
            <button onClick={() => action('copy', text)}><Icon name="copy" />{t('dictation.copy')}</button>
            {!expanded && <button onClick={edit}>{t('dictation.edit')}</button>}
          </>}
          {state.retry && <button onClick={() => action('retry')}>{t('dictation.retry')}</button>}
          {!text && !state.retry && <button onClick={settings}>{t('dictation.settings')}</button>}
        </div>
      </section>}
      <div className="dictation-pill" title={state.warning || t('dictation.autoHint')}>
        <span className={`dictation-mark ${busy ? 'is-busy' : ''}`} aria-hidden="true">
          <Icon name={state.phase === 'done' ? 'check' : busy ? 'sparkles' : text ? 'file' : 'mic'} />
        </span>
        <span className="dictation-pill-label" role="status" aria-live="polite">{t(`dictation.badge.${state.phase === 'result' && !text ? 'ready' : state.phase}`)}</span>
        {listening && <div className="dictation-wave" aria-label={t('mic.level')}>
          {[0.4, 0.7, 1, 0.6, 0.9, 0.5, 0.8].map((weight, i) => <i key={i} style={{ height: `${4 + level * weight * 20}px` }} />)}
        </div>}
        {listening && <button className="dictation-icon dictation-finish" title={t('dictation.stop')} aria-label={t('dictation.stop')} onClick={() => action('stop')}><span /></button>}
        {!compact && <button className="dictation-icon" title={t('dictation.start')} aria-label={t('dictation.start')} onClick={() => action('start')}><Icon name="mic" /></button>}
        {state.phase !== 'done' && <button className="dictation-icon" disabled={state.phase === 'inserting'} title={t(active ? 'dictation.cancel' : 'dictation.close')} aria-label={t(active ? 'dictation.cancel' : 'dictation.close')} onClick={() => action(active ? 'cancel' : 'close')}><Icon name="x" /></button>}
      </div>
    </main>
  )
}

createRoot(document.getElementById('root')!).render(<Dictation />)
