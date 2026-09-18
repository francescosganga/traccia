import { locale } from '../../shared/i18n'

export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const p = (n: number) => String(n).padStart(2, '0')
  return h > 0 ? `${h}:${p(m)}:${p(s)}` : `${p(m)}:${p(s)}`
}

export function formatBytes(n: number): string {
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(0)} MB`
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`
}

export function formatDate(ts: number): string {
  return new Date(ts).toLocaleString(locale(), { dateStyle: 'medium', timeStyle: 'short' })
}

/**
 * Human-readable version of an Electron accelerator ("CommandOrControl+Shift+R"):
 * "⌘⇧R" on macOS, "Ctrl+Shift+R" elsewhere.
 */
export function formatShortcut(accelerator: string, platform: string): string {
  const mac = platform === 'darwin'
  const parts = accelerator.split('+').map((p) => p.trim())
  const symbols: Record<string, string> = mac
    ? { commandorcontrol: '⌘', cmdorctrl: '⌘', command: '⌘', cmd: '⌘', control: '⌃', ctrl: '⌃', shift: '⇧', alt: '⌥', option: '⌥', super: '⌘', meta: '⌘' }
    : { commandorcontrol: 'Ctrl', cmdorctrl: 'Ctrl', command: 'Win', cmd: 'Win', control: 'Ctrl', ctrl: 'Ctrl', shift: 'Shift', alt: 'Alt', option: 'Alt', super: 'Win', meta: 'Win' }
  const mapped = parts.map((p) => symbols[p.toLowerCase()] ?? p.toUpperCase())
  return mac ? mapped.join('') : mapped.join('+')
}
