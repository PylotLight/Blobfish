import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ActivityEntry, TransferInfo, TransfersDelta } from '../../../shared/types'
import { onPanelAction } from '../palette-bus'
import { formatBytes, formatDuration, formatEta, formatPct, formatSpeed } from '../../../shared/format'
import { applyTransfersDelta, viewFromSnapshot, type TransfersView } from '../../../shared/transfers-delta'
import { virtualWindow } from '../../../shared/virtual-window'

/* Above this many rows only the visible slice is mounted (5,000 queued files used to
 * mean 5,000 <li>s re-rendered on every progress tick). */
const VIRTUAL_MIN_ROWS = 60
const VIRTUAL_OVERSCAN = 6
const DEFAULT_ROW_PITCH = 78

/**
 * Full list once (`transfers:list`), then compact deltas. Deltas that land before the
 * list resolves are buffered; a rev gap (missed delta) re-fetches the list.
 */
function useTransfers(): TransfersView | null {
  const [view, setView] = useState<TransfersView | null>(null)
  useEffect(() => {
    let alive = true
    let current: TransfersView | null = null
    let pending: TransfersDelta[] = []
    let resyncing = false
    const resync = (): void => {
      if (resyncing) return
      resyncing = true
      window.api.transfers
        .list()
        .then((snap) => {
          if (!alive) return
          resyncing = false
          let v: TransfersView | null = viewFromSnapshot(snap)
          for (const d of pending) v = v && applyTransfersDelta(v, d)
          pending = []
          if (!v) return resync()
          current = v
          setView(v)
        })
        .catch((err: unknown) => {
          resyncing = false
          console.error(err)
        })
    }
    const off = window.api.transfers.onUpdate((delta) => {
      if (!current || resyncing) {
        pending.push(delta)
        return
      }
      const next = applyTransfersDelta(current, delta)
      if (!next) {
        pending.push(delta)
        current = null
        return resync()
      }
      if (next !== current) {
        current = next
        setView(next)
      }
    })
    resync()
    return () => {
      alive = false
      off()
    }
  }, [])
  return view
}

function statusLine(t: TransferInfo): string {
  const size =
    t.totalBytes > 0
      ? `${formatBytes(t.doneBytes)} / ${formatBytes(t.totalBytes)}`
      : formatBytes(t.doneBytes)
  switch (t.status) {
    case 'active': {
      const bits = [size, formatPct(t.doneBytes, t.totalBytes)]
      if (t.speedBps) bits.push(formatSpeed(t.speedBps))
      if (t.etaSec !== undefined) bits.push(formatEta(t.etaSec))
      if (t.concurrency > 1) bits.push(`${t.concurrency} conn`)
      return bits.join(' · ')
    }
    case 'queued':
      return t.totalBytes > 0 ? `Queued · ${formatBytes(t.totalBytes)}` : 'Queued'
    case 'completed': {
      const ms =
        t.startedAt !== undefined && t.finishedAt !== undefined
          ? t.finishedAt - t.startedAt
          : undefined
      return `Completed · ${formatBytes(t.totalBytes)}${ms !== undefined ? ` in ${formatDuration(ms)}` : ''}`
    }
    case 'failed':
      return t.error ?? 'Failed'
    case 'cancelled':
      return 'Cancelled'
  }
}

const TransferRow = memo(function TransferRow(props: { t: TransferInfo }): React.JSX.Element {
  const { t } = props
  const pct = t.totalBytes > 0 ? Math.min(100, (t.doneBytes / t.totalBytes) * 100) : 0
  const indeterminate = t.status === 'active' && t.totalBytes === 0
  const [gone, setGone] = useState(false)

  async function deleteDownloaded(): Promise<void> {
    try {
      const res = await window.api.activity.deleteFile({ id: t.id, localPath: t.localPath ?? '' })
      if (res.success) setGone(true)
      else console.error(res.message)
    } catch (err) {
      console.error(err)
    }
  }
  return (
    <li className={`transfer${t.status === 'failed' ? ' failed' : ''}`}>
      <span className={`t-dir ${t.direction}`} aria-hidden>
        {t.direction === 'upload' ? '↑' : '↓'}
      </span>
      <div className="t-main">
        <div className="t-name" title={`${t.container}/${t.name}`}>
          <strong>{t.name.split('/').pop()}</strong>
          <span className="muted small">
            {t.container} · {t.accountName}
          </span>
        </div>
        <div className="t-bar" role="progressbar" aria-label={`${t.name} ${t.status}`}>
          <div
            className={`t-fill${indeterminate ? ' indeterminate' : ''}`}
            style={indeterminate ? undefined : { width: `${pct}%` }}
          />
        </div>
        <div
          className={`t-status small${t.status === 'failed' ? ' error-text' : ' muted'}`}
          title={t.status === 'failed' ? t.error : undefined}
        >
          {statusLine(t)}
        </div>
      </div>
      <span className="t-actions">
        {t.status === 'completed' && t.direction === 'download' && t.localPath && !gone && (
          <>
            <button
              className="mini-btn"
              title="Open with the default app"
              onClick={() => void window.api.activity.openFile(t.localPath ?? '').catch(console.error)}
            >
              Open
            </button>
            <button
              className="mini-btn"
              title="Show in folder (Finder / Explorer)"
              onClick={() => void window.api.activity.revealFile(t.localPath ?? '').catch(console.error)}
            >
              Reveal
            </button>
            <button
              className="mini-btn danger-x"
              title="Delete downloaded file (moves to trash)"
              onClick={() => void deleteDownloaded()}
            >
              Delete
            </button>
          </>
        )}
        {t.status === 'completed' && t.direction === 'download' && gone && (
          <span className="muted small">Deleted</span>
        )}
        {(t.status === 'active' || t.status === 'queued') && (
          <button
            className="mini-btn"
            title="Cancel transfer"
            onClick={() => void window.api.transfers.cancel(t.id)}
          >
            ✕
          </button>
        )}
        {(t.status === 'failed' || t.status === 'cancelled') && (
          <button
            className="mini-btn"
            title="Retry transfer"
            onClick={() => void window.api.transfers.retry(t.id)}
          >
            ↻
          </button>
        )}
        {t.status === 'completed' && <span className="t-done" aria-label="Done">✓</span>}
      </span>
    </li>
  )
})

function ActivityRow(props: { entry: ActivityEntry }): React.JSX.Element {
  const { entry } = props
  const when = new Date(entry.at).toLocaleString()
  return (
    <li className="activity-row">
      <span className={`a-dot ${entry.status}`} aria-hidden>
        {entry.status === 'success' ? '✓' : '✕'}
      </span>
      <div className="a-main">
        <div>{entry.text}</div>
        <div className="muted small">
          {[entry.detail, `Started at ${when}`, entry.durationMs !== undefined ? `Duration: ${formatDuration(entry.durationMs)}` : null]
            .filter(Boolean)
            .join(' · ')}
        </div>
        {entry.localPath && !entry.fileDeleted && entry.transferDirection === 'download' && (
          <div className="row activity-file-actions">
            <button
              className="linklike small"
              onClick={() => void window.api.activity.openFile(entry.localPath ?? '').catch(console.error)}
            >
              Open file
            </button>
            <button
              className="linklike small"
              onClick={() => void window.api.activity.revealFile(entry.localPath ?? '').catch(console.error)}
            >
              Show in folder
            </button>
            <button
              className="linklike small"
              onClick={() => void window.api.activity.deleteFile({ id: entry.id }).catch(console.error)}
            >
              Delete file
            </button>
          </div>
        )}
        {entry.fileDeleted && <div className="muted small">Downloaded file deleted.</div>}
      </div>
    </li>
  )
}

export default function TransfersPanel(props: { onOpenSettings: () => void }): React.JSX.Element {
  const view = useTransfers()
  const snap = view?.summary ?? null
  const total = view?.order.length ?? 0
  const [activities, setActivities] = useState<ActivityEntry[]>([])
  const [expanded, setExpanded] = useState(false)
  // Pinned = user explicitly opened via click; hover alone only opens transiently.
  const [pinned, setPinned] = useState(false)
  const hadActive = useRef(false)
  const hoverTimer = useRef<number | null>(null)

  // Hover intent: small delay so brushing past the strip doesn't flicker it open.
  function scheduleOpen(): void {
    if (expanded || hoverTimer.current !== null) return
    hoverTimer.current = window.setTimeout(() => {
      hoverTimer.current = null
      setExpanded(true)
    }, 120)
  }

  function cancelScheduled(): void {
    if (hoverTimer.current !== null) {
      window.clearTimeout(hoverTimer.current)
      hoverTimer.current = null
    }
  }

  useEffect(() => {
    return () => {
      if (hoverTimer.current !== null) window.clearTimeout(hoverTimer.current)
    }
  }, [])

  useEffect(() => {
    window.api.activity.list().then(setActivities).catch(console.error)
    return window.api.activity.onUpdate(setActivities)
  }, [])

  /* ---------- virtualized transfer rows (the panel itself scrolls) ---------- */
  const panelRef = useRef<HTMLElement>(null)
  const topSpacerRef = useRef<HTMLLIElement>(null)
  const [rowPitch, setRowPitch] = useState(DEFAULT_ROW_PITCH)
  const [viewport, setViewport] = useState({ offset: 0, height: 600 })
  const virtual = expanded && total > VIRTUAL_MIN_ROWS
  const scrollFrame = useRef(0)

  const measureViewport = useCallback((): void => {
    const el = panelRef.current
    const spacer = topSpacerRef.current
    if (!el || !spacer) return
    const listTop = spacer.getBoundingClientRect().top - el.getBoundingClientRect().top + el.scrollTop
    const offset = Math.max(0, el.scrollTop - listTop)
    const height = el.clientHeight
    setViewport((prev) => (prev.offset === offset && prev.height === height ? prev : { offset, height }))
  }, [])

  const onPanelScroll = useCallback((): void => {
    if (scrollFrame.current) return
    scrollFrame.current = requestAnimationFrame(() => {
      scrollFrame.current = 0
      measureViewport()
    })
  }, [measureViewport])

  useEffect(() => () => cancelAnimationFrame(scrollFrame.current), [])

  useEffect(() => {
    const el = panelRef.current
    if (!el || !virtual) return
    const ro = new ResizeObserver(() => measureViewport())
    ro.observe(el)
    return () => ro.disconnect()
  }, [virtual, measureViewport])

  // Rows are fixed-height (one-line name + bar + one-line status), so one measured
  // row (+ its margin) sizes them all.
  useLayoutEffect(() => {
    if (!virtual) return
    measureViewport()
    const row = topSpacerRef.current?.nextElementSibling as HTMLElement | null
    if (!row) return
    const h = row.getBoundingClientRect().height + (parseFloat(getComputedStyle(row).marginBottom) || 0)
    if (h > 0 && Math.abs(h - rowPitch) > 0.5) setRowPitch(h)
  })

  // ⌘K: toggle the dock / jump to activity (pinned, so it stays open even when empty).
  useEffect(
    () =>
      onPanelAction((action) => {
        cancelScheduled()
        const open = action === 'show-activity' || !(expanded && pinned)
        setPinned(open)
        setExpanded(open)
        if (action === 'show-activity') {
          window.setTimeout(() => document.querySelector('.transfers-panel .activity-head')?.scrollIntoView({ block: 'start' }), 0)
        }
      }),
    [expanded, pinned]
  )

  // Pop open the moment work starts, like a download shelf.
  useEffect(() => {
    if (snap && snap.active > 0 && !hadActive.current) setExpanded(true)
    hadActive.current = (snap?.active ?? 0) > 0
  }, [snap])

  const empty = !snap || (total === 0 && activities.length === 0)
  if (!view || !snap || (empty && !(pinned && expanded))) return <></>

  // Actives sort first, so this is O(1).
  const firstId = view.order[0]
  const first = firstId !== undefined ? view.rows.get(firstId) : undefined
  const firstActive = first?.status === 'active' ? first : undefined
  const { up, down } = snap

  if (!expanded) {
    return (
      <button
        className="transfers-bar"
        onClick={() => {
          cancelScheduled()
          setPinned(true)
          setExpanded(true)
        }}
        onMouseEnter={scheduleOpen}
        onMouseLeave={cancelScheduled}
        title="Transfers and activity — hover to expand, click to pin"
      >
        <span className="t-stats">
          {up > 0 && <span>↑ {up}</span>}
          {down > 0 && <span>↓ {down}</span>}
          {snap.active === 0 && <span>✓ {total}</span>}
        </span>
        {firstActive && (
          <span className="t-mini-name">
            {firstActive.name.split('/').pop()} ·{' '}
            {formatPct(firstActive.doneBytes, firstActive.totalBytes)}
          </span>
        )}
        {snap.aggregateBps > 0 && <span className="t-speed">{formatSpeed(snap.aggregateBps)}</span>}
        <span className="twisty open" aria-hidden>›</span>
      </button>
    )
  }

  const { start, end } = virtual
    ? virtualWindow(total, viewport.offset, viewport.height, rowPitch, VIRTUAL_OVERSCAN)
    : { start: 0, end: total }

  return (
    <section
      ref={panelRef}
      onScroll={virtual ? onPanelScroll : undefined}
      className="transfers-panel card dock-in"
      aria-label="Transfers and activity"
      onMouseEnter={cancelScheduled}
      onMouseLeave={() => {
        // Hover-opened dock slides away; pinned and active work stays put.
        if (!pinned && (snap.active === 0)) setExpanded(false)
      }}
    >
      <header className="transfers-head">
        <strong>Transfers</strong>
        <span className="muted small">
          {snap.active > 0
            ? `${snap.active} active · ${snap.queued} queued · ${formatSpeed(snap.aggregateBps)}`
            : snap.queued > 0
              ? `${snap.queued} queued`
              : 'idle'}
        </span>
        <span className="pill conn-pill" title="Parallel connections per file (uploads and downloads) · max simultaneous transfers">
          {snap.uploadConcurrency} conn/file · {snap.maxParallel} parallel
        </span>
        <span className="transfers-head-actions">
          <button className="mini-btn" title="Transfer tuning" onClick={props.onOpenSettings}>
            Tuning
          </button>
          {snap.finished > 0 && (
            <button
              className="mini-btn"
              onClick={() => void window.api.transfers.clearFinished()}
            >
              Clear finished
            </button>
          )}
          {snap.active + snap.queued > 0 && (
            <button className="mini-btn danger-x" onClick={() => void window.api.transfers.cancelAll()}>
              Cancel all
            </button>
          )}
          <button
            className="mini-btn"
            onClick={() => {
              setPinned(false)
              setExpanded(false)
            }}
            aria-label="Collapse"
          >
            ⌄
          </button>
        </span>
      </header>

      {total > 0 && (
        <ul className={`transfer-list${virtual ? ' virtual' : ''}`} aria-rowcount={total}>
          {virtual && <li ref={topSpacerRef} className="t-spacer" aria-hidden style={{ height: start * rowPitch }} />}
          {view.order.slice(start, end).map((id) => {
            const t = view.rows.get(id)
            return t ? <TransferRow key={id} t={t} /> : null
          })}
          {virtual && <li className="t-spacer" aria-hidden style={{ height: (total - end) * rowPitch }} />}
        </ul>
      )}

      {empty && <p className="muted small transfers-empty" style={{ margin: '10px 0 0' }}>No transfers or activity yet.</p>}

      {activities.length > 0 && (
        <>
          <header className="activity-head">
            <strong>Activity</strong>
            <span className="activity-links">
              <button
                className="linklike small"
                onClick={() => void window.api.activity.clear('completed')}
              >
                Clear completed
              </button>
              <button
                className="linklike small"
                onClick={() => void window.api.activity.clear('successful')}
              >
                Clear successful
              </button>
            </span>
          </header>
          <ul className="activity-list">
            {activities.slice(0, 30).map((e) => (
              <ActivityRow key={e.id} entry={e} />
            ))}
          </ul>
        </>
      )}
    </section>
  )
}
