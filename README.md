# Traccia — AI screen recorder

🇬🇧 English · [🇮🇹 Italiano](README.it.md)

Record your screen to explain something **to an AI**, not just to a person.

<p align="center">
  <img src="docs/demo.gif" alt="Demo: select a region, record with the microphone, get JPG frames plus an AI-readable timeline" width="100%">
</p>
<p align="center"><sub>Pick <em>Region</em> and <em>JPG + txt</em> → drag the area → record while talking → stop from the widget → frames + <code>recording.txt</code> are ready. <a href="docs/demo.mp4">MP4 version</a>.</sub></p>

Every recording produces, in the same folder:

- the video (`recording.mp4` / `.mov` / `.webm`) **or** a JPG sequence at a few frames per second (`frames/`);
- `recording.txt`: a timeline a model can read, with the **mouse clicks** (and their coordinates) and the **voice transcript** (Whisper, running locally);
- `recording-raw.txt`: the same timeline plus the **pointer movement** (position sampled at a configurable rate) — heavier, for when the path of the pointer matters;
- `recording.json`: the same data in full (cursor at 120 Hz, geometry, etc.);
- `PROMPT.md`: the instructions for the AI — what the folder contains (with absolute paths), how to read the timeline and what to do with it. When the recording is done, **Copy prompt for AI** puts `Read the file …/PROMPT.md and follow its instructions.` in the clipboard: paste it into Claude Code, Cursor or any agent that can read files and it finds everything on its own.

The `recording.txt` produced by the demo above (JPG mode, 2 fps):

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
  <img src="docs/screenshots/output.png" alt="The first frame of the demo next to its recording.txt: the cursor coordinates in the text are pixels of the image" width="90%">
</p>
<p align="center"><sub>The first frame next to its timeline. Coordinates in the text (clicks in <code>recording.txt</code>, pointer positions too in <code>recording-raw.txt</code>) are pixel positions in the image.</sub></p>

## Features

- Full screen or a region selected by dragging (macOS style).
- Output as MP4, MOV, WebM or **JPG + txt** with configurable frame rate (1, 2, 4…). The choices on the home page (format, resolution, fps, microphone) apply to the next recording only; the defaults live in Settings.
- Native (Retina), 1080p, 720p or 480p resolution.
- Microphone recording and transcription with **Whisper running locally** (models can be downloaded and deleted from the app; nothing leaves your computer).
- Models already present in the Hugging Face cache (`~/.cache/huggingface/hub`, `HF_HOME`, `HF_HUB_CACHE`) are imported with hard links instead of being downloaded again.
- **Word-level timestamps**: speech is split into short phrases that interleave with the clicks, and every click line also carries the words being spoken at that moment (`click left 820,352 "now I click Save"`).
- Pointer sampled at 120 Hz and global mouse clicks (with the Accessibility permission).
- In JPG mode, frames identical to the previous one (cursor excluded) are skipped.
- `PROMPT.md` in every recording folder and a one-click **Copy prompt for AI** (also in the recent recordings list and in the menu bar).
- Floating widget with timer, Stop and what is being recorded (format, microphone), excluded from the capture; a red frame outlines the region being recorded, like the macOS recorder. Optional global shortcuts, off by default: the macOS screenshot keys (⇧⌘5 full screen, ⇧⌘4 region), alternative ones (⌃⌥⌘5, ⌃⌥⌘4) or your own, recorded by pressing the keys; either one also stops.
- Recordings can be named and moved to the Trash from the app; a transcription that takes too long can be skipped.
- Menu bar icon with quick actions: record screen/region, stop, format, resolution, fps, microphone, transcription, clicks, recent recordings.
- Open at login (menu-bar-only start), optional Dock icon.
- Interface in English and Italian, light or dark with the system.
- A **CLI and an MCP server** (`traccia-cli`), so an AI agent can read recordings and start or stop one without the app in front.

## Screenshots

### First run

A four-step wizard: language, macOS permissions, Whisper model, output folder.

<p align="center">
  <img src="docs/screenshots/wizard-1-welcome.png" width="49%" alt="Welcome step with language picker">
  <img src="docs/screenshots/wizard-2-permissions.png" width="49%" alt="macOS permissions step">
</p>
<p align="center">
  <img src="docs/screenshots/wizard-3-whisper.png" width="49%" alt="Whisper model download step">
  <img src="docs/screenshots/wizard-4-output.png" width="49%" alt="Output folder and shortcut step">
</p>

### Recording

Choose what to capture, the format and the resolution, then record. Dragging a region works like the macOS screenshot tool; while recording the main window hides and a floating widget with the timer stays on top (it is excluded from the capture).

<p align="center">
  <img src="docs/screenshots/home.png" width="49%" alt="Home: capture mode, format, resolution, fps, audio and recent recordings">
  <img src="docs/screenshots/region-select.png" width="49%" alt="Region selection overlay with size label and Record/Cancel toolbar">
</p>
<p align="center">
  <img src="docs/screenshots/recording.png" width="49%" alt="Recording in progress with the floating widget">
  <img src="docs/screenshots/done.png" width="49%" alt="Recording complete card with frames, skipped frames and transcript segments">
</p>
<p align="center">
  <img src="docs/screenshots/widget.png" alt="Floating widget with REC timer and Stop" height="52">
  &nbsp;&nbsp;&nbsp;
  <img src="docs/screenshots/tray.png" alt="Menu bar icon showing the recording timer" height="52">
</p>

### Settings

<p align="center">
  <img src="docs/screenshots/settings-1-general-output.png" width="49%" alt="Settings: language, output folder, format, resolution, fps, skip unchanged frames">
  <img src="docs/screenshots/settings-2-audio-whisper.png" width="49%" alt="Settings: microphone, transcription, spoken language, Whisper models">
</p>
<p align="center">
  <img src="docs/screenshots/settings-3-cursor-recording.png" width="49%" alt="Settings: clicks, cursor sampling, widget, countdown, shortcut, startup">
  <img src="docs/screenshots/settings-4-permissions.png" width="49%" alt="Settings: startup, menu bar, Dock and permissions">
</p>

## Install

Download the DMG for your Mac from the [Releases page](../../releases/latest): `arm64` for Apple Silicon (M1 and later), `x64` for Intel. Open it and drag **Traccia** into Applications.

The DMGs are signed with a Developer ID certificate and notarized by Apple, so the app opens without warnings.

If you enable the shortcuts with the macOS screenshot keys (⇧⌘5, ⇧⌘4), macOS keeps handling them until you turn them off in **System Settings → Keyboard → Keyboard Shortcuts → Screenshots**; the app links to that pane. The alternative keys need no change.

## CLI & MCP

The app includes an [MCP](https://modelcontextprotocol.io) server and a command-line tool, so an AI agent can list the recordings, read their timeline and frames, and start or stop a recording without the app in front. Reading works on the files alone; starting and stopping talk to the running app through a local control socket.

### MCP server

**Settings → AI agents** registers the server with one click in Claude Code, Claude Desktop, Cursor or Codex, or copies the JSON for any other client and adds it to a config file you choose. Nothing else to install: the server is the copy of the app you are running, started by the client through the app's own binary in Node mode.

```json
{
  "mcpServers": {
    "traccia": {
      "command": "/Applications/Traccia.app/Contents/MacOS/Traccia",
      "args": ["/Applications/Traccia.app/Contents/Resources/app.asar/cli/traccia.cjs", "mcp"],
      "env": { "ELECTRON_RUN_AS_NODE": "1" }
    }
  }
}
```

The server offers:

- **tools** — `list_recordings`, `get_timeline` (clicks, or raw with the pointer movement), `get_transcript`, `get_frames` (JPEG images downscaled to 1024 px wide, spread over a time range, at most 30 per call), `get_status`, `start_recording`, `stop_recording`;
- **prompts** — `write_bug_report` and `explain_recording`: the timeline plus a handful of frames, with instructions;
- **resources** — `recording://<id>/recording.txt`, `recording-raw.txt`, `recording.json` and `recording://<id>/frames/<file>`.

Frames of JPG recordings come straight from `frames/`; for video recordings the server extracts stills with the `ffmpeg` bundled in the app (or the one in the `PATH`, or `TRACCIA_FFMPEG`). Each image costs about a thousand tokens, which is why `get_frames` takes a time range and a maximum. ChatGPT does not support local MCP servers; Codex does.

### Command line

The same program is published on npm as [`traccia-cli`](packages/cli), for terminals and for machines without the app (an agent reading a synced recordings folder, for instance):

```bash
npx -y traccia-cli list                     # recordings in the output folder, newest first
npx -y traccia-cli show latest              # print recording.txt (--raw for recording-raw.txt, --json for the metadata)
npx -y traccia-cli status                   # what the app is doing
npx -y traccia-cli record start --jpg --no-audio --countdown 0   # the app must be running (--launch opens it)
npx -y traccia-cli record stop              # stop, wait for the files and print where they are
npx -y traccia-cli mcp                      # the MCP server, e.g. claude mcp add traccia -- npx -y traccia-cli mcp
```

`npm install -g traccia-cli` gives you a plain `traccia` command. A recording id is the folder name (`2026-09-18_08-51-52`), `latest`, or the path of a recording folder. `record start` takes `--region` (drag the area on screen, as from the app) or `--rect x,y,w,h`, `--display`, `--format`, `--fps`, `--resolution`, `--no-audio`, `--no-transcribe` and `--countdown`; options you do not pass come from the app's settings, and the ones you pass apply to that recording only. `--json` makes every command machine-readable; `--dir` reads recordings from a folder other than the one in the settings. `traccia --help` lists everything.

### Control socket

While the app runs it listens on `~/Library/Application Support/traccia/control.sock` (a Unix socket, readable by the current user only) for one JSON object per line: `status`, `start`, `stop`, `settings`, `displays`; the protocol is in [src/shared/control.ts](src/shared/control.ts). Windows would need a named pipe instead; the app is macOS-only today, so that path is untested.

## Development

The code was written by me with heavy use of Claude Code. Every line has been read and understood; the architecture, the output format and the trade-offs are mine. Issues and PRs are welcome, and I answer them personally.

Requires Node 20+.

```bash
npm install
npm run dev        # start the app with hot reload
npm run build      # production build into out/
npm run dist       # create the DMG in dist/ (signed only if a Developer ID certificate is in the keychain)
npm run typecheck
```

Quick end-to-end test without clicking through the UI (records 6 seconds of the primary display, then quits):

```bash
npm run build && TRACCIA_AUTOTEST=6 npx electron .
```

Useful variables: `TRACCIA_AUTOTEST_MODE=region` with `TRACCIA_AUTOTEST_REGION=x,y,w,h` (in points, relative to the display); `TRACCIA_FFMPEG=/path/to/ffmpeg` to use a different ffmpeg than the bundled one; `TRACCIA_USER_DATA=/some/dir` to run with a separate profile (settings, control socket, single-instance lock), for instance next to the installed app.

The CLI and the MCP server live in `packages/cli` (an npm workspace); `npm run build` bundles them into `packages/cli/dist/traccia.cjs` along with the app, and the packaged app carries that file as `app.asar/cli/traccia.cjs`. `npm run typecheck` and `npm test` cover them too.

UI screenshots for this README (wizard, home, settings) are regenerated with a throwaway profile and no screen-capture permission; the app follows the system appearance, `TRACCIA_SCREENSHOTS_THEME=dark` (or `light`) forces one:

```bash
npm run build && TRACCIA_SCREENSHOTS=docs/screenshots npx electron .
```

The design tokens and component rules live in [docs/design-system.md](docs/design-system.md).

### macOS permissions in development

In development the app runs inside `node_modules/electron/dist/Electron.app`, so macOS asks for permissions for "Electron": Screen Recording (required), Microphone, Accessibility (for clicks). After granting Screen Recording or Accessibility the app must be restarted.

### Releases

Releases are built by GitHub Actions ([release.yml](.github/workflows/release.yml)): pushing a `v*` tag builds, signs and notarizes the arm64 and x64 DMGs on macOS runners and attaches them to a draft release, to be reviewed and published from the Releases page. Signing needs the repository secrets listed at the top of the workflow.

```bash
npm version patch   # or minor / major: bumps package.json and creates the tag
git push --follow-tags
```

Publishing the release on GitHub also publishes `traccia-cli` to npm, with the same version number ([publish-cli.yml](.github/workflows/publish-cli.yml), npm trusted publishing: no token in the repository).

## How it works

| Part | Technology |
|---|---|
| Video capture | `getDisplayMedia` + `MediaRecorder` (H.264 when available) in the renderer, chunks written to disk by the main process |
| Cursor | `screen.getCursorScreenPoint()` at 120 Hz in the main process |
| Clicks | [`uiohook-napi`](https://github.com/SnosMe/uiohook-napi) |
| Conversion, crop, scaling, JPG extraction | [`ffmpeg-static`](https://github.com/eugeneware/ffmpeg-static) (hardware `h264_videotoolbox` encoder on macOS) |
| Transcription | OpenAI Whisper models in ONNX format (the `_timestamped` exports from [onnx-community](https://huggingface.co/onnx-community), which provide word-level timestamps) run by [`@huggingface/transformers`](https://github.com/huggingface/transformers.js) in a utility process |
| UI | Electron + Vite + React + TypeScript |
| CLI and MCP server | plain Node, [`@modelcontextprotocol/sdk`](https://github.com/modelcontextprotocol/typescript-sdk), `sharp` to downscale frames; talks to the app over a Unix socket |

Layout: `src/main` (main process: recording session, ffmpeg, Whisper, timeline, control socket), `src/preload` (IPC bridge), `src/renderer` (UI, capture engine, region overlay, widget), `src/shared` (types, translations, the recording reader used by both the app and the CLI), `packages/cli` (CLI and MCP server).

Translations live in `src/shared/i18n.ts`; adding a language means adding a dictionary there.

## Roadmap

- [x] A CLI and an MCP server, so agents can read recordings and start/stop a recording without the app in front (see [CLI & MCP](#cli--mcp)).
- [ ] A small post-recording editor (trim, cut sections) that keeps the timeline in sync.
- [ ] System audio on macOS.
- [ ] Windows support.
- [ ] `whisper.cpp` backend on Apple Silicon.
- [ ] More interface languages.

## License

MIT — see [LICENSE](LICENSE).
