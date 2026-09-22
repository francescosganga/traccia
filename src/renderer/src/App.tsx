import { useCallback, useEffect, useRef, useState } from 'react'
import { setLanguage, t } from '../../shared/i18n'
import type { AppState, Settings } from '../../shared/types'
import { Icon, Logo } from './components/Icon'
import { installEngine } from './engine'
import { Home } from './pages/Home'
import { SETTINGS_SECTIONS, SettingsPage, type SectionJump, type SettingsSection } from './pages/Settings'
import { Wizard } from './pages/Wizard'

type Page = 'home' | 'settings'

installEngine()

export function App() {
  const [settings, setSettingsState] = useState<Settings | null>(null)
  const [state, setState] = useState<AppState>({ status: 'idle' })
  const [page, setPage] = useState<Page>('home')
  const [section, setSection] = useState<SettingsSection>('general')
  const [jump, setJump] = useState<SectionJump | null>(null)
  const jumps = useRef(0)
  const [modelInstalled, setModelInstalled] = useState(false)
  const [version, setVersion] = useState('')
  const [platform, setPlatform] = useState('darwin')

  // Language must be applied before the tree re-renders with the new settings.
  const setSettings = useCallback((s: Settings) => {
    setLanguage(s.uiLanguage)
    setSettingsState(s)
  }, [])

  const update = useCallback(async (patch: Partial<Settings>) => setSettings(await window.api.settings.update(patch)), [setSettings])

  const openSettings = useCallback((target: SettingsSection = 'general') => {
    setPage('settings')
    setSection(target)
    setJump({ section: target, seq: ++jumps.current })
  }, [])

  useEffect(() => {
    void window.api.settings.get().then(setSettings)
    void window.api.recording.state().then(setState)
    void window.api.system.version().then(setVersion)
    void window.api.system.platform().then(setPlatform)
    const offState = window.api.recording.onState(setState)
    const offSettings = window.api.settings.onChange(setSettings)
    const offNav = window.api.recording.onNavigate((p) => (p === 'settings' ? openSettings() : setPage('home')))
    return () => {
      offState()
      offSettings()
      offNav()
    }
  }, [setSettings, openSettings])

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
        {page === 'settings' ? (
          <>
            <button className="nav" onClick={() => setPage('home')}>
              <Icon name="arrow-left" />
              {t('common.back')}
            </button>
            <div className="nav-label">{t('nav.settings')}</div>
            {SETTINGS_SECTIONS.map((s) => (
              <button key={s.id} className={`nav sub ${section === s.id ? 'active' : ''}`} data-section={s.id} onClick={() => openSettings(s.id)}>
                {t(s.label)}
              </button>
            ))}
          </>
        ) : (
          <>
            <button className="nav active" onClick={() => setPage('home')}>
              <Icon name="record" />
              {t('nav.record')}
            </button>
            <button className="nav" onClick={() => openSettings()}>
              <Icon name="settings" />
              {t('nav.settings')}
            </button>
          </>
        )}
        <div className="spacer" />
        <div className="version">v{version}</div>
      </nav>
      {page === 'home' ? (
        <Home settings={settings} state={state} modelInstalled={modelInstalled} platform={platform} goSettings={openSettings} />
      ) : (
        <SettingsPage settings={settings} update={update} jump={jump} onSection={setSection} />
      )}
    </div>
  )
}
