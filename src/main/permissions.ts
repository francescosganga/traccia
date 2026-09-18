import { desktopCapturer, shell, systemPreferences } from 'electron'
import type { MediaAccessStatus, Permissions } from '../shared/types'

const isMac = process.platform === 'darwin'

export function getPermissions(): Permissions {
  if (!isMac) {
    return { screen: 'granted', microphone: 'granted', accessibility: true }
  }
  return {
    screen: systemPreferences.getMediaAccessStatus('screen') as MediaAccessStatus,
    microphone: systemPreferences.getMediaAccessStatus('microphone') as MediaAccessStatus,
    accessibility: systemPreferences.isTrustedAccessibilityClient(false)
  }
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
