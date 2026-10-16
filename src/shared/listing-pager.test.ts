import { describe, expect, test } from 'bun:test'
import { isPartial, ListingPager, type ListingSnapshot } from './listing-pager'
import type { ListBlobsResult, StorageBlobItem } from './types'

const blob = (i: number): StorageBlobItem => ({ name: `f-${String(i).padStart(6, '0')}`, leaf: `f-${i}`, isPrefix: false })

/** Fake folder of `total` blobs served `per` at a time, token = next offset. */
function folder(total: number, per: number, opts: { failAt?: number; extra?: StorageBlobItem[] } = {}) {
  const calls: Array<string | undefined> = []
  const fetch = async (token: string | undefined): Promise<ListBlobsResult> => {
    calls.push(token)
    const start = token ? Number(token) : 0
    if (opts.failAt !== undefined && start === opts.failAt) throw new Error('boom 503')
    const items = Array.from({ length: Math.min(per, total - start) }, (_, k) => blob(start + k))
    if (start === 0 && opts.extra) items.push(...opts.extra)
    const next = start + per < total ? String(start + per) : undefined
    return { container: 'c', prefix: '', items, continuationToken: next }
  }
  return { fetch, calls }
}

function run(total: number, per: number, cap?: number, opts?: { failAt?: number; extra?: StorageBlobItem[] }) {
  const f = folder(total, per, opts)
  const snaps: ListingSnapshot[] = []
  const errors: unknown[] = []
  const pager = new ListingPager(f.fetch, { cap, onChange: (s) => snaps.push(s), onFirstError: (e) => errors.push(e) })
  return { pager, snaps, errors, calls: f.calls, last: () => snaps[snaps.length - 1]! }
}

describe('ListingPager', () => {
  test('pages through every continuation token (50k folder, 5k pages)', async () => {
    const r = run(50_000, 5000)
    await r.pager.start()
    expect(r.calls.length).toBe(10)
    expect(r.calls[0]).toBeUndefined()
    expect(r.calls[1]).toBe('5000')
    expect(r.last().items.length).toBe(50_000)
    expect(r.last().phase).toBe('done')
    // streams: one snapshot per page, growing
    expect(r.snaps.map((s) => s.items.length)).toEqual([5000, 10000, 15000, 20000, 25000, 30000, 35000, 40000, 45000, 50000])
    expect(r.snaps.slice(0, -1).every((s) => s.phase === 'more')).toBe(true)
  })

  test('single page folder is done straight away', async () => {
    const r = run(40, 5000)
    await r.pager.start()
    expect(r.snaps.length).toBe(1)
    expect(r.last().phase).toBe('done')
    expect(isPartial(r.last().phase)).toBe(false)
  })

  test('pauses at the auto cap, load more fetches another cap', async () => {
    const r = run(50_000, 5000, 20_000)
    await r.pager.start()
    expect(r.last().items.length).toBe(20_000)
    expect(r.last().phase).toBe('cap')
    expect(isPartial('cap')).toBe(true)
    await r.pager.loadMore()
    expect(r.last().items.length).toBe(40_000)
    expect(r.last().phase).toBe('cap')
    await r.pager.loadMore()
    expect(r.last().items.length).toBe(50_000)
    expect(r.last().phase).toBe('done')
    expect(r.calls.length).toBe(10)
  })

  test('stop keeps the page in flight, then pauses; load more resumes', async () => {
    const r = run(50_000, 5000)
    const p = r.pager.start()
    await Promise.resolve()
    r.pager.stop() // first page in flight → not stoppable yet (phase first)
    await new Promise((res) => setTimeout(res, 0))
    r.pager.stop()
    await p
    expect(r.last().phase).toBe('stopped')
    const n = r.last().items.length
    expect(n).toBeLessThan(50_000)
    expect(n % 5000).toBe(0)
    await r.pager.loadMore()
    expect(r.last().phase).toBe('done')
    expect(r.last().items.length).toBe(50_000)
  })

  test('dispose drops in-flight pages and stops callbacks', async () => {
    const r = run(50_000, 5000)
    const p = r.pager.start()
    r.pager.dispose()
    await p
    expect(r.snaps.length).toBe(0)
    expect(r.calls.length).toBe(1)
  })

  test('first page failure goes to onFirstError, nothing listed', async () => {
    const r = run(50_000, 5000, undefined, { failAt: 0 })
    await r.pager.start()
    expect(r.errors.length).toBe(1)
    expect(r.snaps.length).toBe(0)
  })

  test('later page failure keeps rows and offers retry', async () => {
    const r = run(50_000, 5000, undefined, { failAt: 15_000 })
    await r.pager.start()
    expect(r.last().phase).toBe('error')
    expect(r.last().error).toContain('boom')
    expect(r.last().items.length).toBe(15_000)
    expect(r.errors.length).toBe(0)
  })

  test('duplicate folder rows across pages are dropped', async () => {
    const dupe: StorageBlobItem = { name: 'f-000000', leaf: 'f-0', isPrefix: false }
    const folderRow: StorageBlobItem = { name: 'f-000000', leaf: 'f-0', isPrefix: true }
    const r = run(10, 5, undefined, { extra: [dupe, folderRow] })
    await r.pager.start()
    // the blob dupe is dropped; a folder with the same name is a different row
    expect(r.last().items.length).toBe(11)
  })
})
