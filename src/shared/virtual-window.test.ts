import { describe, expect, test } from 'bun:test'
import { virtualWindow } from './virtual-window'

describe('virtualWindow', () => {
  test('top of the list mounts the viewport plus trailing overscan', () => {
    expect(virtualWindow(5000, 0, 460, 46, 12)).toEqual({ start: 0, end: 22 })
  })
  test('mid-list window is centred on the scroll offset', () => {
    // 2000 rows down: first visible row is 2000.
    expect(virtualWindow(5000, 2000 * 46, 460, 46, 12)).toEqual({ start: 1988, end: 2022 })
  })
  test('clamps at the end of the list', () => {
    expect(virtualWindow(100, 100 * 46, 460, 46, 12)).toEqual({ start: 88, end: 100 })
  })
  test('empty and degenerate inputs', () => {
    expect(virtualWindow(0, 0, 460, 46, 12)).toEqual({ start: 0, end: 0 })
    expect(virtualWindow(10, -50, 0, 46, 2)).toEqual({ start: 0, end: 2 })
    expect(virtualWindow(10, 0, 460, 0, 2)).toEqual({ start: 0, end: 10 })
  })
})
