// Bundles the CLI and its dependencies into one executable script. Native modules stay
// external: sharp is a dependency, ffmpeg-static is only looked up when it happens to be
// installed next to the CLI (the monorepo).
import { build } from 'esbuild'
import { chmod, readFile } from 'fs/promises'

// The CLI is versioned with the app: the root package.json is bumped by `npm version`, and
// the publish workflow copies that number into packages/cli/package.json before `npm publish`.
const pkg = JSON.parse(await readFile(new URL('../../package.json', import.meta.url), 'utf8'))

await build({
  entryPoints: ['src/main.ts'],
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  outfile: 'dist/traccia.cjs',
  external: ['sharp', 'ffmpeg-static'],
  banner: { js: '#!/usr/bin/env node' },
  define: { __CLI_VERSION__: JSON.stringify(pkg.version) },
  logLevel: 'info'
})
await chmod('dist/traccia.cjs', 0o755)
