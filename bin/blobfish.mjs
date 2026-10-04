#!/usr/bin/env node
// `bunx blobfish` / `npx blobfish` launcher.
//
// This package ships the built Electron main process under `out/` plus this
// shim. The shim resolves the Electron binary from the installed `electron`
// dependency and launches the app — no global install needed.
//
// Primary distribution remains the signed GitHub artifacts + Homebrew cask
// (see README); npm is a convenience path for folks who already live in
// Bun/Node. First run downloads Electron (~100 MB) via the `electron`
// dependency — expected, not a bug.
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const main = join(root, 'out', 'main', 'index.js')

if (!existsSync(main)) {
  console.error(
    "blobfish: built app not found (expected out/main/index.js).\n" +
      'If you installed from source, run `bun install && bun run build` first.\n' +
      'Otherwise grab a signed build from https://github.com/PylotLight/Blobfish/releases'
  )
  process.exit(1)
}

let electronBin
try {
  electronBin = createRequire(import.meta.url)('electron')
} catch {
  console.error('blobfish: the `electron` dependency is missing. Reinstall with `bun install`.')
  process.exit(1)
}

const child = spawn(electronBin, [main, ...process.argv.slice(2)], {
  detached: true,
  stdio: 'inherit'
})
child.on('error', (err) => {
  console.error(`blobfish: failed to launch Electron: ${err.message}`)
  process.exit(1)
})
