# Traccia — screen recorder per AI

[🇬🇧 English](README.md) · 🇮🇹 Italiano

Registra lo schermo per spiegare qualcosa **a un'AI**, non solo a una persona.

<p align="center">
  <img src="docs/demo.gif" alt="Demo: selezione di un'area, registrazione con microfono, frame JPG più timeline leggibile da un'AI" width="100%">
</p>
<p align="center"><sub>Scegli <em>Area</em> e <em>JPG + txt</em> → trascina l'area → registra parlando → ferma dal widget → frame e <code>recording.txt</code> sono pronti. <a href="docs/demo.mp4">Versione MP4</a>.</sub></p>

Ogni registrazione produce, nella stessa cartella:

- il video (`recording.mp4` / `.mov` / `.webm`) **oppure** una sequenza di JPG a pochi fps (`frames/`);
- `recording.txt`: una timeline leggibile da un modello con i **click del mouse** (e le loro coordinate) e la **trascrizione della voce** (Whisper, in locale);
- `recording-raw.txt`: la stessa timeline più i **movimenti del puntatore** (posizione campionata a frequenza configurabile) — più pesante, per quando conta il percorso del puntatore;
- `recording.json`: gli stessi dati in forma completa (cursore a 120 Hz, geometria, ecc.).

Il `recording.txt` prodotto dalla demo qui sopra (modalità JPG, 2 fps; l'interfaccia era in inglese):

```
# Traccia — recorded on 9/17/2026, 9:48:49 PM
# Frames: folder frames/ (1416x1060, 2 fps, 10 frames; 17 identical frames skipped), duration 00:13.094
# Audio: microphone, transcribed with Whisper base (language: en)
# Cursor: only mouse clicks are listed (coordinates in image pixels, origin at the top-left corner); the full pointer movement is in recording-raw.txt
#
# Line format:
#   mm:ss.mmm frame <file>                 image captured at that instant
#   mm:ss.mmm click left|right|middle X,Y  mouse click
#   [mm:ss.mmm → mm:ss.mmm] text          transcribed speech

00:00.000 frame frames/frame_00001.jpg
[00:00.000 → 00:04.000] Let me show you how to turn on the VPN for this project.
00:02.500 frame frames/frame_00002.jpg
00:03.000 frame frames/frame_00003.jpg
00:03.500 frame frames/frame_00004.jpg
[00:04.000 → 00:10.000] I open a network tab, enable the VPN toggle, and save the changes.
00:05.500 frame frames/frame_00005.jpg
00:06.000 frame frames/frame_00006.jpg
00:08.000 frame frames/frame_00007.jpg
00:08.500 frame frames/frame_00008.jpg
00:12.000 frame frames/frame_00009.jpg
00:12.500 frame frames/frame_00010.jpg
```

<p align="center">
  <img src="docs/screenshots/output.png" alt="Il primo frame della demo accanto al suo recording.txt: le coordinate del cursore nel testo sono pixel dell'immagine" width="90%">
</p>
<p align="center"><sub>Il primo frame accanto alla timeline. Le coordinate nel testo (i click in <code>recording.txt</code>, anche le posizioni del puntatore in <code>recording-raw.txt</code>) sono pixel dell'immagine.</sub></p>

## Funzionalità

- Schermo intero o area selezionata trascinando (stile macOS).
- Output MP4, MOV, WebM o **JPG + txt** con fps configurabili (1, 2, 4…).
- Risoluzione nativa (Retina), 1080p, 720p, 480p.
- Registrazione del microfono e trascrizione con **Whisper in locale** (modelli scaricabili ed eliminabili dall'app; nessun dato lascia il computer).
- I modelli già presenti nella cache di Hugging Face (`~/.cache/huggingface/hub`, `HF_HOME`, `HF_HUB_CACHE`) vengono importati con hard link invece di essere riscaricati.
- **Timestamp a livello di parola**: il parlato è spezzato in frasi brevi che si intercalano ai click, e ogni riga di click riporta anche le parole pronunciate in quel momento (`click left 820,352 "ora clicco su Salva"`).
- Puntatore campionato a 120 Hz e click globali (con permesso Accessibilità).
- In modalità JPG i frame identici al precedente (cursore escluso) vengono saltati.
- Widget flottante con timer e Stop (escluso dalla registrazione), scorciatoia globale.
- Icona nella barra dei menu con azioni rapide: registra schermo/area, stop, formato, risoluzione, fps, microfono, trascrizione, click, registrazioni recenti.
- Apertura al login (avvio solo nella barra dei menu), icona nel Dock opzionale.
- Interfaccia in inglese e italiano.

## Schermate

### Primo avvio

Un wizard in quattro passi: lingua, permessi macOS, modello Whisper, cartella di output.

<p align="center">
  <img src="docs/screenshots/wizard-1-welcome.png" width="49%" alt="Passo di benvenuto con scelta della lingua">
  <img src="docs/screenshots/wizard-2-permissions.png" width="49%" alt="Passo dei permessi macOS">
</p>
<p align="center">
  <img src="docs/screenshots/wizard-3-whisper.png" width="49%" alt="Passo di download del modello Whisper">
  <img src="docs/screenshots/wizard-4-output.png" width="49%" alt="Passo cartella di output e scorciatoia">
</p>

### Registrazione

Scegli cosa catturare, formato e risoluzione, poi registra. La selezione dell'area funziona come lo strumento screenshot di macOS; durante la registrazione la finestra principale si nasconde e resta in primo piano un widget flottante con il timer (escluso dalla cattura).

<p align="center">
  <img src="docs/screenshots/home.png" width="49%" alt="Home: modalità di cattura, formato, risoluzione, fps, audio e registrazioni recenti">
  <img src="docs/screenshots/region-select.png" width="49%" alt="Overlay di selezione area con etichetta dimensioni e barra Registra/Annulla">
</p>
<p align="center">
  <img src="docs/screenshots/recording.png" width="49%" alt="Registrazione in corso con il widget flottante">
  <img src="docs/screenshots/done.png" width="49%" alt="Scheda registrazione completata con frame, frame saltati e segmenti trascritti">
</p>
<p align="center">
  <img src="docs/screenshots/widget.png" alt="Widget flottante con timer REC e Stop" height="52">
  &nbsp;&nbsp;&nbsp;
  <img src="docs/screenshots/tray.png" alt="Icona nella barra dei menu con il timer di registrazione" height="52">
</p>

### Impostazioni

<p align="center">
  <img src="docs/screenshots/settings-1-general-output.png" width="49%" alt="Impostazioni: lingua, cartella di output, formato, risoluzione, fps, salto frame identici">
  <img src="docs/screenshots/settings-2-audio-whisper.png" width="49%" alt="Impostazioni: microfono, trascrizione, lingua parlata, modelli Whisper">
</p>
<p align="center">
  <img src="docs/screenshots/settings-3-cursor-recording.png" width="49%" alt="Impostazioni: click, campionamento cursore, widget, countdown, scorciatoia, avvio">
  <img src="docs/screenshots/settings-4-permissions.png" width="49%" alt="Impostazioni: avvio, barra dei menu, Dock e permessi">
</p>

## Installazione

Scarica dalla [pagina Releases](../../releases/latest) la DMG per il tuo Mac: `arm64` per Apple Silicon (M1 e successivi), `x64` per Intel. Aprila e trascina **Traccia** in Applicazioni.

L'app non è firmata con un certificato sviluppatore Apple, quindi al primo avvio macOS si rifiuta di aprirla ("Apple non è in grado di verificare…"). Due modi per procedere:

- **Impostazioni di Sistema → Privacy e sicurezza**, scorri fino al messaggio su Traccia e clicca **Apri comunque** (serve solo la prima volta);
- oppure rimuovi il flag di quarantena dal terminale:

```bash
xattr -cr "/Applications/Traccia.app"
```

## Sviluppo

Il codice l'ho scritto io con un uso intensivo di Claude Code. Ogni riga è stata letta e capita; l'architettura, il formato di output e le scelte sono mie. Issue e PR sono benvenute, e rispondo personalmente.

Richiede Node 20+.

```bash
npm install
npm run dev        # avvia l'app con hot reload
npm run build      # build di produzione in out/
npm run dist       # crea la DMG in dist/ (non firmata)
npm run typecheck
```

Test rapido dell'intera pipeline senza cliccare nell'interfaccia (registra 6 secondi dello schermo principale e poi esce):

```bash
npm run build && TRACCIA_AUTOTEST=6 npx electron .
```

Variabili utili: `TRACCIA_AUTOTEST_MODE=region` con `TRACCIA_AUTOTEST_REGION=x,y,w,h` (in punti, relativi allo schermo); `TRACCIA_FFMPEG=/percorso/ffmpeg` per usare un ffmpeg diverso da quello incluso.

Gli screenshot dell'interfaccia usati in questo README (wizard, home, impostazioni) si rigenerano con un profilo temporaneo e senza permesso di registrazione schermo:

```bash
npm run build && TRACCIA_SCREENSHOTS=docs/screenshots npx electron .
```

Token e regole dei componenti sono in [docs/design-system.md](docs/design-system.md).

### Permessi macOS in sviluppo

In sviluppo l'app gira dentro `node_modules/electron/dist/Electron.app`, quindi macOS chiede i permessi per "Electron": Registrazione schermo (obbligatorio), Microfono, Accessibilità (per i click). Dopo aver concesso Registrazione schermo o Accessibilità bisogna riavviare l'app.

### Release

Le release le costruisce GitHub Actions ([release.yml](.github/workflows/release.yml)): il push di un tag `v*` compila le DMG arm64 e x64 su runner macOS e le allega a una release in bozza, da rivedere e pubblicare dalla pagina Releases.

```bash
npm version patch   # o minor / major: aggiorna package.json e crea il tag
git push --follow-tags
```

## Come funziona

| Parte | Tecnologia |
|---|---|
| Cattura video | `getDisplayMedia` + `MediaRecorder` (H.264 quando disponibile) nel renderer, chunk scritti su disco dal main process |
| Cursore | `screen.getCursorScreenPoint()` a 120 Hz nel main process |
| Click | [`uiohook-napi`](https://github.com/SnosMe/uiohook-napi) |
| Conversioni, crop, scaling, estrazione JPG | [`ffmpeg-static`](https://github.com/eugeneware/ffmpeg-static) (encoder hardware `h264_videotoolbox` su macOS) |
| Trascrizione | modelli OpenAI Whisper in formato ONNX (le esportazioni `_timestamped` di [onnx-community](https://huggingface.co/onnx-community), che forniscono i timestamp per parola) eseguiti da [`@huggingface/transformers`](https://github.com/huggingface/transformers.js) in un utility process |
| UI | Electron + Vite + React + TypeScript |

Struttura: `src/main` (processo principale: sessione di registrazione, ffmpeg, Whisper, timeline), `src/preload` (bridge IPC), `src/renderer` (interfaccia, engine di cattura, overlay di selezione area, widget), `src/shared` (tipi e traduzioni).

Le traduzioni sono in `src/shared/i18n.ts`; aggiungere una lingua significa aggiungere un dizionario lì.

## Roadmap

- Un CLI e un server MCP, così gli agenti possono leggere le registrazioni e avviare/fermare una registrazione senza avere l'app davanti.
- Un piccolo editor post-registrazione (taglio inizio/fine, rimozione di sezioni) che tiene la timeline allineata.
- Audio di sistema su macOS.
- Supporto Windows.
- Backend `whisper.cpp` su Apple Silicon.
- Altre lingue per l'interfaccia.

## Licenza

MIT — vedi [LICENSE](LICENSE).
