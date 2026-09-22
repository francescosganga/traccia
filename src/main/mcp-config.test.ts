import { describe, expect, it } from 'vitest'
import { jsonConfigured, mergeJsonConfig, mergeTomlConfig, tomlConfigured } from './mcp-config'
import type { McpServerSpec } from '../shared/types'

const spec: McpServerSpec = {
  command: '/Applications/Traccia.app/Contents/MacOS/Traccia',
  args: ['/Applications/Traccia.app/Contents/Resources/app.asar/cli/traccia.cjs', 'mcp'],
  env: { ELECTRON_RUN_AS_NODE: '1' }
}
const moved: McpServerSpec = { ...spec, command: '/Users/me/Desktop/Traccia.app/Contents/MacOS/Traccia' }

describe('mergeJsonConfig', () => {
  it('creates the file from nothing', () => {
    expect(JSON.parse(mergeJsonConfig('', 'traccia', spec))).toEqual({ mcpServers: { traccia: spec } })
  })

  it('keeps other servers and unrelated keys', () => {
    const before = { theme: 'dark', mcpServers: { other: { command: 'php', args: ['x.php'] } } }
    const after = JSON.parse(mergeJsonConfig(JSON.stringify(before), 'traccia', spec))
    expect(after).toEqual({ theme: 'dark', mcpServers: { other: before.mcpServers.other, traccia: spec } })
  })

  it('replaces a previous entry', () => {
    const before = mergeJsonConfig('', 'traccia', moved)
    expect(JSON.parse(mergeJsonConfig(before, 'traccia', spec)).mcpServers.traccia).toEqual(spec)
  })

  it('refuses a file that is not a JSON object', () => {
    expect(() => mergeJsonConfig('[]', 'traccia', spec, 'x.json')).toThrow('x.json is not a JSON object')
    expect(() => mergeJsonConfig('{"mcpServers": 3}', 'traccia', spec, 'x.json')).toThrow('"mcpServers" in x.json is not an object')
    expect(() => mergeJsonConfig('{oops', 'traccia', spec)).toThrow()
  })
})

describe('jsonConfigured', () => {
  it('tells a current entry from a stale or missing one', () => {
    expect(jsonConfigured('', 'traccia', spec)).toBe('no')
    expect(jsonConfigured('not json', 'traccia', spec)).toBe('no')
    expect(jsonConfigured(mergeJsonConfig('', 'traccia', spec), 'traccia', spec)).toBe('yes')
    expect(jsonConfigured(mergeJsonConfig('', 'traccia', moved), 'traccia', spec)).toBe('stale')
  })
})

describe('mergeTomlConfig', () => {
  const block = ['[mcp_servers.traccia]', `command = "${spec.command}"`, `args = ${JSON.stringify(spec.args)}`, 'env = { ELECTRON_RUN_AS_NODE = "1" }', ''].join('\n')

  it('appends to an existing config, separated by a blank line', () => {
    const before = 'model = "o3"\n\n[mcp_servers.other]\ncommand = "php"\n'
    expect(mergeTomlConfig(before, 'traccia', spec)).toBe(before + '\n' + block)
    expect(mergeTomlConfig('', 'traccia', spec)).toBe(block)
  })

  it('replaces its own table and sub-tables, leaving the rest', () => {
    const before = ['model = "o3"', '', '[mcp_servers.traccia]', 'command = "/old/Traccia"', 'args = ["x"]', '', '[mcp_servers.traccia.env]', 'FOO = "1"', '', '[mcp_servers.other]', 'command = "php"', ''].join('\n')
    const after = mergeTomlConfig(before, 'traccia', spec)
    expect(after).toBe('model = "o3"\n\n[mcp_servers.other]\ncommand = "php"\n\n' + block)
    expect(after.match(/\[mcp_servers\.traccia\]/g)).toHaveLength(1)
  })

  it('reports whether the table points to this app', () => {
    expect(tomlConfigured('', 'traccia', spec)).toBe('no')
    expect(tomlConfigured(mergeTomlConfig('', 'traccia', spec), 'traccia', spec)).toBe('yes')
    expect(tomlConfigured(mergeTomlConfig('', 'traccia', moved), 'traccia', spec)).toBe('stale')
  })
})
