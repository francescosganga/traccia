import { UI_LANGUAGES, type UiLanguage } from '../../../shared/i18n'

interface Props {
  value: UiLanguage
  onChange: (lang: UiLanguage) => void
}

export function LanguagePicker({ value, onChange }: Props) {
  return (
    <div className="segmented">
      {UI_LANGUAGES.map((l) => (
        <button key={l.id} className={value === l.id ? 'active' : ''} onClick={() => onChange(l.id)}>
          {l.label}
        </button>
      ))}
    </div>
  )
}
