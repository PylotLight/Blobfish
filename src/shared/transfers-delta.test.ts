import { describe, expect, test } from 'bun:test'
import { applyTransfersDelta, viewFromSnapshot } from './transfers-delta'
import type { TransferInfo, TransfersDelta, TransfersSummary } from './types'

const base: Omit<TransfersSummary, 'rev'> = {
  active: 0,
  queued: 0,
  finished: 0,
  up: 0,
  down: 0,
  aggregateBps: 0,
  uploadConcurrency: 8,
  maxParallel: 2
}
const row = (id: string, seq: number, extra: Partial<TransferInfo> = {}): TransferInfo => ({
  id,
  seq,
  direction: 'download',
  accountId: 'a',
  accountName: 'acc',
  container: 'c',
  name: `${id}.bin`,
  totalBytes: 100,
  doneBytes: 0,
  status: 'queued',
  concurrency: 1,
  ...extra
})
const delta = (rev: number, upserts: TransferInfo[], removed: string[] = []): TransfersDelta => ({ ...base, rev, upserts, removed })

describe('transfers delta', () => {
  const snap = { ...base, rev: 5, transfers: [row('a', 1), row('b', 2), row('c', 3)] }

  test('orders active, then queued by seq', () => {
    const v = viewFromSnapshot(snap)
    expect(v.order).toEqual(['a', 'b', 'c'])
    const v2 = applyTransfersDelta(v, delta(6, [row('c', 3, { status: 'active', startedAt: 10 })]))!
    expect(v2.order).toEqual(['c', 'a', 'b'])
  })

  test('progress-only updates keep the same order array', () => {
    const v = applyTransfersDelta(viewFromSnapshot(snap), delta(6, [row('b', 2, { status: 'active', startedAt: 1 })]))!
    const v2 = applyTransfersDelta(v, delta(7, [row('b', 2, { status: 'active', startedAt: 1, doneBytes: 50 })]))!
    expect(v2.order).toBe(v.order)
    expect(v2.rows.get('b')?.doneBytes).toBe(50)
    // Untouched rows keep identity, so memoized rows skip re-render.
    expect(v2.rows.get('a')).toBe(v.rows.get('a'))
  })

  test('removals drop rows; stale deltas are ignored; a gap asks for a resync', () => {
    const v = viewFromSnapshot(snap)
    const v2 = applyTransfersDelta(v, delta(6, [], ['a']))!
    expect(v2.order).toEqual(['b', 'c'])
    expect(applyTransfersDelta(v2, delta(6, [row('z', 9)]))).toBe(v2)
    expect(applyTransfersDelta(v2, delta(8, [row('z', 9)]))).toBeNull()
  })
})
