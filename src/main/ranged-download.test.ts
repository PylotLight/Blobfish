import { describe, expect, test } from 'bun:test'
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  downloadConnections,
  downloadRangesToFile,
  downloadViaPartFile,
  partPathFor,
  type RangeReader
} from './ranged-download'

const MiB = 1024 * 1024
const dir = mkdtempSync(join(tmpdir(), 'bf-ranged-'))
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

function source(data: Uint8Array, opts: { chunk?: number; delayMs?: number; failOnce?: Set<number>; failAlways?: number } = {}) {
  let conc = 0
  const stats = { maxConc: 0, requests: 0 }
  const read: RangeReader = async (offset, count, signal) => {
    stats.requests += 1
    if (opts.failAlways === offset) throw new Error(`boom at ${offset}`)
    const failHere = opts.failOnce?.delete(offset) ?? false
    return (async function* () {
      conc += 1
      stats.maxConc = Math.max(stats.maxConc, conc)
      try {
        const step = opts.chunk ?? 64 * 1024
        for (let p = offset; p < offset + count; p += step) {
          if (signal.aborted) throw Object.assign(new Error('aborted'), { name: 'AbortError' })
          if (failHere && p >= offset + count / 2) throw new Error('socket hang up')
          if (opts.delayMs) await sleep(opts.delayMs)
          yield data.subarray(p, Math.min(p + step, offset + count))
        }
      } finally {
        conc -= 1
      }
    })()
  }
  return { read, stats }
}

function random(size: number): Uint8Array {
  const b = new Uint8Array(size)
  for (let i = 0; i < size; i += 4096) crypto.getRandomValues(b.subarray(i, Math.min(size, i + 4096)))
  return b
}

describe('downloadRangesToFile', () => {
  test('writes every range to its offset across N connections', async () => {
    const data = random(10 * MiB + 12345)
    const { read, stats } = source(data, { delayMs: 1 })
    const path = join(dir, 'a.bin')
    const progress: number[] = []
    await downloadRangesToFile(path, read, { size: data.length, concurrency: 4, blockSize: MiB, onProgress: (n) => progress.push(n) })
    expect(Buffer.compare(readFileSync(path), Buffer.from(data))).toBe(0)
    expect(stats.maxConc).toBe(4)
    expect(stats.requests).toBe(11)
    expect(progress.at(-1)).toBe(data.length)
    expect(Math.max(...progress)).toBe(data.length)
  })

  test('a dropped block is retried and progress never overshoots', async () => {
    const data = random(4 * MiB)
    const { read, stats } = source(data, { failOnce: new Set([MiB, 3 * MiB]) })
    const path = join(dir, 'b.bin')
    let max = 0
    await downloadRangesToFile(path, read, { size: data.length, concurrency: 2, blockSize: MiB, onProgress: (n) => (max = Math.max(max, n)) })
    expect(Buffer.compare(readFileSync(path), Buffer.from(data))).toBe(0)
    expect(stats.requests).toBe(6)
    expect(max).toBe(data.length)
  })

  test('a block that keeps failing stops the siblings and rejects', async () => {
    const data = random(8 * MiB)
    const { read, stats } = source(data, { failAlways: 2 * MiB, delayMs: 2 })
    await expect(
      downloadRangesToFile(join(dir, 'c.bin'), read, { size: data.length, concurrency: 4, blockSize: MiB })
    ).rejects.toThrow('boom')
    // 4 first blocks + 2 retries of the bad one at most; nothing after the abort.
    expect(stats.requests).toBeLessThanOrEqual(7)
  })

  test('one connection for small files, capped by blocks, and by the setting', () => {
    expect(downloadConnections(10, 8)).toBe(1)
    expect(downloadConnections(8 * MiB, 8)).toBe(1)
    expect(downloadConnections(8 * MiB + 1, 8)).toBe(2)
    expect(downloadConnections(256 * MiB, 8)).toBe(8)
    expect(downloadConnections(256 * MiB, 3)).toBe(3)
    expect(downloadConnections(0, 8)).toBe(1)
  })

  test('zero-byte blobs make an empty file without a request', async () => {
    const { read, stats } = source(new Uint8Array(0))
    const path = join(dir, 'empty.bin')
    await downloadRangesToFile(path, read, { size: 0, concurrency: 8 })
    expect(readFileSync(path).length).toBe(0)
    expect(stats.requests).toBe(0)
  })
})

describe('downloadViaPartFile', () => {
  test('cancel removes the partial and leaves an existing file alone', async () => {
    const data = random(16 * MiB)
    const { read } = source(data, { delayMs: 2 })
    const target = join(dir, 'keep.bin')
    writeFileSync(target, 'previous contents')
    const ac = new AbortController()
    setTimeout(() => ac.abort(), 40)
    const err = await downloadViaPartFile(target, (part) =>
      downloadRangesToFile(part, read, { size: data.length, concurrency: 4, blockSize: MiB, signal: ac.signal })
    ).catch((e: Error) => e)
    expect((err as Error).name).toBe('AbortError')
    expect(existsSync(partPathFor(target))).toBe(false)
    expect(readFileSync(target, 'utf8')).toBe('previous contents')
  })

  test('success renames the part onto the target, replacing a stale part', async () => {
    const data = random(3 * MiB)
    const { read } = source(data)
    const target = join(dir, 'done.bin')
    writeFileSync(partPathFor(target), 'stale part from a crash')
    await downloadViaPartFile(target, (part) =>
      downloadRangesToFile(part, read, { size: data.length, concurrency: 8, blockSize: MiB })
    )
    expect(existsSync(partPathFor(target))).toBe(false)
    expect(Buffer.compare(readFileSync(target), Buffer.from(data))).toBe(0)
  })
})
