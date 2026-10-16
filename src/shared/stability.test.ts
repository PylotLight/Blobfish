import { describe, expect, test } from 'bun:test'
import {
  RecoveryBudget,
  LogThrottle,
  STABILITY_RECENT_LIMIT,
  countStabilityEvent,
  createShutdown,
  quitWarning,
  emptyStabilityCounters,
  errorSignature,
  stabilityFailureTotal
} from './stability'

describe('stability counters', () => {
  test('count, keep a bounded recent list, and total only failures', () => {
    const c = emptyStabilityCounters()
    for (let i = 0; i < STABILITY_RECENT_LIMIT + 5; i++) countStabilityEvent(c, 'rendererGone', `crash ${i}`, 0)
    countStabilityEvent(c, 'rendererReloads', null)
    countStabilityEvent(c, 'unresponsive', 'hung')
    expect(c.rendererGone).toBe(STABILITY_RECENT_LIMIT + 5)
    expect(c.recent.length).toBe(STABILITY_RECENT_LIMIT)
    expect(c.recent.at(-1)).toContain('unresponsive: hung')
    expect(stabilityFailureTotal(c)).toBe(STABILITY_RECENT_LIMIT + 5)
  })
})

describe('LogThrottle', () => {
  test('logs the head, then every Nth', () => {
    const t = new LogThrottle(2, 10)
    const logged = Array.from({ length: 25 }, () => t.shouldLog('x')).filter(Boolean)
    expect(logged).toEqual([1, 2, 10, 20])
  })
  test('forgets the oldest signature past the cap', () => {
    const t = new LogThrottle(1, 100, 2)
    t.shouldLog('a')
    t.shouldLog('b')
    t.shouldLog('c')
    expect(t.shouldLog('a')).toBe(1)
  })
})

describe('RecoveryBudget', () => {
  test('allows limit attempts per window', () => {
    const b = new RecoveryBudget(3, 1000)
    expect([b.tryTake(0), b.tryTake(1), b.tryTake(2), b.tryTake(3)]).toEqual([true, true, true, false])
    expect(b.tryTake(1001)).toBe(true)
  })
})

describe('errorSignature', () => {
  test('first line of an error or value', () => {
    expect(errorSignature(new TypeError('bad\nstack'))).toBe('TypeError: bad')
    expect(errorSignature('plain\nmore')).toBe('plain')
  })
})

describe('createShutdown', () => {
  test('runs steps in order (awaiting async ones), survives a throwing step, runs once', async () => {
    const order: string[] = []
    const logs: string[] = []
    const shutdown = createShutdown(
      [
        {
          name: 'transfers',
          run: async () => {
            await new Promise((r) => setTimeout(r, 10))
            order.push('transfers')
          }
        },
        { name: 'broken', run: () => { throw new Error('boom') } },
        { name: 'rejects', run: () => Promise.reject(new Error('nope')) },
        { name: 'activity', run: () => void order.push('activity') },
        { name: 'tray', run: () => void order.push('tray') }
      ],
      (m) => logs.push(m)
    )
    const results = await shutdown()
    expect(order).toEqual(['transfers', 'activity', 'tray'])
    expect(results.map((r) => r.ok)).toEqual([true, false, false, true, true])
    expect(logs[0]).toContain('broken failed: Error: boom')
    expect(logs[1]).toContain('rejects failed: Error: nope')
    expect(await shutdown()).toEqual([])
    expect(order).toEqual(['transfers', 'activity', 'tray'])
  })

  test('a step that hangs times out and the next one still runs', async () => {
    const order: string[] = []
    const shutdown = createShutdown(
      [
        { name: 'stuck', run: () => new Promise<void>(() => {}) },
        { name: 'after', run: () => void order.push('after') }
      ],
      () => {},
      20
    )
    const results = await shutdown()
    expect(results[0]).toEqual({ name: 'stuck', ok: false, error: 'Error: timed out after 20 ms' })
    expect(order).toEqual(['after'])
  })
})

describe('quitWarning', () => {
  test('nothing in flight → no prompt', () => {
    expect(quitWarning(0, 0)).toBeNull()
  })
  test('counts running and queued', () => {
    expect(quitWarning(1, 0)?.message).toBe('1 transfer is still in progress (1 running).')
    expect(quitWarning(2, 3)?.message).toBe('5 transfers are still in progress (2 running, 3 queued).')
    expect(quitWarning(0, 1)?.detail).toContain('Partial downloads are removed')
  })
})
