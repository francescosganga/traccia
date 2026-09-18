export type ShortcutPreset = 'mac' | 'alt' | 'custom'

/** Key pairs offered in the UI: "mac" mirrors the macOS screenshot shortcuts, "alt" avoids them. */
export const SHORTCUT_PRESETS = {
  mac: { screen: 'CommandOrControl+Shift+5', region: 'CommandOrControl+Shift+4' },
  alt: { screen: 'Control+Alt+Command+5', region: 'Control+Alt+Command+4' }
} as const

const NAMED = ['mac', 'alt'] as const

export function presetOf(screen: string, region: string): ShortcutPreset {
  return NAMED.find((p) => SHORTCUT_PRESETS[p].screen === screen && SHORTCUT_PRESETS[p].region === region) ?? 'custom'
}
