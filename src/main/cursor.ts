import { screen } from 'electron'
import { t } from '../shared/i18n'
import type { ClickEvent, CursorSample } from '../shared/types'

/**
 * Samples the global cursor position at high frequency and (optionally) listens to
 * global mouse clicks through uiohook. Timestamps are epoch ms so they can be
 * matched with the MediaRecorder start time coming from the renderer.
 */
export class CursorTracker {
  private timer: NodeJS.Timeout | null = null
  private hook: { start(): void; stop(): void; on(ev: string, fn: (e: unknown) => void): void; removeAllListeners(ev?: string): void } | null = null
  samples: CursorSample[] = []
  clicks: ClickEvent[] = []
  warnings: string[] = []
  /** True once the global mouse hook is actually running */
  private clicksTracked = false

  start(trackClicks: boolean, sampleHz = 120): void {
    this.samples = []
    this.clicks = []
    this.warnings = []
    this.clicksTracked = false
    this.timer = setInterval(() => {
      const p = screen.getCursorScreenPoint()
      this.samples.push({ t: Date.now(), x: p.x, y: p.y })
    }, Math.round(1000 / sampleHz))

    if (trackClicks) this.startClickHook()
  }

  private startClickHook(): void {
    try {
      // Lazy require: it is a native module and we only need it while recording.
      const { uIOhook } = require('uiohook-napi')
      this.hook = uIOhook
      uIOhook.removeAllListeners('mousedown')
      uIOhook.on('mousedown', (e: { button: number }) => {
        const p = screen.getCursorScreenPoint()
        const button = e.button === 2 ? 'right' : e.button === 3 ? 'middle' : 'left'
        this.clicks.push({ t: Date.now(), button, x: p.x, y: p.y })
      })
      uIOhook.start()
      this.clicksTracked = true
    } catch (e) {
      console.error('uiohook failed to start', e)
      this.hook = null
      this.warnings.push(t('warn.clicksHookFailed', { error: String((e as Error).message) }))
    }
  }

  stop(): { samples: CursorSample[]; clicks: ClickEvent[]; warnings: string[]; clicksTracked: boolean } {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    if (this.hook) {
      try {
        this.hook.stop()
        this.hook.removeAllListeners('mousedown')
      } catch (e) {
        console.error('uiohook stop', e)
      }
      this.hook = null
    }
    return { samples: this.samples, clicks: this.clicks, warnings: this.warnings, clicksTracked: this.clicksTracked }
  }
}
