#!/usr/bin/env bun
// Fails ci on CSS blur regressions (same bug Surffish fixed in #106):
//  1. no `-webkit-backdrop-filter` in renderer source css: Electron 45 ignores it, and
//     lightningcss (cssMinify) collapses a prefixed+unprefixed pair down to the prefixed one.
//  2. if a build exists, the minified css must still carry the unprefixed property.
// usage: bun scripts/ci/check-css.ts   (run after `bun run build` to also check out/)
import { Glob } from 'bun'

const PREFIXED = /-webkit-backdrop-filter\s*:/g
const UNPREFIXED = /(?<![-\w])backdrop-filter\s*:\s*(?!none)/g
const problems: string[] = []

async function scan(pattern: string, cwd: string): Promise<{ file: string; text: string }[]> {
  const out: { file: string; text: string }[] = []
  for await (const file of new Glob(pattern).scan({ cwd, onlyFiles: true })) {
    out.push({ file: `${cwd}/${file}`, text: await Bun.file(`${cwd}/${file}`).text() })
  }
  return out
}

const sources = await scan('**/*.css', 'src/renderer')
for (const { file, text } of sources) {
  text.split('\n').forEach((line, i) => {
    if (PREFIXED.test(line)) problems.push(`${file}:${i + 1}: -webkit-backdrop-filter (use the unprefixed property)`)
    PREFIXED.lastIndex = 0
  })
}
const srcBlurs = sources.reduce((n, s) => n + (s.text.match(UNPREFIXED)?.length ?? 0), 0)

const built = (await Bun.file('out/renderer/index.html').exists()) ? await scan('**/*.css', 'out/renderer') : []
if (built.length) {
  const text = built.map((b) => b.text).join('\n')
  const pre = text.match(PREFIXED)?.length ?? 0
  const un = text.match(UNPREFIXED)?.length ?? 0
  if (pre > 0 && un < pre) problems.push(`out/renderer css: ${pre} -webkit-backdrop-filter vs ${un} unprefixed (minifier dropped the standard one)`)
  if (srcBlurs > 0 && un === 0) problems.push('out/renderer css: source has backdrop-filter but the build has none')
}

if (problems.length) {
  console.error(`css check failed:\n  ${problems.join('\n  ')}`)
  process.exit(1)
}
console.log(`css check ok: ${sources.length} source file(s), ${srcBlurs} blur rule(s)${built.length ? ', build verified' : ''}`)
