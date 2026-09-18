/**
 * Minimal i18n shared by the main process and the renderer. Strings use {name}
 * placeholders. English is the default and the fallback for missing keys.
 */

export type UiLanguage = 'en' | 'it'

export const UI_LANGUAGES: { id: UiLanguage; label: string }[] = [
  { id: 'en', label: 'English' },
  { id: 'it', label: 'Italiano' }
]

const en = {
  // common
  'common.cancel': 'Cancel',
  'common.save': 'Save',
  'common.change': 'Change…',
  'common.request': 'Request',
  'common.openSettings': 'Open settings',
  'common.stop': 'Stop',
  'common.record': 'Record',
  'common.yes': 'yes',
  'common.no': 'no',

  // navigation
  'nav.record': 'Record',
  'nav.settings': 'Settings',

  // permissions panel
  'perm.screen.label': 'Screen Recording',
  'perm.screen.why': 'Required to capture the screen.',
  'perm.microphone.label': 'Microphone',
  'perm.microphone.why': 'Required only if you want to record your voice.',
  'perm.accessibility.label': 'Accessibility',
  'perm.accessibility.why': 'Required to log mouse clicks in the text file.',
  'perm.granted': 'Granted',
  'perm.denied': 'Denied',
  'perm.notDetermined': 'Not requested yet',
  'perm.notGranted': 'Not granted',
  'perm.notNeeded': 'No extra permissions are needed on this platform.',
  'perm.restartNote': 'After granting "Screen Recording" or "Accessibility", macOS requires restarting the app.',

  // home
  'home.title': 'New recording',
  'home.processing': 'Processing',
  'home.done': 'Recording complete',
  'home.error': 'Error',
  'home.frames': '{n} frames',
  'home.skipped': '({n} identical skipped)',
  'home.revealMac': 'Show in Finder',
  'home.revealOther': 'Show in folder',
  'home.openTxt': 'Open recording.txt',
  'home.openRawTxt': 'Open recording-raw.txt',
  'home.openVideo': 'Open video',
  'home.selectArea': 'Select the area on screen',
  'home.recording': 'Recording',
  'home.what': 'What to record',
  'home.fullScreen': 'Full screen',
  'home.area': 'Region',
  'home.display': 'Display',
  'home.primary': 'primary',
  'home.format': 'Output format',
  'home.resolution': 'Resolution',
  'home.native': 'Native',
  'home.jpgFps': 'Frames per second (JPG)',
  'home.audio': 'Audio',
  'home.mic': 'Microphone',
  'home.none': 'None',
  'home.clicks': 'Clicks: {value}',
  'home.shortcut': 'Shortcut: {value}',
  'home.recordButton': 'Record',
  'home.recordAreaButton': 'Select region and record',
  'home.hideNote': 'The window hides while recording. Stop with the widget or {shortcut}.',
  'home.recent': 'Recent recordings',

  // settings
  'settings.title': 'Settings',
  'settings.general': 'General',
  'settings.uiLanguage': 'Interface language',
  'settings.output': 'Output',
  'settings.outputDir': 'Recordings folder',
  'settings.defaultFormat': 'Default format',
  'settings.resolution': 'Resolution',
  'settings.jpgFps': 'Frames per second in JPG mode',
  'settings.jpgFpsHint': '2 or 4 fps are enough for an AI to follow a tutorial.',
  'settings.skipUnchanged': 'Skip unchanged frames (JPG)',
  'settings.skipUnchangedHint': 'Does not save a frame if, apart from the cursor, it is identical to the previous one. Greatly reduces the number of images.',
  'settings.audioSection': 'Audio',
  'settings.recordMic': 'Record the microphone',
  'settings.cursorSection': 'Cursor',
  'settings.trackClicks': 'Log mouse clicks',
  'settings.trackClicksHint': 'Requires the Accessibility permission. Keystrokes are never recorded.',
  'settings.cursorHz': 'Cursor positions written to the text file (per second, video mode)',
  'settings.cursorHzHint': 'The cursor is always sampled at 120 Hz; the full data is in recording.json.',
  'settings.recordingSection': 'Recording',
  'settings.showControls': 'Show the widget with timer and Stop',
  'settings.showControlsHint': 'The widget does not appear in the video.',
  'settings.countdown': 'Countdown (seconds)',
  'settings.shortcut': 'Global start/stop shortcut',
  'settings.shortcutHint': 'Electron accelerator format, e.g. {example}',
  'settings.permissions': 'Permissions',

  // floating controls & region overlay
  'controls.startingIn': 'Starting in {n}…',
  'controls.starting': 'Starting…',
  'region.hint': 'Drag to select the area to record · Esc to cancel',

  // errors & warnings (main process and engine)
  'err.screenPermission': 'Screen Recording permission not granted. Enable this app in System Settings → Privacy & Security → Screen Recording, then restart the app.',
  'err.noMainWindow': 'Main window not available',
  'err.engineTimeout': 'The recorder did not start within 20 seconds. Check the "Screen Recording" permission.',
  'err.processing': 'Processing failed: {error}. The raw file is in {path}',
  'err.captureFailed': 'Could not start capture: {error}.',
  'err.capturePermissionHint': 'Grant the "Screen Recording" permission in System Settings → Privacy & Security and restart the app.',
  'err.recorder': 'MediaRecorder error: {error}',
  'warn.clicksNoAccessibility': 'Clicks not recorded: Accessibility permission not granted',
  'warn.clicksHookFailed': 'Clicks not recorded: could not start the mouse hook ({error})',

  // processing steps
  'step.frames': 'Extracting frames',
  'step.saveAudio': 'Saving audio',
  'step.convert': 'Converting to {format}',
  'step.timeline': 'Writing timeline',

  // timeline (.txt) header
  'tl.title': '# Traccia — recorded on {date}',
  'tl.frames': '# Frames: folder frames/ ({w}x{h}, {fps} fps, {n} frames{skipped}), duration {duration}',
  'tl.skipped': '; {n} identical frames skipped',
  'tl.video': '# Video: {name} ({w}x{h}, {fps} fps, duration {duration})',
  'tl.audio': '# Audio: microphone',
  'tl.audioNone': '# Audio: none',
  'tl.unitVideo': 'video',
  'tl.unitImage': 'image',
  'tl.cursorFull': '# Cursor: coordinates in {unit} pixels, origin at the top-left corner; sampled at {hz} Hz only when it moves',
  'tl.cursorClicksOnly': '# Cursor: only mouse clicks are listed (coordinates in {unit} pixels, origin at the top-left corner); the full pointer movement is in recording-raw.txt',
  'tl.formatTitle': '# Line format:',
  'tl.fmtFrame': '#   mm:ss.mmm frame <file> cursor X,Y      image captured at that instant and pointer position',
  'tl.fmtFrameNoCursor': '#   mm:ss.mmm frame <file>                 image captured at that instant',
  'tl.fmtCursor': '#   mm:ss.mmm cursor X,Y                   pointer position',
  'tl.fmtClick': '#   mm:ss.mmm click left|right|middle X,Y  mouse click',
  'tl.warning': '# Warning: {text}'
}

export type TranslationKey = keyof typeof en

const it: Record<TranslationKey, string> = {
  'common.cancel': 'Annulla',
  'common.save': 'Salva',
  'common.change': 'Cambia…',
  'common.request': 'Richiedi',
  'common.openSettings': 'Apri impostazioni',
  'common.stop': 'Stop',
  'common.record': 'Registra',
  'common.yes': 'sì',
  'common.no': 'no',

  'nav.record': 'Registra',
  'nav.settings': 'Impostazioni',


  'perm.screen.label': 'Registrazione schermo',
  'perm.screen.why': 'Necessario per catturare lo schermo.',
  'perm.microphone.label': 'Microfono',
  'perm.microphone.why': 'Necessario solo se vuoi registrare la voce.',
  'perm.accessibility.label': 'Accessibilità',
  'perm.accessibility.why': 'Necessario per registrare i click del mouse nel file di testo.',
  'perm.granted': 'Concesso',
  'perm.denied': 'Negato',
  'perm.notDetermined': 'Da richiedere',
  'perm.notGranted': 'Non concesso',
  'perm.notNeeded': 'Su questa piattaforma non servono permessi aggiuntivi.',
  'perm.restartNote': 'Dopo aver concesso "Registrazione schermo" o "Accessibilità" macOS richiede il riavvio dell\'app.',


  'home.title': 'Nuova registrazione',
  'home.processing': 'Elaborazione in corso',
  'home.done': 'Registrazione completata',
  'home.error': 'Errore',
  'home.frames': '{n} frame',
  'home.skipped': '({n} identici saltati)',
  'home.revealMac': 'Mostra nel Finder',
  'home.revealOther': 'Mostra nella cartella',
  'home.openTxt': 'Apri recording.txt',
  'home.openRawTxt': 'Apri recording-raw.txt',
  'home.openVideo': 'Apri video',
  'home.selectArea': "Seleziona l'area sullo schermo",
  'home.recording': 'Registrazione in corso',
  'home.what': 'Cosa registrare',
  'home.fullScreen': 'Schermo intero',
  'home.area': 'Area',
  'home.display': 'Schermo',
  'home.primary': 'principale',
  'home.format': 'Formato di uscita',
  'home.resolution': 'Risoluzione',
  'home.native': 'Nativa',
  'home.jpgFps': 'Frame al secondo (JPG)',
  'home.audio': 'Audio',
  'home.mic': 'Microfono',
  'home.none': 'Nessuno',
  'home.clicks': 'Click: {value}',
  'home.shortcut': 'Scorciatoia: {value}',
  'home.recordButton': 'Registra',
  'home.recordAreaButton': 'Seleziona area e registra',
  'home.hideNote': "La finestra si nasconde durante la registrazione. Ferma con il widget o {shortcut}.",
  'home.recent': 'Registrazioni recenti',

  'settings.title': 'Impostazioni',
  'settings.general': 'Generale',
  'settings.uiLanguage': "Lingua dell'interfaccia",
  'settings.output': 'Output',
  'settings.outputDir': 'Cartella delle registrazioni',
  'settings.defaultFormat': 'Formato predefinito',
  'settings.resolution': 'Risoluzione',
  'settings.jpgFps': 'Frame al secondo in modalità JPG',
  'settings.jpgFpsHint': "2 o 4 fps bastano per far capire un tutorial a un'AI.",
  'settings.skipUnchanged': 'Salta i frame invariati (JPG)',
  'settings.skipUnchangedHint': 'Non salva un frame se, a parte il cursore, è identico al precedente. Riduce molto il numero di immagini.',
  'settings.audioSection': 'Audio',
  'settings.recordMic': 'Registra il microfono',
  'settings.cursorSection': 'Cursore',
  'settings.trackClicks': 'Registra i click del mouse',
  'settings.trackClicksHint': 'Richiede il permesso Accessibilità. I tasti premuti non vengono mai registrati.',
  'settings.cursorHz': 'Posizioni del cursore scritte nel file di testo (al secondo, modalità video)',
  'settings.cursorHzHint': 'Il cursore viene comunque campionato a 120 Hz; i dati completi sono in recording.json.',
  'settings.recordingSection': 'Registrazione',
  'settings.showControls': 'Mostra il widget con timer e Stop',
  'settings.showControlsHint': 'Il widget non compare nel video.',
  'settings.countdown': 'Conto alla rovescia (secondi)',
  'settings.shortcut': 'Scorciatoia globale avvia/ferma',
  'settings.shortcutHint': 'Formato acceleratori Electron, es. {example}',
  'settings.permissions': 'Permessi',

  'controls.startingIn': 'Inizio tra {n}…',
  'controls.starting': 'Avvio…',
  'region.hint': "Trascina per selezionare l'area da registrare · Esc per annullare",


  'err.screenPermission': 'Permesso "Registrazione schermo" non concesso. Abilita questa app in Impostazioni di Sistema → Privacy e sicurezza → Registrazione schermo, poi riavvia l\'app.',
  'err.noMainWindow': 'Finestra principale non disponibile',
  'err.engineTimeout': 'Il registratore non è partito entro 20 secondi. Controlla il permesso "Registrazione schermo".',
  'err.processing': 'Elaborazione fallita: {error}. Il file grezzo è in {path}',
  'err.captureFailed': 'Impossibile avviare la cattura: {error}.',
  'err.capturePermissionHint': 'Concedi il permesso "Registrazione schermo" in Impostazioni di Sistema → Privacy e sicurezza e riavvia l\'app.',
  'err.recorder': 'Errore MediaRecorder: {error}',
  'warn.clicksNoAccessibility': 'Click non registrati: permesso Accessibilità non concesso',
  'warn.clicksHookFailed': 'Click non registrati: impossibile avviare il monitor del mouse ({error})',

  'step.frames': 'Estrazione frame',
  'step.saveAudio': 'Salvataggio audio',
  'step.convert': 'Conversione in {format}',
  'step.timeline': 'Scrittura timeline',

  'tl.title': '# Traccia — registrazione del {date}',
  'tl.frames': '# Frame: cartella frames/ ({w}x{h}, {fps} fps, {n} frame{skipped}), durata {duration}',
  'tl.skipped': '; {n} frame identici saltati',
  'tl.video': '# Video: {name} ({w}x{h}, {fps} fps, durata {duration})',
  'tl.audio': '# Audio: microfono',
  'tl.audioNone': '# Audio: nessuno',
  'tl.unitVideo': 'del video',
  'tl.unitImage': 'delle immagini',
  'tl.cursorFull': '# Cursore: coordinate in pixel {unit}, origine in alto a sinistra; campionato a {hz} Hz solo quando si muove',
  'tl.cursorClicksOnly': '# Cursore: sono elencati solo i click del mouse (coordinate in pixel {unit}, origine in alto a sinistra); il movimento completo del puntatore è in recording-raw.txt',
  'tl.formatTitle': '# Formato delle righe:',
  'tl.fmtFrame': "#   mm:ss.mmm frame <file> cursor X,Y      immagine catturata in quell'istante e posizione del puntatore",
  'tl.fmtFrameNoCursor': "#   mm:ss.mmm frame <file>                 immagine catturata in quell'istante",
  'tl.fmtCursor': '#   mm:ss.mmm cursor X,Y                   posizione del puntatore',
  'tl.fmtClick': '#   mm:ss.mmm click left|right|middle X,Y  click del mouse',
  'tl.warning': '# Avviso: {text}'
}

const dictionaries: Record<UiLanguage, Record<TranslationKey, string>> = { en, it }

let current: UiLanguage = 'en'

export function setLanguage(lang: UiLanguage): void {
  current = lang in dictionaries ? lang : 'en'
}

export function getLanguage(): UiLanguage {
  return current
}

/** BCP 47 locale for date/number formatting in the current UI language. */
export function locale(): string {
  return current === 'it' ? 'it-IT' : 'en-US'
}

export function t(key: TranslationKey, params?: Record<string, string | number>): string {
  let s = dictionaries[current][key] ?? en[key] ?? key
  if (params) for (const [k, v] of Object.entries(params)) s = s.split(`{${k}}`).join(String(v))
  return s
}
