import { useEffect, useState } from 'react'
import { t } from '../../../shared/i18n'
import type { LoginItemStatus, Settings, SpeechLanguage } from '../../../shared/types'
import { LanguagePicker } from '../components/LanguagePicker'
import { ModelManager } from '../components/ModelManager'
import { PermissionsPanel } from '../components/PermissionsPanel'
import { Toggle } from '../components/Toggle'
import { FORMATS, RESOLUTIONS, resolutionLabel } from '../options'

interface Props {
  settings: Settings
  update: (patch: Partial<Settings>) => Promise<void>
}

const SPEECH_LANGUAGES: { id: SpeechLanguage; label: string }[] = [
  { id: 'en', label: 'English' },
  { id: 'it', label: 'Italiano' },
  { id: 'es', label: 'Español' },
  { id: 'fr', label: 'Français' },
  { id: 'de', label: 'Deutsch' },
  { id: 'pt', label: 'Português' }
]

export function SettingsPage({ settings, update }: Props) {
  const [shortcut, setShortcut] = useState(settings.shortcut)
  const [login, setLogin] = useState<LoginItemStatus | null>(null)
  const [platform, setPlatform] = useState('darwin')

  useEffect(() => {
    void window.api.system.loginItem().then(setLogin)
    void window.api.system.platform().then(setPlatform)
  }, [settings.openAtLogin])

  return (
    <div className="content">
      <div className="content-inner">
        <div className="page-header">
          <h1>{t('settings.title')}</h1>
        </div>

        <div className="card">
          <h3>{t('settings.general')}</h3>
          <div className="field">
            <label>{t('settings.uiLanguage')}</label>
            <div>
              <LanguagePicker value={settings.uiLanguage} onChange={(uiLanguage) => void update({ uiLanguage })} />
            </div>
          </div>
        </div>

        <div className="card">
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
              <div className="segmented">
                {FORMATS.map((f) => (
                  <button key={f.id} className={settings.format === f.id ? 'active' : ''} onClick={() => update({ format: f.id })}>
                    {f.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="field">
              <label>{t('settings.resolution')}</label>
              <div className="segmented">
                {RESOLUTIONS.map((r) => (
                  <button key={r} className={settings.resolution === r ? 'active' : ''} onClick={() => update({ resolution: r })}>
                    {resolutionLabel(r)}
                  </button>
                ))}
              </div>
            </div>
            <div className="field">
              <label>{t('settings.jpgFps')}</label>
              <input
                type="number"
                min={0.25}
                max={30}
                step={0.25}
                value={settings.jpgFps}
                onChange={(e) => update({ jpgFps: Math.max(0.25, Math.min(30, Number(e.target.value) || 2)) })}
              />
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

        <div className="card">
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
          <button
            className="btn danger"
            onClick={async () => {
              if (confirm(t('settings.confirmDeleteAll'))) {
                await window.api.whisper.deleteAll()
                location.reload()
              }
            }}
          >
            {t('settings.deleteAll')}
          </button>
        </div>

        <div className="card">
          <h3>{t('settings.cursorSection')}</h3>
          <Toggle
            label={t('settings.trackClicks')}
            hint={t('settings.trackClicksHint')}
            value={settings.trackClicks}
            onChange={(v) => update({ trackClicks: v })}
          />
          <div className="field mt-4">
            <label>{t('settings.cursorHz')}</label>
            <input
              type="number"
              min={1}
              max={60}
              value={settings.cursorHz}
              onChange={(e) => update({ cursorHz: Math.max(1, Math.min(60, Number(e.target.value) || 10)) })}
            />
            <span className="hint">{t('settings.cursorHzHint')}</span>
          </div>
        </div>

        <div className="card">
          <h3>{t('settings.recordingSection')}</h3>
          <Toggle
            label={t('settings.showControls')}
            hint={t('settings.showControlsHint')}
            value={settings.showControls}
            onChange={(v) => update({ showControls: v })}
          />
          <div className="grid-2 mt-4">
            <div className="field">
              <label>{t('settings.countdown')}</label>
              <input
                type="number"
                min={0}
                max={10}
                value={settings.countdown}
                onChange={(e) => update({ countdown: Math.max(0, Math.min(10, Number(e.target.value) || 0)) })}
              />
            </div>
            <div className="field">
              <label>{t('settings.shortcut')}</label>
              <div className="row">
                <input type="text" className="grow" value={shortcut} onChange={(e) => setShortcut(e.target.value)} />
                <button className="btn" disabled={shortcut === settings.shortcut} onClick={() => update({ shortcut })}>
                  {t('common.save')}
                </button>
              </div>
              <span className="hint">{t('settings.shortcutHint', { example: 'CommandOrControl+Shift+R' })}</span>
            </div>
          </div>
        </div>

        <div className="card">
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
            onChange={(v) => update({ startHiddenAtLogin: v })}
          />
          {platform === 'darwin' && (
            <Toggle label={t('settings.showInDock')} hint={t('settings.showInDockHint')} value={settings.showInDock} onChange={(v) => update({ showInDock: v })} />
          )}
        </div>

        <div className="card">
          <h3>{t('settings.permissions')}</h3>
          <PermissionsPanel />
        </div>
      </div>
    </div>
  )
}
