# Working in this repository

Traccia is an Electron app for macOS that records the screen and writes output meant to be read by an AI: a video or a JPG sequence plus `recording.txt` (clicks and transcript on one timeline), `recording-raw.txt` (same, with the pointer movement) and `recording.json`. [README.md](README.md) says what it does; this file says how to work on it. It is written for coding agents and applies to humans too.

## Commands

```bash
npm install
npm run dev          # app with hot reload
npm run typecheck    # both tsconfigs; must pass before every commit
npm run build        # production build into out/
npm run link         # unpacked .app symlinked into /Applications, for testing the packaged build
npm run dist         # DMG in dist/, signed only if a Developer ID certificate is in the keychain
npm run build && TRACCIA_AUTOTEST=6 npx electron .   # records 6 s of the primary display and quits
npm run build && TRACCIA_SCREENSHOTS=docs/screenshots npx electron .   # regenerates the wizard/home/settings screenshots
```

Node 20+. There is no linter or formatter configured: match the surrounding code.

## Layout

- `src/main` — main process. `session.ts` drives a recording end to end; `cursor.ts` (pointer sampling, global clicks), `ffmpeg.ts` + `frames.ts` (conversion, crop/scale, JPG extraction with duplicate skipping), `whisper.ts` + `whisper-worker.ts` (transcription in a utility process), `timeline.ts` (`recording.txt` / `-raw.txt` / `.json`), `tray.ts`, `windows.ts`, `ipc.ts`, `settings.ts`.
- `src/preload` — the only bridge between main and renderer (`window.api`). Its types reach the renderer through `src/renderer/src/global.d.ts`.
- `src/renderer` — React UI. Three windows: `index.html` (main), `region.html` (drag-to-select overlay), `controls.html` (floating widget, excluded from the capture). `src/components/Icon.tsx` is the icon set.
- `src/shared` — `types.ts` and `i18n.ts` (English and Italian dictionaries).
- `docs/` — what the README embeds: `screenshots/` (wizard, home and settings come from the `TRACCIA_SCREENSHOTS` helper; recording, widget, tray and the demo GIF are captured by hand), and `design-system.md` + `design-system.html`, which explain the tokens and component rules behind `styles.css`.

## Conventions

- TypeScript, 2-space indent, no semicolons, single quotes, long lines are fine. No `any`.
- Comments say why, not what. A JSDoc line on exported functions when the contract is not obvious from the signature. Never restate the code.
- No emoji anywhere: code, comments, commit messages, UI (use `<Icon>`), README.
- Every user-facing string goes through `t()` in `src/shared/i18n.ts`, in both `en` and `it`. Adding a language means adding a dictionary there and an entry in `UI_LANGUAGES`.
- Errors shown to the user are translated; the original error is logged with `console.error` and enough context to find it.
- `README.md` and `README.it.md` say the same things: change both. The README describes what exists, not what is planned; the roadmap stays a short list of intentions.
- Do not add files the project does not need (CONTRIBUTING, CODE_OF_CONDUCT, CHANGELOG, issue templates, lint configs, editor settings) unless asked.

## Things that bite

- macOS permissions in development are granted to `Electron.app` (the app runs from `node_modules/electron`), not to Traccia. After granting Screen Recording or Accessibility, restart the app.
- The native modules (`uiohook-napi`, `onnxruntime-node`, `sharp`, `ffmpeg-static`) ship binaries for the host architecture only: build arm64 on Apple Silicon and x64 on Intel. That is why `release.yml` uses one runner per architecture, and why they are `asarUnpack`ed in `electron-builder.yml`.
- Whisper models are the `_timestamped` ONNX exports from `onnx-community` (they give word-level timestamps); models already in the Hugging Face cache are hard-linked, not downloaded again.
- Releases are signed with Developer ID and notarized, with the hardened runtime and the entitlements in `build/entitlements.mac.plist`. The credentials exist only as the GitHub secrets listed at the top of `release.yml`; never put them in the repo. Under the hardened runtime a device needs its entitlement: without `com.apple.security.device.audio-input` the microphone is silently denied.

## Git

- Small commits, one change each, with a message that says what changed and why. No generated trailers (`Co-Authored-By`, `Generated-by`, ...).
- `npm run typecheck` before committing; `npm test` too once it exists.
- Never commit `out/`, `dist/`, `.claude/`, or screenshots you did not re-capture.

## Contributing with AI tools

Using an AI assistant is fine and expected. You are responsible for every line you submit: read the diff, run it, and be able to explain it. Keep a pull request to one change and leave unrelated files alone. Say in the description which tool you used and what you checked by hand. Bulk rewrites, template-shaped descriptions and PRs whose author cannot answer questions about them are closed.
