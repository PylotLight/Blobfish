import { describe, expect, test } from 'bun:test'
import { barChips } from './transfers-bar'

describe('barChips', () => {
  test('a finished download counts as done even though its row is gone', () => {
    expect(barChips([{ kind: 'transfer', status: 'success' }], 0)).toEqual({ done: 1, failed: 0 })
  })
  test('ignores non-transfer activity and failed transfers', () => {
    const acts = [
      { kind: 'transfer', status: 'success' },
      { kind: 'transfer', status: 'failed' },
      { kind: 'blob', status: 'success' },
      { kind: 'container', status: 'success' }
    ] as const
    expect(barChips(acts, 1)).toEqual({ done: 1, failed: 1 })
  })
  test('nothing to show is all zeros (chips hidden)', () => {
    expect(barChips([], 0)).toEqual({ done: 0, failed: 0 })
  })
})
