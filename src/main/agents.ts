import { app, dialog } from 'electron'
import { execFile } from 'child_process'
import { accessSync, constants, copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'fs'
import { homedir } from 'os'
import { dirname, join } from 'path'
import type { AgentInstallResult, AgentTarget, AgentTargetStatus, McpCommands, McpServerSpec } from '../shared/types'
import { jsonConfigured, mergeJsonConfig, mergeTomlConfig, tomlConfigured } from './mcp-config'
import { getMainWindow } from './windows'

/**
 * Registers the MCP server with AI clients from the settings page. The server is the
 * CLI bundled in the app (cli/traccia.cjs inside app.asar) run by the app's own
 * executable in Node mode, so users need neither Node nor npm.
 */

const SERVER_NAME = 'traccia'
const SHELL_TIMEOUT = 5000

/** The bundled CLI: inside app.asar when packaged, the workspace build in development. */
export function cliScriptPath(): string {
  return app.isPackaged ? join(app.getAppPath(), 'cli', 'traccia.cjs') : join(app.getAppPath(), 'packages', 'cli', 'dist', 'traccia.cjs')
}

export function mcpServerSpec(): McpServerSpec {
  return { command: process.execPath, args: [cliScriptPath(), 'mcp'], env: { ELECTRON_RUN_AS_NODE: '1' } }
}

const quote = (s: string) => (/^[\w./=-]+$/.test(s) ? s : `'${s.replace(/'/g, "'\\''")}'`)

// The name goes before -e: that option is variadic and would swallow the name as a variable.
const claudeAddArgs = (spec: McpServerSpec): string[] => [
  'claude', 'mcp', 'add', '-s', 'user', SERVER_NAME,
  ...Object.entries(spec.env).flatMap(([k, v]) => ['-e', `${k}=${v}`]),
  '--', spec.command, ...spec.args
]

/** The three forms shown or copied by the settings page. */
export function mcpCommands(): McpCommands {
  const spec = mcpServerSpec()
  const env = Object.entries(spec.env).map(([k, v]) => `${k}=${v}`)
  return {
    launch: [...env, spec.command, ...spec.args].map(quote).join(' '),
    claude: claudeAddArgs(spec).map(quote).join(' '),
    json: JSON.stringify({ mcpServers: { [SERVER_NAME]: spec } }, null, 2)
  }
}

// ---- config files ---------------------------------------------------------------------

function configPath(target: Exclude<AgentTarget, 'claude-code'>): string {
  switch (target) {
    case 'claude-desktop':
      return join(app.getPath('appData'), 'Claude', 'claude_desktop_config.json')
    case 'cursor':
      return join(homedir(), '.cursor', 'mcp.json')
    case 'codex':
      return join(homedir(), '.codex', 'config.toml')
  }
}

const readText = (path: string): string => (existsSync(path) ? readFileSync(path, 'utf8') : '')

/** Rewrites a config through `merge`, keeping a .bak of the previous file. */
function updateConfig(path: string, merge: (text: string) => string): void {
  const next = merge(readText(path))
  mkdirSync(dirname(path), { recursive: true })
  if (existsSync(path)) copyFileSync(path, path + '.bak')
  writeFileSync(path, next)
}

function configured(target: Exclude<AgentTarget, 'claude-code'>, path: string): AgentTargetStatus['configured'] {
  const text = readText(path)
  return target === 'codex' ? tomlConfigured(text, SERVER_NAME, mcpServerSpec()) : jsonConfigured(text, SERVER_NAME, mcpServerSpec())
}

// ---- Claude Code ------------------------------------------------------------------------

const isExecutable = (p: string): boolean => {
  try {
    accessSync(p, constants.X_OK)
    return true
  } catch {
    return false
  }
}

/** Asks the user's login shell, which knows about nvm, volta and friends; falls back to the usual places. */
async function findClaude(): Promise<string | null> {
  const fromShell = await new Promise<string | null>((resolve) => {
    const shell = process.env.SHELL || '/bin/zsh'
    execFile(shell, ['-ilc', 'command -v claude'], { timeout: SHELL_TIMEOUT, env: { ...process.env, TERM: 'dumb' } }, (err, stdout) => {
      const line = stdout.toString().trim().split('\n').pop() ?? ''
      resolve(!err && line.startsWith('/') ? line : null)
    })
  })
  if (fromShell && isExecutable(fromShell)) return fromShell
  const home = homedir()
  const candidates = [
    join(home, '.local', 'bin', 'claude'),
    '/opt/homebrew/bin/claude',
    '/usr/local/bin/claude',
    join(home, '.npm-global', 'bin', 'claude'),
    join(home, '.volta', 'bin', 'claude'),
    join(home, '.bun', 'bin', 'claude')
  ]
  const nvm = join(home, '.nvm', 'versions', 'node')
  if (existsSync(nvm)) for (const v of readdirSync(nvm).sort().reverse()) candidates.push(join(nvm, v, 'bin', 'claude'))
  return candidates.find(isExecutable) ?? null
}

function claudeCodeConfigured(): AgentTargetStatus['configured'] {
  // User-scope servers live in ~/.claude.json; reading it is cheaper than spawning the CLI.
  return jsonConfigured(readText(join(homedir(), '.claude.json')), SERVER_NAME, mcpServerSpec())
}

function runClaude(claude: string, args: string[]): Promise<{ ok: boolean; output: string }> {
  return new Promise((resolve) => {
    execFile(claude, args, { timeout: 30_000 }, (err, stdout, stderr) => {
      resolve({ ok: !err, output: (stderr.toString() + stdout.toString()).trim() })
    })
  })
}

async function installClaudeCode(): Promise<AgentInstallResult> {
  const claude = await findClaude()
  if (!claude) return { ok: false, path: 'claude', error: 'claude command not found' }
  const spec = mcpServerSpec()
  // "add" refuses to overwrite: drop the previous entry first (harmless when there is none).
  await runClaude(claude, ['mcp', 'remove', '-s', 'user', SERVER_NAME])
  const res = await runClaude(claude, claudeAddArgs(spec).slice(1))
  if (!res.ok) return { ok: false, path: claude, error: res.output || 'claude mcp add failed' }
  return { ok: true, path: claude }
}

// ---- API used by ipc.ts -------------------------------------------------------------------

export async function agentTargets(): Promise<AgentTargetStatus[]> {
  const claude = await findClaude()
  const file = (id: Exclude<AgentTarget, 'claude-code'>): AgentTargetStatus => {
    const path = configPath(id)
    // The client is considered installed when its config folder exists, even before its first config file.
    return { id, path, available: existsSync(dirname(path)), configured: configured(id, path) }
  }
  return [{ id: 'claude-code', path: claude, available: !!claude, configured: claudeCodeConfigured() }, file('claude-desktop'), file('cursor'), file('codex')]
}

export async function installAgent(target: AgentTarget): Promise<AgentInstallResult> {
  try {
    if (target === 'claude-code') return await installClaudeCode()
    const path = configPath(target)
    updateConfig(path, (text) =>
      target === 'codex' ? mergeTomlConfig(text, SERVER_NAME, mcpServerSpec()) : mergeJsonConfig(text, SERVER_NAME, mcpServerSpec(), path)
    )
    return { ok: true, path }
  } catch (e) {
    console.error('cannot register the MCP server with', target, e)
    return { ok: false, path: target === 'claude-code' ? 'claude' : configPath(target), error: (e as Error).message }
  }
}

/** Lets the user pick any JSON config in the mcpServers format and adds the server to it. */
export async function installAgentInFile(): Promise<AgentInstallResult | null> {
  const win = getMainWindow()
  const res = await dialog.showOpenDialog(win!, {
    defaultPath: homedir(),
    properties: ['openFile', 'showHiddenFiles'],
    filters: [{ name: 'JSON', extensions: ['json'] }]
  })
  if (res.canceled || !res.filePaths[0]) return null
  const path = res.filePaths[0]
  try {
    updateConfig(path, (text) => mergeJsonConfig(text, SERVER_NAME, mcpServerSpec(), path))
    return { ok: true, path }
  } catch (e) {
    console.error('cannot add the MCP server to', path, e)
    return { ok: false, path, error: (e as Error).message }
  }
}
