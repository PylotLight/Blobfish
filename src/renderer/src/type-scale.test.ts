import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// Keeps the type scale from drifting back to one-off pixel sizes.
const sheets = ['index.css', 'views/CommandPalette.css'].map((f) => [f, readFileSync(join(import.meta.dir, f), 'utf8')] as const)

describe('type scale', () => {
  test('every font-size uses a --fs-* token (or a relative size)', () => {
    for (const [file, css] of sheets) {
      const raw = [...css.matchAll(/font-size:\s*([^;]+);/g)].map((m) => (m[1] ?? '').trim())
      const stray = raw.filter((v) => !/^var\(--fs-[a-z0-9]+\)( !important)?$/.test(v) && !/em$/.test(v) && v !== 'inherit')
      expect({ file, stray }).toEqual({ file, stray: [] })
    }
  })

  test('scale is small and never below 11px', () => {
    const css = sheets[0]?.[1] ?? ''
    const steps = [...css.matchAll(/--fs-[a-z0-9]+:\s*(\d+(?:\.\d+)?)px/g)].map((m) => Number(m[1]))
    expect(steps.length).toBeGreaterThan(0)
    expect(steps.length).toBeLessThanOrEqual(8)
    expect(Math.min(...steps)).toBeGreaterThanOrEqual(11)
  })
})
