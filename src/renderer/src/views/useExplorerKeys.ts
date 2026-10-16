import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  applyMove,
  commandFor,
  revealScrollTop,
  typeaheadMatch,
  typeaheadQuery
} from '../../../shared/explorer-nav'
import './explorer-keys.css'

/** Type-ahead resets after this much idle time (Finder-ish). */
const TYPEAHEAD_MS = 800

export interface ExplorerKeysOptions {
  /** Row keys in visible order (filtered + sorted). */
  keys: readonly string[]
  /** Display names in the same order, for type-ahead. */
  labels: readonly string[]
  selection: ReadonlySet<string>
  setSelection: (next: Set<string>) => void
  /** Shift-range anchor, shared with mouse selection so ⇧-click and ⇧-arrow agree. */
  anchorRef: React.MutableRefObject<string | null>
  /** The scrolling element that holds the table. */
  scrollRef: React.RefObject<HTMLElement | null>
  /** Measured row height (virtualized rows are fixed-height). */
  rowHeight: number
  /** True while a dialog (confirm / rename / move…) owns focus. */
  modalOpen: boolean
  onOpen: (index: number) => void
  onUp: () => void
  onQuickLook: (index: number) => void
  onDelete: () => void
}

export interface ExplorerKeys {
  /** Index of the keyboard-active row, -1 when none. */
  activeIndex: number
  /** Spread onto the <table>: one tab stop, active row via aria-activedescendant. */
  gridProps: {
    ref: (el: HTMLTableElement | null) => void
    role: 'grid'
    tabIndex: 0
    'aria-multiselectable': true
    'aria-label': string
    'aria-rowcount': number
    'aria-activedescendant'?: string
    'data-kb'?: ''
    onKeyDown: (e: React.KeyboardEvent<HTMLTableElement>) => void
    onMouseDown: (e: React.MouseEvent<HTMLTableElement>) => void
    onFocus: () => void
    onBlur: (e: React.FocusEvent<HTMLTableElement>) => void
  }
  /** DOM id for the row at `index` (target of aria-activedescendant). */
  rowId: (index: number) => string
  /** Put focus back on the list (e.g. after closing Quick Look). */
  focus: () => void
}

const bodyHasFocus = (): boolean => {
  const a = document.activeElement
  return a === null || a === document.body
}

/**
 * Finder-style keyboard navigation for the Explorer blob list. Focus stays on
 * the table (one tab stop); the active row is announced with
 * aria-activedescendant so it works with the virtualized window, where most
 * rows are not mounted. Keys are only handled when the table itself is the
 * event target, so the filter box, rename fields, header buttons, row
 * checkboxes and the ⌘K palette (capture phase, app-level) never lose keys.
 */
export function useExplorerKeys(opts: ExplorerKeysOptions): ExplorerKeys {
  const { keys } = opts
  const optsRef = useRef(opts)
  optsRef.current = opts

  const [activeKey, setActiveKey] = useState<string | null>(null)
  // Keyboard mode: the active-row ring only shows after keyboard use.
  const [kb, setKb] = useState(false)
  const gridEl = useRef<HTMLTableElement | null>(null)
  const revealPending = useRef(false)
  const revealFrame = useRef(0)
  const typeBuf = useRef({ text: '', at: 0 })
  // The list owned focus last (survives the table unmounting while a folder
  // loads, and dialogs that grab focus), so it can take it back.
  const ownsFocus = useRef(false)
  // Delete pressed with nothing selected: select the active row first, then
  // run the delete once that selection has rendered (onDelete reads it).
  const pendingDelete = useRef(false)

  const activeIndex = useMemo(() => (activeKey === null ? -1 : keys.indexOf(activeKey)), [keys, activeKey])
  const activeIndexRef = useRef(activeIndex)
  activeIndexRef.current = activeIndex

  const idBase = useMemo(() => `bf-row-${Math.random().toString(36).slice(2, 8)}`, [])
  const rowId = useCallback((index: number) => `${idBase}-${index}`, [idBase])

  const focus = useCallback(() => {
    gridEl.current?.focus({ preventScroll: true })
  }, [])

  const gridRef = useCallback((el: HTMLTableElement | null) => {
    gridEl.current = el
    // A fresh listing (after Enter / Backspace) re-mounts the table: keep focus on it.
    if (el && ownsFocus.current && bodyHasFocus()) el.focus({ preventScroll: true })
  }, [])

  // A dialog closed (delete confirm cancelled, rename done) → focus back to the list.
  const prevModal = useRef(opts.modalOpen)
  useEffect(() => {
    if (prevModal.current && !opts.modalOpen && ownsFocus.current && bodyHasFocus()) focus()
    prevModal.current = opts.modalOpen
  }, [opts.modalOpen, focus])

  // An empty folder has no table to focus: still let ⌘↑ / Backspace go back up
  // while nothing else has focus and the list was the last thing focused.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.defaultPrevented || gridEl.current || !ownsFocus.current || !bodyHasFocus()) return
      if (document.querySelector('.modal-backdrop')) return
      const cmd = commandFor({ key: e.key, shift: e.shiftKey, mod: e.metaKey || e.ctrlKey, alt: e.altKey })
      if (cmd?.type !== 'up') return
      e.preventDefault()
      optsRef.current.onUp()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  /**
   * Scroll row `index` into view. A row outside the virtual window isn't
   * mounted, so its position is extrapolated from a mounted row; once the
   * window has re-rendered around it, a second pass corrects to the real row.
   */
  const reveal = useCallback((index: number, retries: number): void => {
    const scroller = optsRef.current.scrollRef.current
    const grid = gridEl.current
    if (!scroller || !grid || index < 0) return
    const sRect = scroller.getBoundingClientRect()
    let rowTop: number
    let rowH = optsRef.current.rowHeight
    const el = grid.querySelector<HTMLElement>(`tr[data-index="${index}"]`)
    if (el) {
      const r = el.getBoundingClientRect()
      rowTop = r.top - sRect.top + scroller.scrollTop
      rowH = r.height
    } else {
      const any = grid.querySelector<HTMLElement>('tr[data-index]')
      if (!any) return
      const at = Number(any.dataset.index)
      rowTop = any.getBoundingClientRect().top - sRect.top + scroller.scrollTop + (index - at) * rowH
    }
    const th = grid.querySelector<HTMLElement>('thead th')
    const sticky = th && getComputedStyle(th).position === 'sticky' ? th.getBoundingClientRect().height : 0
    const next = revealScrollTop(scroller.scrollTop, scroller.clientHeight, rowTop, rowH, sticky)
    if (Math.abs(next - scroller.scrollTop) >= 1) scroller.scrollTop = next
    if ((!el || next !== scroller.scrollTop) && retries > 0) {
      cancelAnimationFrame(revealFrame.current)
      // Two frames: scroll event → window re-measure (rAF) → React commit.
      revealFrame.current = requestAnimationFrame(() => {
        revealFrame.current = requestAnimationFrame(() => {
          if (activeIndexRef.current === index) reveal(index, retries - 1)
        })
      })
    }
  }, [])

  useEffect(() => () => cancelAnimationFrame(revealFrame.current), [])

  // Scroll the active row into view after a keyboard move.
  useLayoutEffect(() => {
    if (!revealPending.current) return
    revealPending.current = false
    reveal(activeIndex, 3)
  }, [activeIndex, reveal])

  const onKeyDown = useCallback((e: React.KeyboardEvent<HTMLTableElement>) => {
    // Only when the list itself has focus: never steal from inputs, header
    // buttons or row checkboxes inside the table.
    if (e.target !== e.currentTarget || e.nativeEvent.isComposing) return
    const o = optsRef.current
    const now = performance.now()
    if (now - typeBuf.current.at > TYPEAHEAD_MS) typeBuf.current.text = ''
    const cmd = commandFor(
      { key: e.key, shift: e.shiftKey, mod: e.metaKey || e.ctrlKey, alt: e.altKey },
      typeBuf.current.text !== ''
    )
    if (!cmd) return
    e.preventDefault()
    setKb(true)
    const count = o.keys.length
    const active = activeIndexRef.current
    const select = (lo: number, hi: number): void => {
      o.setSelection(new Set(o.keys.slice(lo, hi + 1)))
    }
    const setActive = (i: number): void => {
      if (i === active) {
        reveal(i, 3)
        return
      }
      revealPending.current = true
      setActiveKey(o.keys[i] ?? null)
    }
    if (cmd.type !== 'typeahead') typeBuf.current.text = ''

    switch (cmd.type) {
      case 'move': {
        const anchorIdx = o.anchorRef.current === null ? -1 : o.keys.indexOf(o.anchorRef.current)
        const scroller = o.scrollRef.current
        const page = scroller ? Math.floor(scroller.clientHeight / Math.max(1, o.rowHeight)) - 1 : 10
        const res = applyMove(count, active, anchorIdx, cmd.to, cmd.extend, page, o.selection.size > 0)
        if (!res) return
        o.anchorRef.current = o.keys[res.anchor] ?? null
        select(res.range[0], res.range[1])
        setActive(res.active)
        return
      }
      case 'selectAll':
        o.setSelection(new Set(o.keys))
        return
      case 'open':
        if (active >= 0) o.onOpen(active)
        return
      case 'up':
        o.onUp()
        return
      case 'quickLook':
        if (active >= 0) o.onQuickLook(active)
        return
      case 'delete':
        if (o.selection.size > 0) {
          o.onDelete()
        } else if (active >= 0) {
          // Nothing selected yet: act on the active row (the confirm still asks).
          o.anchorRef.current = o.keys[active] ?? null
          pendingDelete.current = true
          select(active, active)
        }
        return
      case 'typeahead': {
        typeBuf.current = { text: typeBuf.current.text + cmd.char, at: now }
        const { query, from } = typeaheadQuery(typeBuf.current.text, active)
        const hit = typeaheadMatch(o.labels, query, from)
        if (hit < 0) return
        o.anchorRef.current = o.keys[hit] ?? null
        select(hit, hit)
        setActive(hit)
        return
      }
    }
  }, [reveal])

  useEffect(() => {
    if (!pendingDelete.current) return
    pendingDelete.current = false
    if (optsRef.current.selection.size > 0) optsRef.current.onDelete()
  }, [opts.selection])

  const onMouseDown = useCallback((e: React.MouseEvent<HTMLTableElement>) => {
    setKb(false)
    typeBuf.current.text = ''
    const tr = (e.target as HTMLElement).closest<HTMLElement>('tr[data-index]')
    if (tr) setActiveKey(optsRef.current.keys[Number(tr.dataset.index)] ?? null)
  }, [])

  const onFocus = useCallback(() => {
    ownsFocus.current = true
    // Tabbing in: start on the first selected row, else the top row.
    if (activeIndexRef.current >= 0) return
    const o = optsRef.current
    const firstSel = o.keys.findIndex((key) => o.selection.has(key))
    const start = firstSel >= 0 ? firstSel : o.keys.length > 0 ? 0 : -1
    if (start >= 0) setActiveKey(o.keys[start]!)
  }, [])

  const onBlur = useCallback((e: React.FocusEvent<HTMLTableElement>) => {
    const to = e.relatedTarget as HTMLElement | null
    // Focus going into a dialog or nowhere (unmount) keeps ownership; going
    // to another control (filter box, sidebar…) gives it up.
    if (to && !to.closest('.modal-backdrop') && !e.currentTarget.contains(to)) ownsFocus.current = false
  }, [])

  // Keep the active row valid across reloads / filter changes.
  useEffect(() => {
    if (activeKey !== null && activeIndex === -1) setActiveKey(null)
  }, [activeKey, activeIndex])

  return {
    activeIndex,
    gridProps: {
      ref: gridRef,
      role: 'grid',
      tabIndex: 0,
      'aria-multiselectable': true,
      'aria-label': 'Files',
      'aria-rowcount': keys.length + 1,
      'aria-activedescendant': activeIndex >= 0 ? rowId(activeIndex) : undefined,
      'data-kb': kb ? '' : undefined,
      onKeyDown,
      onMouseDown,
      onFocus,
      onBlur
    },
    rowId,
    focus
  }
}
