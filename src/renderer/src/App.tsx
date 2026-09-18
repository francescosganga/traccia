import { useCallback, useEffect, useState } from 'react'
import { setLanguage, t } from '../../shared/i18n'
import type { AppState, Settings } from '../../shared/types'
import { Icon, Logo } from './components/Icon'
import { installEngine } from './engine'
import { Home } from './pages/Home'
import { SettingsPage } from './pages/Settings'
import { Wizard } from './pages/Wizard'

type Page = 'home' | 'settings'

installEngine()

export function App() {
  const [settings, setSettingsState] = useState<Settings | null>(null)
  const [state, setState] = useState<AppState>({ status: 'idle' })
  const [page, setPage] = useState<Page>('home')
  const [modelInstalled, setModelInstalled] = useState(false)
  const [version, setVersion] = useState('')
  const [platform, setPlatform] = useState('darwin')

  // Language must be applied before the tree re-renders with the new settings.
  const setSettings = useCallback((s: Settings) => {
    setLanguage(s.uiLanguage)
    setSettingsState(s)
  }, [])

  const update = useCallback(async (patch: Partial<Settings>) => setSettings(await window.api.settings.update(patch)), [setSettings])

  useEffect(() => {
    void window.api.settings.get().then(setSettings)
    void window.api.recording.state().then(setState)
    void window.api.system.version().then(setVersion)
    void window.api.system.platform().then(setPlatform)
    const offState = window.api.recording.onState(setState)
    const offSettings = window.api.settings.onChange(setSettings)
    const offNav = window.api.recording.onNavigate((p) => setPage(p as Page))
    return () => {
      offState()
      offSettings()
      offNav()
    }
  }, [setSettings])

  useEffect(() => {
    if (!settings) return
    void window.api.whisper.models().then((m) => setModelInstalled(m.some((x) => x.id === settings.whisperModel && x.installed)))
  }, [settings?.whisperModel, page, state.status])

  if (!settings) return null
  if (!settings.onboardingDone) return <Wizard settings={settings} update={update} platform={platform} onDone={() => setPage('home')} />

  return (
    <div className="app">
      <nav className="sidebar">
        <div className="brand">
          <Logo />
          <span>Traccia</span>
        </div>
        <button className={`nav ${page === 'home' ? 'active' : ''}`} onClick={() => setPage('home')}>
          <Icon name="record" />
          {t('nav.record')}
        </button>
        <button className={`nav ${page === 'settings' ? 'active' : ''}`} onClick={() => setPage('settings')}>
          <Icon name="settings" />
          {t('nav.settings')}
        </button>
        <div className="spacer" />
        <div className="version">v{version}</div>
      </nav>
      {page === 'home' ? (
        <Home settings={settings} update={update} state={state} modelInstalled={modelInstalled} platform={platform} goSettings={() => setPage('settings')} />
      ) : (
        <SettingsPage settings={settings} update={update} />
      )}
    </div>
  )
}
