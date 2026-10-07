import { useEffect, useRef, useState } from 'react'
import type { ActivityEntry, TransferInfo, TransfersSnapshot } from '../../../shared/types'
import { formatBytes, formatDuration, formatEta, formatPct, formatSpeed } from '../../../shared/format'

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
      if (t.direction === 'upload') bits.push(`${t.concurrency} conn`)
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

function TransferRow(props: { t: TransferInfo }): React.JSX.Element {
  const { t } = props
  const pct = t.totalBytes > 0 ? Math.min(100, (t.doneBytes / t.totalBytes) * 100) : 0
  const indeterminate = t.status === 'active' && t.totalBytes === 0
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
        <div className={`t-status small${t.status === 'failed' ? ' error-text' : ' muted'}`}>
          {statusLine(t)}
        </div>
      </div>
      <span className="t-actions">
        {t.status === 'completed' && t.localPath && (
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
          </>
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
}

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
        {entry.localPath && (
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
          </div>
        )}
      </div>
    </li>
  )
}

export default function TransfersPanel(props: { onOpenSettings: () => void }): React.JSX.Element {
  const [snap, setSnap] = useState<TransfersSnapshot | null>(null)
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
    window.api.transfers.list().then(setSnap).catch(console.error)
    window.api.activity.list().then(setActivities).catch(console.error)
    const offT = window.api.transfers.onUpdate(setSnap)
    const offA = window.api.activity.onUpdate(setActivities)
    return () => {
      offT()
      offA()
    }
  }, [])

  // Pop open the moment work starts, like a download shelf.
  useEffect(() => {
    if (snap && snap.active > 0 && !hadActive.current) setExpanded(true)
    hadActive.current = (snap?.active ?? 0) > 0
  }, [snap])

  if (!snap || (snap.transfers.length === 0 && activities.length === 0)) return <></>

  const firstActive = snap.transfers.find((t) => t.status === 'active')
  const up = snap.transfers.filter((t) => t.direction === 'upload' && (t.status === 'active' || t.status === 'queued')).length
  const down = snap.transfers.filter((t) => t.direction === 'download' && (t.status === 'active' || t.status === 'queued')).length

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
          {snap.active === 0 && <span>✓ {snap.transfers.length}</span>}
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

  const finished = snap.transfers.filter(
    (t) => t.status === 'completed' || t.status === 'failed' || t.status === 'cancelled'
  )

  return (
    <section
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
        <span className="pill conn-pill" title="Parallel block connections per upload · max simultaneous transfers">
          {snap.uploadConcurrency} conn/file · {snap.maxParallel} parallel
        </span>
        <span className="transfers-head-actions">
          <button className="mini-btn" title="Transfer tuning" onClick={props.onOpenSettings}>
            Tuning
          </button>
          {finished.length > 0 && (
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

      {snap.transfers.length > 0 && (
        <ul className="transfer-list">
          {snap.transfers.map((t) => (
            <TransferRow key={t.id} t={t} />
          ))}
        </ul>
      )}

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
