// Symlinks the unpacked .app produced by `electron-builder --dir` into /Applications.
const { readdirSync, lstatSync, unlinkSync, symlinkSync, existsSync } = require('fs')
const { join, resolve } = require('path')

const outDir = resolve(__dirname, '..', 'dist', process.arch === 'arm64' ? 'mac-arm64' : 'mac')
const app = existsSync(outDir) && readdirSync(outDir).find((f) => f.endsWith('.app'))
if (!app) {
  console.error(`No .app found in ${outDir}. Run \`npm run link\` first.`)
  process.exit(1)
}

const src = join(outDir, app)
const dest = join('/Applications', app)

let existing = null
try { existing = lstatSync(dest) } catch {}
if (existing) {
  if (!existing.isSymbolicLink()) {
    console.error(`${dest} exists and is not a symlink. Remove it manually first.`)
    process.exit(1)
  }
  unlinkSync(dest)
}

symlinkSync(src, dest)
console.log(`${dest} -> ${src}`)
