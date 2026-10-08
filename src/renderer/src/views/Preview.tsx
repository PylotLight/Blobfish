import { useEffect, useMemo, useState } from 'react'
import { formatBytes } from '../../../shared/format'
import {
  PREVIEW_CLIENT_CAP,
  PREVIEW_DEFAULT_BYTES,
  PREVIEW_DEFAULT_LINES,
  PREVIEW_RENDER_LINES,
  detectDelimiter,
  displayableCsvRows,
  extOf,
  parseCsv
} from '../../../shared/preview'
import type { PreviewFlavor, PreviewResult } from '../../../shared/types'
import { stripIpcWrapper } from './errors'

/**
 * Range-based file preview. Each page is one HTTP range GET (default 256 KiB /
 * 300 lines) — a 2 GiB CSV costs a few hundred KiB to glance at, and paging
 * deeper only fetches the next chunk. The full blob is never downloaded.
 */
export default function PreviewDialog(props: {
  accountId: string
  container: string
  name: string
  size?: number
  onClose: () => void
  onDownload: () => void
  /** Inline mode renders the panel without the modal backdrop (for tabbed previews). */
  inline?: boolean
}): React.JSX.Element {
  const { accountId, container, name } = props
  const [text, setText] = useState('')
  const [size, setSize] = useState(props.size ?? 0)
  const [flavor, setFlavor] = useState<PreviewFlavor>('text')
  const [binary, setBinary] = useState(false)
  const [guessed, setGuessed] = useState(false)
  const [contentType, setContentType] = useState<string | undefined>(undefined)
  const [nextOffset, setNextOffset] = useState<number | null>(null)
  const [eof, setEof] = useState(false)
  const [capped, setCapped] = useState(false)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [view, setView] = useState<'table' | 'raw'>('table')
  const [pretty, setPretty] = useState(true)
  const [sortCol, setSortCol] = useState<number | null>(null)
  const [sortDir, setSortDir] = useState<1 | -1>(1)
  const [colFilters, setColFilters] = useState<string[]>([])
  /** Manual column widths (px) — undefined entries fall back to auto-size. */
  const [colWidths, setColWidths] = useState<Array<number | undefined>>([])
  /** Which column's options popover is open (filter icon). */
  const [openCol, setOpenCol] = useState<number | null>(null)

  // Fresh file → fresh filters/sort/widths.
  useEffect(() => {
    setSortCol(null)
    setSortDir(1)
    setColFilters([])
    setColWidths([])
    setOpenCol(null)
  }, [accountId, container, name])

  // Outside-click / Escape dismisses the column options popover.
  useEffect(() => {
    if (openCol === null) return
    const onDown = (e: PointerEvent): void => {
      const el = e.target as HTMLElement | null
      if (el?.closest('.csv-pop') ?? false) return
      if (el?.closest('.csv-opt-btn') ?? false) return
      setOpenCol(null)
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpenCol(null)
    }
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [openCol])

  useEffect(() => {
    if (props.inline) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') props.onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.inline])

  function load(offset: number, append: boolean): void {
    if (append) setLoadingMore(true)
    else setLoading(true)
    setError(null)
    window.api.storage
      .preview({
        accountId,
        container,
        name,
        offset,
        maxBytes: PREVIEW_DEFAULT_BYTES,
        maxLines: PREVIEW_DEFAULT_LINES
      })
      .then((res: PreviewResult) => {
        setSize(res.size)
        setFlavor(res.flavor)
        setBinary(res.binary)
        setGuessed(res.guessed ?? false)
        setContentType(res.contentType)
        if (res.flavor === 'text') setView('raw')
        let chunk = res.text
        if (offset === 0) chunk = chunk.replace(/^﻿/, '')
        setText((prev) => {
          const base = append ? prev : ''
          const room = PREVIEW_CLIENT_CAP - base.length
          if (room <= 0) {
            setCapped(true)
            return base
          }
          if (chunk.length > room) {
            setCapped(true)
            return base + chunk.slice(0, room)
          }
          return base + chunk
        })
        setNextOffset(res.nextOffset)
        setEof(res.eof)
      })
      .catch((err: unknown) => {
        setError(stripIpcWrapper(err instanceof Error ? err.message : String(err)))
      })
      .finally(() => {
        setLoading(false)
        setLoadingMore(false)
      })
  }

  useEffect(() => {
    load(0, false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountId, container, name])

  const csv = useMemo(() => {
    if (flavor !== 'csv' || binary) return null
    const firstLines: string[] = []
    for (const line of text.split('\n')) {
      if (line.trim() !== '') firstLines.push(line)
      if (firstLines.length >= 5) break
    }
    const delimiter = detectDelimiter(firstLines)
    const parsed = parseCsv(text, delimiter)
    const { rows, pending } = displayableCsvRows(parsed, eof)
    return { delimiter, rows, pending }
  }, [text, flavor, binary, eof])

  const prettyJson = useMemo(() => {
    if (binary || extOf(name) !== 'json' || !eof || text.trim() === '') return null
    try {
      return JSON.stringify(JSON.parse(text), null, 2)
    } catch {
      return null
    }
  }, [text, binary, eof, name])

  const leaf = name.includes('/') ? name.slice(name.lastIndexOf('/') + 1) : name
  const fetched = nextOffset ?? 0
  const rows = csv?.rows ?? []
  const isCsv = flavor === 'csv' && !binary
  const rowCount = rows.length
  const header = rows[0] ?? []
  const body = rows.slice(1)
  const colCount = Math.max(header.length, ...body.slice(0, 20).map((r) => r.length), 1)

  function toggleSort(ci: number): void {
    if (sortCol !== ci) {
      setSortCol(ci)
      setSortDir(1)
    } else if (sortDir === 1) {
      setSortDir(-1)
    } else {
      setSortCol(null)
      setSortDir(1)
    }
  }

  function setColFilter(ci: number, value: string): void {
    setColFilters((prev) => {
      const next = [...prev]
      while (next.length <= ci) next.push('')
      next[ci] = value
      return next
    })
  }

  /** Content-based widths + numeric detection over a sample of loaded rows. */
  const colMeta = useMemo(() => {
    const widths: number[] = []
    const numeric: boolean[] = []
    const sample = body.slice(0, 100)
    for (let ci = 0; ci < colCount; ci++) {
      let maxLen = (header[ci] ?? '').length
      let num = 0
      let denom = 0
      for (const r of sample) {
        const v = r[ci] ?? ''
        if (v.length > maxLen) maxLen = v.length
        const t = v.trim()
        if (t !== '') {
          denom += 1
          if (!Number.isNaN(Number(t))) num += 1
        }
      }
      numeric.push(denom > 0 && num / denom >= 0.8)
      widths.push(Math.min(420, Math.max(96, Math.ceil(maxLen * 7.6 + 30))))
    }
    return { widths, numeric }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, colCount])

  function widthOf(ci: number): number {
    return colWidths[ci] ?? colMeta.widths[ci] ?? 150
  }

  function startCsvResize(e: React.MouseEvent, ci: number): void {
    e.preventDefault()
    e.stopPropagation()
    const startX = e.clientX
    const startW = widthOf(ci)
    const onMove = (ev: MouseEvent): void => {
      const next = Math.min(600, Math.max(64, startW + ev.clientX - startX))
      setColWidths((prev) => {
        const arr = [...prev]
        while (arr.length <= ci) arr.push(undefined)
        arr[ci] = next
        return arr
      })
    }
    const onUp = (): void => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  function resetCsvWidth(ci: number): void {
    setColWidths((prev) => prev.map((w, i) => (i === ci ? undefined : w)))
  }

  const filteredBody = useMemo(() => {
    const active = Array.from({ length: colCount }, (_, ci) => (colFilters[ci] ?? '').trim().toLowerCase())
    const hasFilter = active.some((f) => f !== '')
    let out = hasFilter
      ? body.filter((r) => active.every((f, ci) => f === '' || (r[ci] ?? '').toLowerCase().includes(f)))
      : [...body]
    if (sortCol !== null) {
      const ci = sortCol
      out = [...out].sort((a, b) => {
        const av = a[ci] ?? ''
        const bv = b[ci] ?? ''
        const an = parseFloat(av)
        const bn = parseFloat(bv)
        let cmp: number
        if (av !== '' && bv !== '' && !Number.isNaN(an) && !Number.isNaN(bn)) cmp = an - bn
        else cmp = av.localeCompare(bv)
        return cmp * sortDir
      })
    }
    return out
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, colFilters, sortCol, sortDir, colCount])

  const isFiltered = filteredBody.length !== body.length
  const renderedBody = filteredBody.slice(0, PREVIEW_RENDER_LINES)
  const hiddenRows = filteredBody.length - renderedBody.length

  const rawLines = view === 'raw' ? (pretty && prettyJson ? prettyJson : text).split('\n') : []
  const renderedLines = rawLines.slice(0, PREVIEW_RENDER_LINES)
  const hiddenLines = rawLines.length - renderedLines.length

  const canMore = !eof && !capped && nextOffset !== null && !binary

  return (
    <div
      className={props.inline ? 'preview-inline fade-in' : 'modal-backdrop'}
      onClick={props.inline ? undefined : props.onClose}
    >
      <div
        className={props.inline ? 'preview-pane' : 'modal glass strong preview-modal fade-in'}
        role="dialog"
        aria-label={`Preview ${leaf}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="preview-head">
          <div className="preview-title">
            <span className="file-ico file" aria-hidden />
            <div className="preview-title-text">
              <strong title={name}>{leaf}</strong>
              <span className="muted small" title={name}>
                {formatBytes(size)}
                {contentType ? ` · ${contentType}` : ''}
                {flavor === 'csv' && !binary ? ` · ${csv?.rows.length ?? 0} rows so far` : ''}
                {guessed && !binary ? ' · shown as text (best guess)' : ''}
              </span>
            </div>
          </div>
          <div className="preview-head-actions">
            {flavor === 'csv' && !binary && (
              <div className="seg-row preview-tabs" role="tablist" aria-label="Preview mode">
                <button
                  className={`btn ghost small${view === 'table' ? ' active-opt' : ''}`}
                  role="tab"
                  aria-selected={view === 'table'}
                  onClick={() => setView('table')}
                >
                  Table
                </button>
                <button
                  className={`btn ghost small${view === 'raw' ? ' active-opt' : ''}`}
                  role="tab"
                  aria-selected={view === 'raw'}
                  onClick={() => setView('raw')}
                >
                  Raw
                </button>
              </div>
            )}
            {view === 'raw' && prettyJson && (
              <button
                className={`btn ghost small${pretty ? ' active-opt' : ''}`}
                onClick={() => setPretty((p) => !p)}
                title="Toggle pretty-printed JSON"
              >
                {'{}'} Pretty
              </button>
            )}
            <button className="icon-btn" onClick={props.onClose} aria-label="Close preview">
              ✕
            </button>
          </div>
        </div>

        <div className="preview-body">
          {loading ? (
            <ul className="skeleton">
              {Array.from({ length: 6 }, (_, i) => (
                <li key={i} style={{ animationDelay: `${i * 40}ms` }} />
              ))}
            </ul>
          ) : error ? (
            <div className="preview-error">
              <p className="error-text">{error}</p>
              <button className="btn ghost small" onClick={() => load(0, false)}>
                Retry
              </button>
            </div>
          ) : binary ? (
            <div className="empty-state">
              <div className="empty-state-icon" aria-hidden>⬢</div>
              <p className="empty-state-title">Binary file — no text preview</p>
              <p className="muted small empty-state-sub">
                Only the first bytes were fetched to check the file type. Download the full file to view it.
              </p>
            </div>
          ) : size === 0 && text === '' ? (
            <div className="empty-state">
              <div className="empty-state-icon" aria-hidden>◍</div>
              <p className="empty-state-title">File is empty</p>
              <p className="muted small empty-state-sub">Zero bytes — nothing to preview.</p>
            </div>
          ) : view === 'table' && csv ? (
            <div className="csv-wrap" role="region" aria-label="CSV preview" tabIndex={0}>
              {isFiltered && (
                <p className="muted small preview-more-note">
                  Showing {filteredBody.length} of {body.length} rows — filters apply to loaded rows only.
                </p>
              )}
              <table className="csv-table">
                <colgroup>
                  {Array.from({ length: colCount }, (_, i) => (
                    <col key={i} style={{ width: `${widthOf(i)}px` }} />
                  ))}
                </colgroup>
                <thead>
                  <tr>
                    {Array.from({ length: colCount }, (_, i) => {
                      const h = header[i] ?? ''
                      const label = h === '' ? `col${i + 1}` : h
                      const num = colMeta.numeric[i] ?? false
                      const active = (colFilters[i] ?? '').trim() !== '' || sortCol === i
                      return (
                        <th key={i} className={num ? 'num' : undefined}>
                          <div className="csv-head-row">
                            <button
                              className="csv-sort"
                              onClick={() => toggleSort(i)}
                              title={sortCol === i ? `Sorted ${sortDir === 1 ? 'ascending' : 'descending'} — click to ${sortDir === 1 ? 'reverse' : 'clear'}` : `Sort by ${label}`}
                            >
                              <span className="csv-sort-label" title={label}>{label}</span>
                              <span className="csv-sort-arrow" aria-hidden>
                                {sortCol === i ? (sortDir === 1 ? ' ↑' : ' ↓') : ''}
                              </span>
                            </button>
                            <button
                              className={`csv-opt-btn${active ? ' active' : ''}${openCol === i ? ' open' : ''}`}
                              onClick={() => setOpenCol(openCol === i ? null : i)}
                              title={`Filter and sort options for ${label}`}
                              aria-label={`Filter and sort options for ${label}`}
                              aria-expanded={openCol === i}
                            >
                              ▼
                            </button>
                          </div>
                          {openCol === i && (
                            <div className="csv-pop" onClick={(e) => e.stopPropagation()}>
                              <button
                                className={`csv-pop-item${sortCol === i && sortDir === 1 ? ' selected' : ''}`}
                                onClick={() => {
                                  setSortCol(i)
                                  setSortDir(1)
                                  setOpenCol(null)
                                }}
                              >
                                ↑ Sort ascending
                              </button>
                              <button
                                className={`csv-pop-item${sortCol === i && sortDir === -1 ? ' selected' : ''}`}
                                onClick={() => {
                                  setSortCol(i)
                                  setSortDir(-1)
                                  setOpenCol(null)
                                }}
                              >
                                ↓ Sort descending
                              </button>
                              {sortCol === i && (
                                <button
                                  className="csv-pop-item"
                                  onClick={() => {
                                    setSortCol(null)
                                    setSortDir(1)
                                  }}
                                >
                                  Clear sort
                                </button>
                              )}
                              <div className="csv-pop-sep" aria-hidden />
                              <input
                                className="csv-pop-filter"
                                value={colFilters[i] ?? ''}
                                onChange={(e) => setColFilter(i, e.target.value)}
                                placeholder={`Filter ${label}…`}
                                aria-label={`Filter ${label}`}
                                autoFocus
                              />
                              {(colFilters[i] ?? '').trim() !== '' && (
                                <button
                                  className="csv-pop-item"
                                  onClick={() => setColFilter(i, '')}
                                >
                                  Clear filter
                                </button>
                              )}
                            </div>
                          )}
                          <span
                            className="csv-resizer"
                            onMouseDown={(e) => startCsvResize(e, i)}
                            onDoubleClick={(e) => {
                              e.stopPropagation()
                              resetCsvWidth(i)
                            }}
                            title="Drag to resize · double-click for auto"
                            aria-hidden
                          />
                        </th>
                      )
                    })}
                  </tr>
                </thead>
                <tbody>
                  {renderedBody.map((r, ri) => (
                    <tr key={ri}>
                      {Array.from({ length: colCount }, (_, ci) => (
                        <td key={ci} title={r[ci] ?? ''} className={colMeta.numeric[ci] ? 'num' : undefined}>
                          {r[ci] ?? ''}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
              {hiddenRows > 0 && (
                <p className="muted small preview-more-note">
                  + {hiddenRows} more loaded rows hidden — load in smaller pages or download the file.
                </p>
              )}
            </div>
          ) : (
            <div className="text-view" role="region" aria-label="Text preview" tabIndex={0}>
              {renderedLines.map((line, i) => (
                <div className="text-line" key={i}>
                  <span className="text-lno" aria-hidden>
                    {i + 1}
                  </span>
                  <span className="text-content">{line === '' ? ' ' : line}</span>
                </div>
              ))}
              {hiddenLines > 0 && (
                <p className="muted small preview-more-note">
                  + {hiddenLines} more loaded lines hidden — download the file for the full text.
                </p>
              )}
            </div>
          )}
        </div>

        <div className="preview-foot">
          <span className="muted small preview-progress" aria-live="polite">
            {binary
              ? `${formatBytes(size)} binary`
              : isCsv && rowCount > 0
                ? `${rowCount} rows so far · ${formatBytes(fetched)} of ${formatBytes(size)}${eof || capped ? ' · end of preview' : ''}`
                : `${formatBytes(fetched)} of ${formatBytes(size)}${eof || capped ? ' · end of preview' : ''}`}
            {capped && !binary ? ' · preview capped at 2 MiB' : ''}
            {csv?.pending ? ' · last row continues…' : ''}
            {loadingMore ? ' · loading…' : ''}
          </span>
          <div className="row end preview-foot-actions">
            {canMore && (
              <button
                className="btn ghost small"
                disabled={loadingMore}
                onClick={() => nextOffset !== null && load(nextOffset, true)}
              >
                {loadingMore ? 'Loading…' : flavor === 'csv' ? 'More rows' : 'More lines'}
              </button>
            )}
            <button className="btn mint small" onClick={props.onDownload}>
              Download full file
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
