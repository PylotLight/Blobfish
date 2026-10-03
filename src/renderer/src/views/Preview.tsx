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

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') props.onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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
  const header = rows[0] ?? []
  const body = rows.slice(1)
  const renderedBody = body.slice(0, PREVIEW_RENDER_LINES)
  const hiddenRows = body.length - renderedBody.length
  const colCount = Math.max(header.length, ...renderedBody.slice(0, 20).map((r) => r.length), 1)

  const rawLines = view === 'raw' ? (pretty && prettyJson ? prettyJson : text).split('\n') : []
  const renderedLines = rawLines.slice(0, PREVIEW_RENDER_LINES)
  const hiddenLines = rawLines.length - renderedLines.length

  const canMore = !eof && !capped && nextOffset !== null && !binary

  return (
    <div className="modal-backdrop" onClick={props.onClose}>
      <div
        className="modal glass strong preview-modal fade-in"
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
              <table className="csv-table">
                <thead>
                  <tr>
                    {header.map((h, i) => (
                      <th key={i}>{h === '' ? `col${i + 1}` : h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {renderedBody.map((r, ri) => (
                    <tr key={ri}>
                      {Array.from({ length: colCount }, (_, ci) => (
                        <td key={ci} title={r[ci] ?? ''}>
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
              : eof || capped
                ? `${formatBytes(fetched)} of ${formatBytes(size)} · end of preview`
                : `${formatBytes(fetched)} of ${formatBytes(size)} · page ${formatBytes(PREVIEW_DEFAULT_BYTES)} at a time`}
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
