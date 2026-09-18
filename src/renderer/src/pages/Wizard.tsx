import { useState } from 'react'
import { t } from '../../../shared/i18n'
import type { Settings } from '../../../shared/types'
import { Icon, Logo, type IconName } from '../components/Icon'
import { LanguagePicker } from '../components/LanguagePicker'
import { ModelManager } from '../components/ModelManager'
import { PermissionsPanel } from '../components/PermissionsPanel'
import { formatShortcut } from '../format'

interface Props {
  settings: Settings
  update: (patch: Partial<Settings>) => Promise<void>
  platform: string
  onDone: () => void
}

const STEPS = 4
const FEATURES = ['screen', 'cursor', 'voice', 'ai'] as const
const ICONS: Record<(typeof FEATURES)[number], IconName> = { screen: 'monitor', cursor: 'pointer', voice: 'mic', ai: 'sparkles' }

export function Wizard({ settings, update, platform, onDone }: Props) {
  const [step, setStep] = useState(0)

  const next = () => setStep((s) => Math.min(STEPS - 1, s + 1))
  const back = () => setStep((s) => Math.max(0, s - 1))
  const finish = async () => {
    await update({ onboardingDone: true })
    onDone()
  }

  return (
    <div className="content">
      <div className="wizard">
        <div className="steps">
          {Array.from({ length: STEPS }).map((_, i) => (
            <span key={i} className={i <= step ? 'done' : ''} />
          ))}
        </div>

        {step === 0 && (
          <>
            <div className="row between start">
              <div>
                <Logo size={40} />
                <h1 className="mt-3">{t('wizard.welcome.title')}</h1>
                <p className="dim">{t('wizard.welcome.subtitle')}</p>
              </div>
              <LanguagePicker value={settings.uiLanguage} onChange={(uiLanguage) => void update({ uiLanguage })} />
            </div>
            <div className="card mt-5">
              {FEATURES.map((f) => (
                <div className="feature" key={f}>
                  <span className="status-icon accent">
                    <Icon name={ICONS[f]} />
                  </span>
                  <div>
                    <strong>{t(`wizard.feature.${f}.title`)}</strong>
                    <p className="dim small">{t(`wizard.feature.${f}.desc`, { file: 'recording.txt' })}</p>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}

        {step === 1 && (
          <>
            <h1>{t('wizard.permissions.title')}</h1>
            <p className="dim">{t('wizard.permissions.subtitle')}</p>
            <div className="card mt-5">
              <PermissionsPanel />
            </div>
          </>
        )}

        {step === 2 && (
          <>
            <h1>{t('wizard.whisper.title')}</h1>
            <p className="dim">{t('wizard.whisper.subtitle')}</p>
            <div className="card mt-5">
              <ModelManager selected={settings.whisperModel} onSelect={(id) => void update({ whisperModel: id })} />
            </div>
          </>
        )}

        {step === 3 && (
          <>
            <h1>{t('wizard.output.title')}</h1>
            <p className="dim">{t('wizard.output.subtitle')}</p>
            <div className="card mt-5">
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
            <div className="card">
              <p>{t('wizard.shortcut.text', { shortcut: formatShortcut(settings.shortcut, platform) })}</p>
            </div>
          </>
        )}

        <div className="actions">
          <button className="btn ghost" onClick={back} disabled={step === 0}>
            {t('common.back')}
          </button>
          {step < STEPS - 1 ? (
            <button className="btn primary" onClick={next}>
              {step === 2 ? t('common.continue') : t('common.next')}
            </button>
          ) : (
            <button className="btn primary" onClick={finish}>
              {t('wizard.finish')}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
