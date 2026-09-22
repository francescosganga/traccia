import { useEffect, useState, type KeyboardEvent } from 'react'
import { t } from '../../../shared/i18n'
import { formatShortcut } from '../format'

interface Props {
  label: string
  /** Electron accelerator */
  value: string
  platform: string
  onChange: (accelerator: string) => void
}

// KeyboardEvent.code → Electron key name. Codes rather than characters: with Alt held, macOS
// turns "5" into "∞" and the accelerator would not match the key the user meant.
const CODES: Record<string, string> = {
  Space: 'Space',
  Enter: 'Return',
  Backspace: 'Backspace',
  Delete: 'Delete',
  Tab: 'Tab',
  Home: 'Home',
  End: 'End',
  PageUp: 'PageUp',
  PageDown: 'PageDown',
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
  Comma: ',',
  Period: '.',
  Slash: '/',
  Semicolon: ';',
  Quote: "'",
  BracketLeft: '[',
  BracketRight: ']',
  Backslash: '\\',
  Minus: '-',
  Equal: '=',
  Backquote: '`'
}

function keyName(code: string): string | null {
  if (/^Key[A-Z]$/.test(code)) return code.slice(3)
  if (/^Digit[0-9]$/.test(code)) return code.slice(5)
  if (/^Numpad[0-9]$/.test(code)) return 'num' + code.slice(6)
  if (/^F([1-9]|1[0-9]|2[0-4])$/.test(code)) return code
  return CODES[code] ?? null
}

function modifiers(e: KeyboardEvent, mac: boolean): string[] {
  const m: string[] = []
  if (e.ctrlKey) m.push('Control')
  if (e.altKey) m.push('Alt')
  if (e.shiftKey) m.push('Shift')
  if (e.metaKey) m.push(mac ? 'Command' : 'Super')
  return m
}

/**
 * A field that takes the shortcut by pressing it. While it listens, the app's global
 * shortcuts are unregistered, otherwise pressing the current one would start a recording.
 */
export function ShortcutRecorder({ label, value, platform, onChange }: Props) {
  const mac = platform === 'darwin'
  const [listening, setListening] = useState(false)
  const [held, setHeld] = useState<string[]>([])
  const [invalid, setInvalid] = useState(false)

  useEffect(() => {
    if (!listening) return
    void window.api.system.suspendShortcuts(true)
    return () => void window.api.system.suspendShortcuts(false)
  }, [listening])

  const stop = () => {
    setListening(false)
    setHeld([])
  }

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (!listening) {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        setListening(true)
      }
      return
    }
    e.preventDefault()
    if (e.key === 'Escape') {
      stop()
      return
    }
    const mods = modifiers(e, mac)
    const key = keyName(e.code)
    if (!key || ['Shift', 'Control', 'Alt', 'Meta'].includes(e.key)) {
      setHeld(mods)
      return
    }
    // Shift alone is not enough: a global "Shift+5" would eat every "%" typed anywhere
    if (!mods.some((m) => m !== 'Shift')) {
      setInvalid(true)
      setHeld(mods)
      return
    }
    setInvalid(false)
    onChange([...mods, key].join('+'))
    stop()
  }

  const strong = mac ? '⌘, ⌃, ⌥' : 'Ctrl, Alt, Win'
  return (
    <div className="field">
      <label>{label}</label>
      <button
        type="button"
        className={`shortcut-recorder ${listening ? 'listening' : ''}`}
        onClick={() => (listening ? stop() : setListening(true))}
        onKeyDown={onKeyDown}
        onKeyUp={() => listening && setHeld([])}
        onBlur={stop}
      >
        {listening ? (
          held.length ? <kbd>{formatShortcut(held.join('+'), platform)}</kbd> : <span className="dim">{t('shortcut.press')}</span>
        ) : (
          <>
            <kbd>{formatShortcut(value, platform)}</kbd>
            <span className="small dim">{t('common.change')}</span>
          </>
        )}
      </button>
      {invalid && <span className="hint text-warn">{t('shortcut.needModifier', { mods: strong })}</span>}
    </div>
  )
}
