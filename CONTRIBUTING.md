# Contributing to Traccia

Traccia is maintained by one person, and every issue and pull request is read and answered personally. This file says how to propose a change and what makes it easy to accept. [AGENTS.md](AGENTS.md) is its companion: the layout of the code, the conventions and the things that bite. It is written for coding agents but applies to people too; read it before your first pull request.

## Issues

**Bugs.** Say what you did, what you expected and what happened instead, with:

- the Traccia version (at the bottom of the main window's sidebar), the macOS version, and whether the Mac is Apple Silicon or Intel;
- the settings of the recording: full screen or region, format, resolution, audio, webcam;
- what the app printed, when it matters: started from a terminal with `/Applications/Traccia.app/Contents/MacOS/Traccia`, the app prints its errors there.

A recording folder (`recording.txt`, `recording.json`) often shows the problem better than a description, but it holds your screen and what you said: share only what you would show anyone.

**Features.** Open an issue before writing code for anything larger than a small fix, so we can agree it fits before you spend time on it. Traccia does one thing, a recording an AI can read, and the [roadmap](README.md#roadmap) lists what is already planned.

**Security.** Do not describe a vulnerability in a public issue. Open one that only says you have a security report, and a private channel will be arranged.

## Setting up

You need macOS (the app does not run elsewhere yet) and Node 20 or later.

```bash
git clone https://github.com/francescosganga/traccia.git
cd traccia
npm install
npm run dev
```

In development the app runs inside `node_modules/electron/dist/Electron.app`, so macOS asks for the permissions on behalf of "Electron": Screen Recording (required), Microphone, Camera (for the webcam) and Accessibility (for the clicks). After granting Screen Recording or Accessibility, quit the app and start it again.

If Traccia is also installed on your Mac, `TRACCIA_USER_DATA=/some/dir npm run dev` gives the development build its own settings, control socket and single-instance lock, so the two can run side by side.

## Making a change

Branch from `main`. A pull request makes one change: leave unrelated files alone, even when they could be tidier, and open an issue or a second pull request for what you noticed along the way.

The [conventions in AGENTS.md](AGENTS.md#conventions) apply. The ones most often missed:

- every string the user sees goes through `t()` in [src/shared/i18n.ts](src/shared/i18n.ts), in English and Italian (the types reject a key missing from either). If you do not speak Italian, write your best attempt and say so in the pull request;
- an error shown to the user is translated, and the original is logged with `console.error` and enough context to find it;
- comments say why, not what;
- no emoji, in code, comments, commit messages or the UI: icons come from `<Icon>`;
- a change people can see goes in both `README.md` and `README.it.md`.

## Checking it

No CI runs on pull requests, so these are up to you, and the pull request should say you ran them:

```bash
npm run typecheck   # the app (both tsconfigs) and the CLI
npm test            # vitest, src/**/*.test.ts
```

Logic that can be tested without starting the app (the timeline, the edit list, the ffmpeg filter graphs, the duplicate-frame skipping) has unit tests beside it, `timeline.test.ts` next to `timeline.ts`: add or update them when you change it.

Then run what you changed:

- **The UI**: `npm run dev`, and go through the screens you touched in light and dark appearance, in English and Italian.
- **The recording pipeline**: `npm run build && TRACCIA_AUTOTEST=6 npx electron .` records 6 seconds of the primary display and quits; add `TRACCIA_AUTOTEST_MODE=region TRACCIA_AUTOTEST_REGION=x,y,w,h` for a region. Then open the recording and read `recording.txt` as the AI would. Run it from your own terminal: processes started by an AI agent usually lack the Screen Recording permission and fail.
- **The CLI and the MCP server**: `npm run build:cli`, then `node packages/cli/dist/traccia.cjs --help`.
- **Anything that only the packaged app does** (the asar, the bundled CLI, registering the MCP server from Settings, permissions under the hardened runtime): `npm run link` builds the unpacked app and symlinks it into `/Applications`. It does not replace an installed `Traccia.app`: move that one away first. Permissions granted to a build signed differently can look enabled and still be refused; `tccutil reset ScreenCapture com.develee.traccia` (likewise `Accessibility`, `Microphone`, `Camera`) clears them.

## Commits

Small commits, one change each, with a message that says what changed and why. The history uses `feat:`, `fix:`, `refactor:`, `chore:`, `docs:` and `ci:`.

The subject of every `feat:` and `fix:` commit goes verbatim into the release notes, so write it for the people who use the app, not for the code:

```
fix: in region mode the webcam bubble starts at its corner, not in the middle of the screen
```

rather than `fix: wrong initial position in WebcamBubble`. `scripts/release-notes.sh HEAD` previews what your commits add.

No generated trailers (`Co-Authored-By`, `Generated-by`, ...). Never commit `out/`, `dist/` or `.claude/`, and leave `docs/screenshots/` alone: if your change alters a screen the README shows, say so in the pull request and the screenshots will be captured again.

## Pull requests

The description says:

- what changes for the person using the app, and why;
- how you checked it: the commands above, the macOS version and architecture you ran it on, what you tried by hand;
- what it looks like, for anything visible: screenshots, or a short recording (Traccia makes those);
- the issue it closes, if there is one.

### AI tools

Using an AI assistant is fine and expected. You are responsible for every line you submit: read the diff, run it, and be able to explain it. Say in the description which tool you used and what you checked by hand. Bulk rewrites, template-shaped descriptions and pull requests whose author cannot answer questions about them are closed.

Agents that read `AGENTS.md` (Codex and Cursor directly, Claude Code through `CLAUDE.md`) already know the conventions above.

## License

Traccia is released under the [MIT License](LICENSE). By opening a pull request you agree that your contribution is released under the same license.
