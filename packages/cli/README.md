# traccia-cli

Command-line tool and [MCP](https://modelcontextprotocol.io) server for [Traccia](https://github.com/francescosganga/traccia), the macOS screen recorder that writes output meant to be read by an AI: a video or a JPG sequence plus a text timeline with the mouse clicks and the voice transcript.

If you have the app, you do not need this package: **Settings → AI agents** registers the MCP server bundled in the app with Claude Code, Claude Desktop, Cursor or Codex. This package is the same program for terminals and for machines without the app. Reading recordings works on the files alone; starting and stopping a recording needs the app running, reached over its local control socket.

```bash
npx -y traccia-cli list                     # recordings in the output folder, newest first
npx -y traccia-cli show latest              # print recording.txt (--raw for recording-raw.txt, --json for the metadata)
npx -y traccia-cli status                   # what the app is doing
npx -y traccia-cli record start --jpg --no-audio --countdown 0   # the app must be running; --launch opens it
npx -y traccia-cli record stop              # stop, wait for the files and print where they are
npx -y traccia-cli --help
```

`npm install -g traccia-cli` gives you a plain `traccia` command.

## MCP server

```bash
claude mcp add traccia -- npx -y traccia-cli mcp
```

```json
{
  "mcpServers": {
    "traccia": { "command": "npx", "args": ["-y", "traccia-cli", "mcp"] }
  }
}
```

Tools: `list_recordings`, `get_timeline`, `get_transcript`, `get_frames` (JPEG images, downscaled to 1024 px wide), `get_status`, `start_recording`, `stop_recording`. Prompts: `write_bug_report`, `explain_recording`. Resources: `recording://<id>/recording.txt`, `recording-raw.txt`, `recording.json`, `recording://<id>/frames/<file>`.

Frames of video recordings are extracted with `ffmpeg` (from the `PATH`, `TRACCIA_FFMPEG`, or the copy bundled in the installed app); JPG recordings need nothing.

Environment: `TRACCIA_OUTPUT_DIR` (recordings folder, otherwise the app's setting), `TRACCIA_USER_DATA` (the app's profile folder), `TRACCIA_CONTROL_SOCKET` (socket path).

Full documentation in the [Traccia README](https://github.com/francescosganga/traccia#cli--mcp). MIT license.
