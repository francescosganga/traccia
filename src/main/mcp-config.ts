import type { AgentTargetStatus, McpServerSpec } from '../shared/types'

/**
 * Text-level edits of MCP client configs: the JSON "mcpServers" format shared by Claude
 * Desktop, Cursor and most clients, and Codex's TOML. Pure functions, so agents.ts only
 * adds the file handling.
 */

function parseJsonObject(text: string, what: string): Record<string, unknown> {
  if (!text.trim()) return {}
  const parsed: unknown = JSON.parse(text)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error(`${what} is not a JSON object`)
  return parsed as Record<string, unknown>
}

/** Sets mcpServers.<name> and keeps everything else as it was. */
export function mergeJsonConfig(text: string, name: string, spec: McpServerSpec, what = 'the config'): string {
  const config = parseJsonObject(text, what)
  const servers = config.mcpServers ?? {}
  if (!servers || typeof servers !== 'object' || Array.isArray(servers)) throw new Error(`"mcpServers" in ${what} is not an object`)
  ;(servers as Record<string, unknown>)[name] = spec
  config.mcpServers = servers
  return JSON.stringify(config, null, 2) + '\n'
}

function sameSpec(entry: Partial<McpServerSpec> | undefined, spec: McpServerSpec): boolean {
  return !!entry && entry.command === spec.command && JSON.stringify(entry.args ?? []) === JSON.stringify(spec.args)
}

export function jsonConfigured(text: string, name: string, spec: McpServerSpec): AgentTargetStatus['configured'] {
  try {
    const servers = parseJsonObject(text, 'config').mcpServers as Record<string, Partial<McpServerSpec>> | undefined
    const entry = servers?.[name]
    if (!entry) return 'no'
    return sameSpec(entry, spec) ? 'yes' : 'stale'
  } catch {
    return 'no'
  }
}

export function tomlBlock(name: string, spec: McpServerSpec): string {
  const env = Object.entries(spec.env).map(([k, v]) => `${k} = ${JSON.stringify(v)}`)
  return [`[mcp_servers.${name}]`, `command = ${JSON.stringify(spec.command)}`, `args = ${JSON.stringify(spec.args)}`, `env = { ${env.join(', ')} }`].join('\n') + '\n'
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Replaces the [mcp_servers.<name>] table (sub-tables included) or appends it. */
export function mergeTomlConfig(text: string, name: string, spec: McpServerSpec): string {
  const ours = new RegExp(`^\\[mcp_servers\\.${escape(name)}(\\.[^\\]]*)?\\][^\\n]*\\n(?:(?!\\[).*\\n?)*`, 'gm')
  let rest = text.replace(ours, '').replace(/\n{3,}/g, '\n\n')
  if (rest.trim()) {
    if (!rest.endsWith('\n')) rest += '\n'
    rest += '\n'
  } else {
    rest = ''
  }
  return rest + tomlBlock(name, spec)
}

export function tomlConfigured(text: string, name: string, spec: McpServerSpec): AgentTargetStatus['configured'] {
  if (!new RegExp(`^\\[mcp_servers\\.${escape(name)}\\]`, 'm').test(text)) return 'no'
  return text.includes(tomlBlock(name, spec).trimEnd()) ? 'yes' : 'stale'
}
