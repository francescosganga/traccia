import { UI_LANGUAGES, type UiLanguage } from '../../../shared/i18n'
import { Segmented } from './Segmented'

interface Props {
  value: UiLanguage
  onChange: (lang: UiLanguage) => void
}

export function LanguagePicker({ value, onChange }: Props) {
  return <Segmented options={UI_LANGUAGES} value={value} onChange={onChange} />
}
