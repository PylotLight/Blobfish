import { describe, expect, test } from 'bun:test'
import {
  applyMove,
  commandFor,
  revealScrollTop,
  typeaheadMatch,
  typeaheadQuery,
  type NavKey
} from './explorer-nav'

const k = (key: string, mods: Partial<Omit<NavKey, 'key'>> = {}): NavKey => ({
  key,
  shift: false,
  mod: false,
  alt: false,
  ...mods
})

describe('commandFor', () => {
  test('arrows move, shift extends', () => {
    expect(commandFor(k('ArrowDown'))).toEqual({ type: 'move', to: 'next', extend: false })
    expect(commandFor(k('ArrowUp', { shift: true }))).toEqual({ type: 'move', to: 'prev', extend: true })
    expect(commandFor(k('End', { shift: true }))).toEqual({ type: 'move', to: 'last', extend: true })
    expect(commandFor(k('PageDown'))).toEqual({ type: 'move', to: 'pageDown', extend: false })
  })
  test('⌘↑ / Backspace go up, ⌘↓ / Enter open', () => {
    expect(commandFor(k('ArrowUp', { mod: true }))).toEqual({ type: 'up' })
    expect(commandFor(k('Backspace'))).toEqual({ type: 'up' })
    expect(commandFor(k('ArrowDown', { mod: true }))).toEqual({ type: 'open' })
    expect(commandFor(k('Enter'))).toEqual({ type: 'open' })
  })
  test('Delete and ⌘⌫ delete', () => {
    expect(commandFor(k('Delete'))).toEqual({ type: 'delete' })
    expect(commandFor(k('Backspace', { mod: true }))).toEqual({ type: 'delete' })
  })
  test('⌘A selects all, Space quick looks unless mid type-ahead', () => {
    expect(commandFor(k('a', { mod: true }))).toEqual({ type: 'selectAll' })
    expect(commandFor(k('A', { mod: true }))).toEqual({ type: 'selectAll' })
    expect(commandFor(k(' '))).toEqual({ type: 'quickLook' })
    expect(commandFor(k(' '), true)).toEqual({ type: 'typeahead', char: ' ' })
  })
  test('printable chars type ahead', () => {
    expect(commandFor(k('r'))).toEqual({ type: 'typeahead', char: 'r' })
    expect(commandFor(k('R', { shift: true }))).toEqual({ type: 'typeahead', char: 'R' })
    expect(commandFor(k('é'))).toEqual({ type: 'typeahead', char: 'é' })
  })
  test('leaves app shortcuts and other keys alone', () => {
    for (const ch of ['k', 'f', 'b', 'c', 'v']) expect(commandFor(k(ch, { mod: true }))).toBeNull()
    expect(commandFor(k('Tab'))).toBeNull()
    expect(commandFor(k('Escape'))).toBeNull()
    expect(commandFor(k('F2'))).toBeNull()
    expect(commandFor(k('Shift', { shift: true }))).toBeNull()
    expect(commandFor(k('ArrowDown', { alt: true }))).toBeNull()
    expect(commandFor(k('a', { mod: true, shift: true }))).toBeNull()
  })
})

describe('applyMove', () => {
  test('plain moves clamp and re-anchor', () => {
    expect(applyMove(5, 2, 2, 'next', false)).toEqual({ active: 3, anchor: 3, range: [3, 3] })
    expect(applyMove(5, 4, 4, 'next', false)).toEqual({ active: 4, anchor: 4, range: [4, 4] })
    expect(applyMove(5, 0, 0, 'prev', false)).toEqual({ active: 0, anchor: 0, range: [0, 0] })
  })
  test('no active row: down picks the first, up the last', () => {
    expect(applyMove(5, -1, -1, 'next', false)?.active).toBe(0)
    expect(applyMove(5, -1, -1, 'prev', false)?.active).toBe(4)
    expect(applyMove(5, 9, -1, 'next', false)?.active).toBe(0) // stale index
  })
  test('tabbed in with nothing selected: first arrow selects the active row', () => {
    expect(applyMove(5, 0, -1, 'next', false, 10, false)).toEqual({ active: 0, anchor: 0, range: [0, 0] })
    expect(applyMove(5, 2, -1, 'prev', false, 10, false)).toEqual({ active: 2, anchor: 2, range: [2, 2] })
    expect(applyMove(5, 2, -1, 'last', false, 10, false)?.active).toBe(4)
  })
  test('shift extends from the anchor in both directions', () => {
    expect(applyMove(10, 3, 3, 'next', true)).toEqual({ active: 4, anchor: 3, range: [3, 4] })
    expect(applyMove(10, 4, 3, 'next', true)).toEqual({ active: 5, anchor: 3, range: [3, 5] })
    expect(applyMove(10, 3, 3, 'prev', true)).toEqual({ active: 2, anchor: 3, range: [2, 3] })
    expect(applyMove(10, 4, 3, 'first', true)).toEqual({ active: 0, anchor: 3, range: [0, 3] })
  })
  test('shift without an anchor anchors on the current row', () => {
    expect(applyMove(10, 5, -1, 'next', true)).toEqual({ active: 6, anchor: 5, range: [5, 6] })
  })
  test('page moves use the page size', () => {
    expect(applyMove(100, 10, 10, 'pageDown', false, 20)?.active).toBe(30)
    expect(applyMove(100, 90, 90, 'pageDown', false, 20)?.active).toBe(99)
    expect(applyMove(100, 10, 10, 'pageUp', false, 20)?.active).toBe(0)
    expect(applyMove(100, -1, -1, 'pageDown', false, 20)?.active).toBe(19)
  })
  test('empty list', () => {
    expect(applyMove(0, -1, -1, 'next', false)).toBeNull()
  })
})

describe('type-ahead', () => {
  const labels = ['assets', 'backup', 'Banana.csv', 'bar.txt', 'logs', 'readme.md']
  test('case-insensitive prefix match from a start index, wrapping', () => {
    expect(typeaheadMatch(labels, 'ba', 0)).toBe(1)
    expect(typeaheadMatch(labels, 'BAN', 0)).toBe(2)
    expect(typeaheadMatch(labels, 'a', 4)).toBe(0) // wraps
    expect(typeaheadMatch(labels, 'zzz', 0)).toBe(-1)
    expect(typeaheadMatch([], 'a', 0)).toBe(-1)
  })
  test('query building: single + repeated chars cycle, words refine from active', () => {
    expect(typeaheadQuery('b', 1)).toEqual({ query: 'b', from: 2 })
    expect(typeaheadQuery('bbb', 2)).toEqual({ query: 'b', from: 3 })
    expect(typeaheadQuery('bar', 1)).toEqual({ query: 'bar', from: 1 })
    expect(typeaheadQuery('re', -1)).toEqual({ query: 're', from: 0 })
  })
  test('pressing b repeatedly cycles through b-rows', () => {
    let active = -1
    let buf = ''
    const seen: number[] = []
    for (let i = 0; i < 4; i++) {
      buf += 'b'
      const { query, from } = typeaheadQuery(buf, active)
      active = typeaheadMatch(labels, query, from)
      seen.push(active)
    }
    expect(seen).toEqual([1, 2, 3, 1])
  })
  test('typing a word lands on the full match', () => {
    let active = -1
    let buf = ''
    for (const ch of 'bar') {
      buf += ch
      const { query, from } = typeaheadQuery(buf, active)
      const hit = typeaheadMatch(labels, query, from)
      if (hit >= 0) active = hit
    }
    expect(labels[active]).toBe('bar.txt')
  })
})

describe('revealScrollTop', () => {
  test('already visible: no scroll', () => {
    expect(revealScrollTop(100, 400, 200, 46)).toBe(100)
  })
  test('below the viewport: align bottom', () => {
    expect(revealScrollTop(0, 400, 460, 46)).toBe(106)
  })
  test('above the viewport: align top, under a sticky header', () => {
    expect(revealScrollTop(500, 400, 300, 46)).toBe(300)
    expect(revealScrollTop(500, 400, 300, 46, 40)).toBe(260)
    expect(revealScrollTop(500, 400, 520, 46, 40)).toBe(480) // hidden behind the header
  })
  test('virtualized far jump (row not mounted yet)', () => {
    expect(revealScrollTop(0, 800, 120 + 4999 * 46, 46)).toBe(120 + 5000 * 46 - 800)
  })
})
