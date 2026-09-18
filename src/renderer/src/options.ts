import { t } from '../../shared/i18n'
import type { OutputFormat, Resolution } from '../../shared/types'

/** Option lists shared by Home and Settings so the same setting always shows the same labels. */
export const FORMATS: { id: OutputFormat; label: string }[] = [
  { id: 'mp4', label: 'MP4' },
  { id: 'mov', label: 'MOV' },
  { id: 'webm', label: 'WebM' },
  { id: 'jpg', label: 'JPG + txt' }
]
export const RESOLUTIONS: Resolution[] = ['native', '1080', '720', '480']
export const resolutionLabel = (r: Resolution): string => (r === 'native' ? t('home.native') : `${r}p`)
export const JPG_FPS = [1, 2, 4]
