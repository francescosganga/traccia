// Input devices (microphones, cameras) as the tray and the pickers show them.
import { t } from './i18n'
import type { InputDevice, MicList } from './types'

/** Finds the chosen input by id, then by label; undefined when it is not connected. */
export function findDevice(wanted: InputDevice, devices: InputDevice[]): InputDevice | undefined {
  return devices.find((d) => d.id === wanted.id) ?? devices.find((d) => d.label === wanted.label)
}

/** "System default", with the device it currently is: a headset that connects quietly becomes the default. */
export function systemDefaultLabel(list: MicList): string {
  return list.defaultLabel ? t('mic.systemDefaultNamed', { name: list.defaultLabel }) : t('mic.systemDefault')
}
