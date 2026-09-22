import { useEffect, useRef, useState } from 'react'
import { t, type TranslationKey } from '../../../shared/i18n'
import type { LoginItemStatus, Settings, SpeechLanguage } from '../../../shared/types'
import { AgentsPanel } from '../components/AgentsPanel'
import { LanguagePicker } from '../components/LanguagePicker'
import { ModelManager } from '../components/ModelManager'
import { NumberField } from '../components/NumberField'
import { ShortcutSettings } from '../components/ShortcutSettings'
import { PermissionsPanel } from '../components/PermissionsPanel'
import { Segmented } from '../components/Segmented'
import { Toggle } from '../components/Toggle'
import { FORMATS, RESOLUTIONS, resolutionLabel } from '../options'

export type SettingsSection = 'general' | 'output' | 'audio' | 'cursor' | 'recording' | 'shortcuts' | 'agents' | 'startup' | 'permissions'

/** The cards of the page in order; the sidebar lists them and scrolls to the one clicked. */
export const SETTINGS_SECTIONS: { id: SettingsSection; label: TranslationKey }[] = [
  { id: 'general', label: 'settings.general' },
  { id: 'output', label: 'settings.output' },
  { id: 'audio', label: 'settings.audioSection' },
  { id: 'cursor', label: 'settings.cursorSection' },
  { id: 'recording', label: 'settings.recordingSection' },
  { id: 'shortcuts', label: 'settings.shortcutsSection' },
  { id: 'agents', label: 'settings.agentsSection' },
  { id: 'startup', label: 'settings.startupSection' },
  { id: 'permissions', label: 'settings.permissions' }
]

/** A request to show a section; `seq` changes on every request so the same section can be asked for twice. */
export interface SectionJump {
  section: SettingsSection
  seq: number
}

interface Props {
  settings: Settings
  update: (patch: Partial<Settings>) => Promise<void>
  jump: SectionJump | null
  /** The section at the top of the view, reported while the user scrolls */
  onSection: (section: SettingsSection) => void
}

const SPEECH_LANGUAGES: { id: SpeechLanguage; label: string }[] = [
  { id: 'en', label: 'English' },
  { id: 'it', label: 'Italiano' },
  { id: 'es', label: 'Español' },
  { id: 'fr', label: 'Français' },
  { id: 'de', label: 'Deutsch' },
  { id: 'pt', label: 'Português' }
]

// Where a section lands when scrolled to: the same distance from the top as the first card (the content padding).
const TOP_MARGIN = 32
// A section counts as "current" once its top is within this distance from the top of the view.
const SPY_MARGIN = 64

export function SettingsPage({ settings, update, jump, onSection }: Props) {
  const [login, setLogin] = useState<LoginItemStatus | null>(null)
  const [platform, setPlatform] = useState('darwin')
  const contentRef = useRef<HTMLDivElement>(null)
  const innerRef = useRef<HTMLDivElement>(null)
  // The section asked for by the sidebar: kept aligned while async panels (models, agents) change the
  // page height, and kept highlighted, until the user scrolls by hand.
  const targetRef = useRef<SettingsSection | null>(null)
  // True while a scrollTo() we issued is in flight, so its scroll events do not move the highlight.
  const scrollingRef = useRef(false)

  useEffect(() => {
    void window.api.system.loginItem().then(setLogin)
    void window.api.system.platform().then(setPlatform)
  }, [settings.openAtLogin])

  /** Top of a card relative to the scroll container's content. */
  const cardTop = (el: HTMLElement, section: SettingsSection): number => {
    const card = el.querySelector<HTMLElement>(`#settings-${section}`)
    return card ? card.getBoundingClientRect().top - el.getBoundingClientRect().top + el.scrollTop : 0
  }

  const align = (section: SettingsSection, smooth: boolean) => {
    const el = contentRef.current
    if (!el) return
    // The first section shows the page title too, so it scrolls to the very top
    const wanted = section === SETTINGS_SECTIONS[0].id ? 0 : cardTop(el, section) - TOP_MARGIN
    const top = Math.max(0, Math.min(wanted, el.scrollHeight - el.clientHeight))
    if (Math.abs(top - el.scrollTop) < 1) return
    scrollingRef.current = true
    el.scrollTo({ top, behavior: smooth && !matchMedia('(prefers-reduced-motion: reduce)').matches ? 'smooth' : 'auto' })
  }

  const sectionAt = (el: HTMLElement): SettingsSection => {
    const last = SETTINGS_SECTIONS[SETTINGS_SECTIONS.length - 1].id
    if (el.scrollHeight > el.clientHeight && el.scrollTop + el.clientHeight >= el.scrollHeight - 2) return last
    let current = SETTINGS_SECTIONS[0].id
    for (const s of SETTINGS_SECTIONS) if (cardTop(el, s.id) <= el.scrollTop + SPY_MARGIN) current = s.id
    return current
  }

  useEffect(() => {
    if (!jump) return
    targetRef.current = jump.section
    align(jump.section, true)
  }, [jump])

  useEffect(() => {
    const el = contentRef.current
    const inner = innerRef.current
    if (!el || !inner) return
    const onScrollEnd = () => {
      scrollingRef.current = false
    }
    const onUserScroll = () => {
      scrollingRef.current = false
      targetRef.current = null
    }
    el.addEventListener('scrollend', onScrollEnd)
    el.addEventListener('wheel', onUserScroll, { passive: true })
    const observer = new ResizeObserver(() => {
      if (targetRef.current) align(targetRef.current, false)
    })
    observer.observe(inner)
    return () => {
      el.removeEventListener('scrollend', onScrollEnd)
      el.removeEventListener('wheel', onUserScroll)
      observer.disconnect()
    }
  }, [])

  const onScroll = () => {
    const el = contentRef.current
    if (!el || scrollingRef.current) return
    targetRef.current = null
    onSection(sectionAt(el))
  }

  return (
    <div className="content" ref={contentRef} onScroll={onScroll}>
      <div className="content-inner" ref={innerRef}>
        <div className="page-header">
          <h1>{t('settings.title')}</h1>
        </div>

        <div className="card" id="settings-general">
          <h3>{t('settings.general')}</h3>
          <div className="field">
            <label>{t('settings.uiLanguage')}</label>
            <div>
              <LanguagePicker value={settings.uiLanguage} onChange={(uiLanguage) => void update({ uiLanguage })} />
            </div>
          </div>
        </div>

        <div className="card" id="settings-output">
          <h3>{t('settings.output')}</h3>
          <div className="field">
            <label>{t('settings.outputDir')}</label>
            <div className="row between">
              <code className="path">{settings.outputDir}</code>
              <button
                className="btn"
                onClick={async () => {
                  const dir = await window.api.settings.chooseDir(settings.outputDir)
                  if (dir) await update({ outputDir: dir })
                }}
              >
                {t('common.change')}
              </button>
            </div>
          </div>
          <div className="grid-2">
            <div className="field">
              <label>{t('settings.defaultFormat')}</label>
              <Segmented options={FORMATS} value={settings.format} onChange={(format) => void update({ format })} />
            </div>
            <div className="field">
              <label>{t('settings.resolution')}</label>
              <Segmented options={RESOLUTIONS.map((r) => ({ id: r, label: resolutionLabel(r) }))} value={settings.resolution} onChange={(resolution) => void update({ resolution })} />
            </div>
            <div className="field">
              <label>{t('settings.jpgFps')}</label>
              <NumberField min={0.25} max={30} step={0.25} value={settings.jpgFps} onChange={(jpgFps) => void update({ jpgFps })} />
              <span className="hint">{t('settings.jpgFpsHint')}</span>
            </div>
          </div>
          <Toggle
            label={t('settings.skipUnchanged')}
            hint={t('settings.skipUnchangedHint')}
            value={settings.skipUnchangedFrames}
            onChange={(v) => update({ skipUnchangedFrames: v })}
          />
        </div>

        <div className="card" id="settings-audio">
          <h3>{t('settings.audioSection')}</h3>
          <Toggle label={t('settings.recordMic')} value={settings.audio} onChange={(v) => update({ audio: v })} />
          <Toggle
            label={t('settings.transcribe')}
            hint={t('settings.transcribeHint')}
            value={settings.transcribe}
            disabled={!settings.audio}
            onChange={(v) => update({ transcribe: v })}
          />
          <div className="field mt-4">
            <label>{t('settings.speechLanguage')}</label>
            <select value={settings.speechLanguage} onChange={(e) => update({ speechLanguage: e.target.value as SpeechLanguage })}>
              <option value="auto">{t('settings.autoDetect')}</option>
              {SPEECH_LANGUAGES.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.label}
                </option>
              ))}
            </select>
            <span className="hint">{t('settings.speechLanguageHint')}</span>
          </div>
          <div className="field">
            <label>{t('settings.models')}</label>
            <ModelManager selected={settings.whisperModel} onSelect={(id) => void update({ whisperModel: id })} />
          </div>
        </div>

        <div className="card" id="settings-cursor">
          <h3>{t('settings.cursorSection')}</h3>
          <Toggle
            label={t('settings.trackClicks')}
            hint={t('settings.trackClicksHint')}
            value={settings.trackClicks}
            onChange={(v) => update({ trackClicks: v })}
          />
          <div className="field mt-4">
            <label>{t('settings.cursorHz')}</label>
            <NumberField min={1} max={60} value={settings.cursorHz} onChange={(cursorHz) => void update({ cursorHz })} />
            <span className="hint">{t('settings.cursorHzHint')}</span>
          </div>
        </div>

        <div className="card" id="settings-recording">
          <h3>{t('settings.recordingSection')}</h3>
          <Toggle
            label={t('settings.showControls')}
            hint={t('settings.showControlsHint')}
            value={settings.showControls}
            onChange={(v) => update({ showControls: v })}
          />
          <Toggle
            label={t('settings.showRegionFrame')}
            hint={t('settings.showRegionFrameHint')}
            value={settings.showRegionFrame}
            onChange={(v) => update({ showRegionFrame: v })}
          />
          <div className="field mt-4">
            <label>{t('settings.countdown')}</label>
            <NumberField min={0} max={10} value={settings.countdown} onChange={(countdown) => void update({ countdown })} />
          </div>
        </div>

        <div className="card" id="settings-shortcuts">
          <h3>{t('settings.shortcutsSection')}</h3>
          <ShortcutSettings settings={settings} update={update} platform={platform} />
        </div>

        <div className="card" id="settings-agents">
          <h3>{t('settings.agentsSection')}</h3>
          <AgentsPanel />
        </div>

        <div className="card" id="settings-startup">
          <h3>{t('settings.startupSection')}</h3>
          <Toggle
            label={t('settings.openAtLogin')}
            hint={login && !login.packaged ? t('settings.openAtLoginHint') : login?.status === 'requires-approval' ? t('settings.loginRequiresApproval') : undefined}
            value={login?.packaged ? login.openAtLogin : settings.openAtLogin}
            disabled={!login?.packaged}
            onChange={(v) => update({ openAtLogin: v })}
          />
          <Toggle
            label={t('settings.startHidden')}
            hint={t('settings.startHiddenHint')}
            value={settings.startHiddenAtLogin}
            disabled={!(login?.packaged ? login.openAtLogin : settings.openAtLogin)}
            onChange={(v) => update({ startHiddenAtLogin: v })}
          />
          {platform === 'darwin' && (
            <Toggle label={t('settings.showInDock')} hint={t('settings.showInDockHint')} value={settings.showInDock} onChange={(v) => update({ showInDock: v })} />
          )}
        </div>

        <div className="card" id="settings-permissions">
          <h3>{t('settings.permissions')}</h3>
          <PermissionsPanel />
        </div>
      </div>
    </div>
  )
}
