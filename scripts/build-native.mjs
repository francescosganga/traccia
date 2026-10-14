import { mkdirSync } from 'node:fs'
import { spawnSync } from 'node:child_process'

if (process.platform === 'darwin') {
  mkdirSync('out/native', { recursive: true })
  const result = spawnSync('xcrun', ['swiftc', '-O', '-target', `${process.arch === 'arm64' ? 'arm64' : 'x86_64'}-apple-macos12.0`, '-module-cache-path', 'out/native/module-cache', 'native/text-insertion.swift', '-o', 'out/native/text-insertion'], { stdio: 'inherit' })
  process.exit(result.status ?? 1)
}
