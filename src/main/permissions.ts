import { desktopCapturer, shell, systemPreferences } from 'electron'
import type { MediaAccessStatus, Permissions } from '../shared/types'

const isMac = process.platform === 'darwin'

type Current = Omit<Permissions, 'restartNeeded'>

let atLaunch: Current | null = null

function read(): Current {
  if (!isMac) {
    return { screen: 'granted', microphone: 'granted', accessibility: true }
  }
  return {
    screen: systemPreferences.getMediaAccessStatus('screen') as MediaAccessStatus,
    microphone: systemPreferences.getMediaAccessStatus('microphone') as MediaAccessStatus,
    accessibility: systemPreferences.isTrustedAccessibilityClient(false)
  }
}

/** Snapshot taken at startup: Screen Recording and Accessibility granted later only work after a relaunch. */
export function rememberLaunchPermissions(): void {
  atLaunch = read()
}

export function getPermissions(): Permissions {
  const now = read()
  const restartNeeded =
    !!atLaunch && ((now.screen === 'granted' && atLaunch.screen !== 'granted') || (now.accessibility && !atLaunch.accessibility))
  return { ...now, restartNeeded }
}

/** Triggers the system prompt (or registers the app in the privacy list) for the given permission. */
export async function requestPermission(kind: 'screen' | 'microphone' | 'accessibility'): Promise<Permissions> {
  if (isMac) {
    try {
      if (kind === 'microphone') await systemPreferences.askForMediaAccess('microphone')
      if (kind === 'accessibility') systemPreferences.isTrustedAccessibilityClient(true)
      // There is no explicit API for screen recording: enumerating sources makes macOS
      // show the prompt and add the app to the Screen Recording list.
      if (kind === 'screen') await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 1, height: 1 } })
    } catch (e) {
      console.error('requestPermission', kind, e)
    }
  }
  return getPermissions()
}

export function openPrivacySettings(kind: 'screen' | 'microphone' | 'accessibility'): void {
  if (!isMac) return
  const pane = { screen: 'Privacy_ScreenCapture', microphone: 'Privacy_Microphone', accessibility: 'Privacy_Accessibility' }[kind]
  void shell.openExternal(`x-apple.systempreferences:com.apple.preference.security?${pane}`)
}

/** Keyboard → Keyboard Shortcuts, where the macOS screenshot shortcuts (Shift+Cmd+3/4/5) must be disabled for Traccia to receive them. */
export function openKeyboardShortcuts(): void {
  if (!isMac) return
  void shell.openExternal('x-apple.systempreferences:com.apple.Keyboard-Settings.extension?Shortcuts')
}
