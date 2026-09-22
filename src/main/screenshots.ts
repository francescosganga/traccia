import { app, nativeTheme, type BrowserWindow } from 'electron'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { applySettings } from './apply-settings'
import { getSettings } from './settings'
import { broadcast } from './windows'

/**
 * Development helper: TRACCIA_SCREENSHOTS=<dir> captures the main window as PNGs into
 * that directory right after startup (the four wizard steps, home, the settings sections),
 * then quits. Runs on a throwaway profile and uses capturePage, so it needs no
 * screen-capture permission. TRACCIA_SCREENSHOTS_LANG=it switches the UI language first,
 * TRACCIA_SCREENSHOTS_THEME=light renders the light appearance.
 */
export const screenshotsEnabled = (): boolean => !!process.env.TRACCIA_SCREENSHOTS

let disposableProfile: string | null = null

/**
 * Call before app.whenReady: screenshot runs never touch the real settings. The real
 * profile folder is used only if it does not exist yet (so paths in the pictures look
 * normal) and is deleted on quit; otherwise a temp folder is used.
 */
export function useScreenshotProfile(): void {
  if (!screenshotsEnabled()) return
  const real = app.getPath('userData')
  disposableProfile = existsSync(real) ? mkdtempSync(join(tmpdir(), 'traccia-screenshots-')) : real
  app.setPath('userData', disposableProfile)
  app.on('will-quit', () => {
    if (disposableProfile) rmSync(disposableProfile, { recursive: true, force: true })
  })
}

export function setupScreenshots(win: BrowserWindow): boolean {
  const dir = process.env.TRACCIA_SCREENSHOTS
  if (!dir) return false
  mkdirSync(dir, { recursive: true })
  if (process.env.TRACCIA_SCREENSHOTS_THEME === 'light' || process.env.TRACCIA_SCREENSHOTS_THEME === 'dark') nativeTheme.themeSource = process.env.TRACCIA_SCREENSHOTS_THEME
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
  const shot = async (name: string) => {
    await wait(700)
    const img = await win.webContents.capturePage()
    writeFileSync(join(dir, `${name}.png`), img.toPNG())
    console.log(`[screenshots] ${name}.png`)
  }
  const js = (code: string) => win.webContents.executeJavaScript(code)
  const scrollToCard = (i: number) =>
    js(`(() => { const c = document.querySelectorAll('.content-inner > .card')[${i}]; document.querySelector('.content').scrollTo(0, c ? c.offsetTop - 32 : 99999) })()`)

  win.webContents.once('did-finish-load', () => {
    void (async () => {
      const lang = process.env.TRACCIA_SCREENSHOTS_LANG
      if (lang === 'it' || lang === 'en') applySettings({ uiLanguage: lang })
      // Throwaway profile, so turning the shortcuts on only makes the pictures show the keys chooser
      applySettings({ shortcutsEnabled: true })
      await wait(400)
      if (!getSettings().onboardingDone) {
        const steps = ['wizard-1-welcome', 'wizard-2-permissions', 'wizard-3-whisper', 'wizard-4-output']
        for (let i = 0; i < steps.length; i++) {
          await shot(steps[i])
          if (i < steps.length - 1) await js(`document.querySelector('.wizard .actions .btn.primary').click()`)
        }
        applySettings({ onboardingDone: true })
      }
      await shot('home')
      broadcast('navigate', 'settings')
      await shot('settings-1-general-output')
      await scrollToCard(2)
      await shot('settings-2-audio-whisper')
      await scrollToCard(3)
      await shot('settings-3-cursor-recording')
      await scrollToCard(7)
      await shot('settings-4-permissions')
      await scrollToCard(6)
      await shot('settings-5-agents')
      app.quit()
    })()
  })
  return true
}
