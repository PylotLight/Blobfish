import { useEffect, useRef, useState } from 'react'
import type { BlobVersionInfo, StorageBlobItem } from '../../../shared/types'
import { formatBytes } from '../../../shared/format'
import { stripIpcWrapper } from './errors'

function useDismiss(onCancel: () => void): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCancel])
}

/**
 * Intentional-action confirm. Destructive operations pass `requireText`
 * (the user must type the container/account name) so a stray click
 * can never delete anything.
 */
export function ConfirmDialog(props: {
  title: string
  body?: string
  items?: string[]
  requireText?: string
  confirmLabel?: string
  danger?: boolean
  onCancel: () => void
  onConfirm: () => Promise<void>
}): React.JSX.Element {
  const [typed, setTyped] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const confirmRef = useRef<HTMLButtonElement>(null)
  useDismiss(props.onCancel)

  useEffect(() => {
    if (!props.requireText) confirmRef.current?.focus()
  }, [props.requireText])

  const matches = !props.requireText || typed.trim() === props.requireText

  async function submit(): Promise<void> {
    if (!matches || busy) return
    setBusy(true)
    setError(null)
    try {
      await props.onConfirm()
      props.onCancel()
    } catch (err) {
      setError(stripIpcWrapper(err instanceof Error ? err.message : String(err)))
    } finally {
      setBusy(false)
    }
  }

  const shown = (props.items ?? []).slice(0, 8)
  const extra = (props.items ?? []).length - shown.length

  return (
    <div className="modal-backdrop" onClick={props.onCancel}>
      <div
        className="modal glass strong dialog fade-in"
        role="alertdialog"
        aria-label={props.title}
        onClick={(e) => e.stopPropagation()}
      >
        <h3>{props.title}</h3>
        {props.body && <p className="muted">{props.body}</p>}
        {shown.length > 0 && (
          <ul className="dialog-items">
            {shown.map((item) => (
              <li key={item}>
                <code>{item}</code>
              </li>
            ))}
            {extra > 0 && (
              <li className="muted small">+ {extra} more</li>
            )}
          </ul>
        )}
        {props.requireText && (
          <label className="field">
            <span>
              Type <code>{props.requireText}</code> to confirm
            </span>
            <input
              value={typed}
              autoFocus
              onChange={(e) => setTyped(e.target.value)}
              placeholder={props.requireText}
              autoComplete="off"
              spellCheck={false}
            />
          </label>
        )}
        {error && <p className="error-text">{error}</p>}
        <div className="row end">
          <button className="btn ghost" onClick={props.onCancel} disabled={busy}>
            Cancel
          </button>
          <button
            ref={confirmRef}
            className={`btn${props.danger === false ? ' mint' : ' danger'}`}
            disabled={!matches || busy}
            onClick={() => void submit()}
          >
            {busy ? 'Working…' : (props.confirmLabel ?? 'Confirm')}
          </button>
        </div>
      </div>
    </div>
  )
}

/** Folder picker — browse prefixes inside a container to choose a destination.
 *  Submitting `''` means the container root. Stays open on failure so the
 *  user can pick elsewhere (self-move guards, collisions). */
export function FolderPickerDialog(props: {
  title: string
  accountId: string
  container: string
  confirmLabel?: string
  onCancel: () => void
  onSubmit: (destPrefix: string, overwrite: boolean) => Promise<void>
}): React.JSX.Element {
  const [prefix, setPrefix] = useState('')
  const [overwrite, setOverwrite] = useState(false)
  const [folders, setFolders] = useState<StorageBlobItem[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const seq = useRef(0)
  useDismiss(props.onCancel)

  useEffect(() => {
    const id = ++seq.current
    setLoading(true)
    setError(null)
    window.api.storage
      .listBlobs({ accountId: props.accountId, container: props.container, prefix: prefix || undefined })
      .then((res) => {
        if (id !== seq.current) return
        setFolders(res.items.filter((i) => i.isPrefix))
      })
      .catch((err: unknown) => {
        if (id !== seq.current) return
        setError(stripIpcWrapper(err instanceof Error ? err.message : String(err)))
      })
      .finally(() => {
        if (id === seq.current) setLoading(false)
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefix, props.accountId, props.container])

  const crumbs = prefix === '' ? [] : prefix.split('/').filter(Boolean)

  function go(next: string): void {
    setError(null)
    setPrefix(next)
  }

  async function create(): Promise<void> {
    const leaf = newName.trim().replace(/^\/+|\/+$/g, '')
    if (leaf === '' || leaf.includes('/') || creating) return
    setCreating(true)
    setError(null)
    try {
      await window.api.storage.createFolder({
        accountId: props.accountId,
        container: props.container,
        prefix: prefix || undefined,
        folderName: leaf
      })
      setNewName('')
      // Enter the new folder so it can be picked immediately.
      go(prefix ? `${prefix}/${leaf}` : leaf)
    } catch (err) {
      setError(stripIpcWrapper(err instanceof Error ? err.message : String(err)))
    } finally {
      setCreating(false)
    }
  }

  async function submit(): Promise<void> {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      await props.onSubmit(prefix, overwrite)
      props.onCancel()
    } catch (err) {
      setError(stripIpcWrapper(err instanceof Error ? err.message : String(err)))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="modal-backdrop" onClick={props.onCancel}>
      <div
        className="modal glass strong dialog fade-in"
        role="dialog"
        aria-label={props.title}
        onClick={(e) => e.stopPropagation()}
      >
        <h3>{props.title}</h3>
        <nav className="pick-crumb" aria-label="Destination path">
          <button className="linklike small" onClick={() => go('')} title={props.container}>
            {props.container}
          </button>
          {crumbs.map((seg, i) => (
            <span key={i}>
              <span className="sep"> / </span>
              <button className="linklike small" onClick={() => go(crumbs.slice(0, i + 1).join('/'))}>
                {seg}
              </button>
            </span>
          ))}
        </nav>
        <div className="pick-list" role="listbox" aria-label="Folders">
          {loading ? (
            <div className="pick-empty muted small">Loading…</div>
          ) : folders.length === 0 ? (
            <div className="pick-empty muted small">No subfolders — pick this folder or create one below.</div>
          ) : (
            folders.map((f) => (
              <button key={f.name} className="pick-row" role="option" aria-selected={false} onClick={() => go(f.name)} title={f.name}>
                <span className="file-ico folder" aria-hidden />
                <span>{f.leaf}</span>
              </button>
            ))
          )}
        </div>
        <form
          className="pick-new"
          onSubmit={(e) => {
            e.preventDefault()
            void create()
          }}
        >
          <input
            className="grow"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="New folder name…"
            aria-label="New folder name"
            autoComplete="off"
            spellCheck={false}
          />
          <button type="submit" className="btn ghost small" disabled={newName.trim() === '' || creating}>
            {creating ? 'Creating…' : 'Create'}
          </button>
        </form>
        <p className="muted small pick-dest">
          Destination: <code>{prefix === '' ? `${props.container} (root)` : prefix}</code>
        </p>
        <label className="pick-check">
          <input
            type="checkbox"
            checked={overwrite}
            onChange={(e) => setOverwrite(e.target.checked)}
          />
          <span>Replace blobs that already exist</span>
        </label>
        {error && <p className="error-text">{error}</p>}
        <div className="row end">
          <button className="btn ghost" onClick={props.onCancel} disabled={busy}>
            Cancel
          </button>
          <button className="btn mint" onClick={() => void submit()} disabled={busy}>
            {busy ? 'Working…' : (props.confirmLabel ?? 'Select')}
          </button>
        </div>
      </div>
    </div>
  )
}
/** Validated text input — replaces `window.prompt` everywhere. */
export function PromptDialog(props: {
  title: string
  label: string
  initial?: string
  placeholder?: string
  hint?: string
  confirmLabel?: string
  validate?: (value: string) => string | null
  onCancel: () => void
  onSubmit: (value: string) => Promise<void>
}): React.JSX.Element {
  const [value, setValue] = useState(props.initial ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useDismiss(props.onCancel)

  const validation = props.validate?.(value.trim()) ?? null

  async function submit(): Promise<void> {
    if (validation || value.trim() === '' || busy) return
    setBusy(true)
    setError(null)
    try {
      await props.onSubmit(value.trim())
      props.onCancel()
    } catch (err) {
      setError(stripIpcWrapper(err instanceof Error ? err.message : String(err)))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="modal-backdrop" onClick={props.onCancel}>
      <div
        className="modal glass strong dialog fade-in"
        role="dialog"
        aria-label={props.title}
        onClick={(e) => e.stopPropagation()}
      >
        <h3>{props.title}</h3>
        <form
          onSubmit={(e) => {
            e.preventDefault()
            void submit()
          }}
        >
          <label className="field">
            <span>{props.label}</span>
            <input
              value={value}
              autoFocus
              onChange={(e) => setValue(e.target.value)}
              placeholder={props.placeholder}
              autoComplete="off"
              spellCheck={false}
            />
          </label>
          {props.hint && !validation && <p className="muted small hint">{props.hint}</p>}
          {validation && value.trim() !== '' && <p className="error-text">{validation}</p>}
          {error && <p className="error-text">{error}</p>}
          <div className="row end">
            <button type="button" className="btn ghost" onClick={props.onCancel} disabled={busy}>
              Cancel
            </button>
            <button type="submit" className="btn mint" disabled={validation !== null || value.trim() === '' || busy}>
              {busy ? 'Working…' : (props.confirmLabel ?? 'Confirm')}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

/** Version history — versions/snapshots of one blob with restore. Restoring
 *  copies the old content over the current blob (destructive to current). */
export function VersionHistoryDialog(props: {
  accountId: string
  container: string
  name: string
  onCancel: () => void
  onRestored: () => void
}): React.JSX.Element {
  const [versions, setVersions] = useState<BlobVersionInfo[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [confirmKey, setConfirmKey] = useState<string | null>(null)
  const [restoring, setRestoring] = useState(false)
  useDismiss(props.onCancel)

  const leaf = props.name.includes('/') ? props.name.slice(props.name.lastIndexOf('/') + 1) : props.name

  function rowKey(v: BlobVersionInfo): string {
    if (v.versionId) return `v:${v.versionId}`
    if (v.snapshot) return `s:${v.snapshot}`
    return 'current'
  }

  function load(): void {
    setLoading(true)
    setError(null)
    window.api.storage
      .listVersions({ accountId: props.accountId, container: props.container, name: props.name })
      .then(setVersions)
      .catch((err: unknown) => {
        setError(stripIpcWrapper(err instanceof Error ? err.message : String(err)))
      })
      .finally(() => setLoading(false))
  }

  useEffect(load, [props.accountId, props.container, props.name])

  async function restore(v: BlobVersionInfo): Promise<void> {
    if (v.isCurrent || restoring) return
    setRestoring(true)
    setError(null)
    try {
      await window.api.storage.restoreVersion({
        accountId: props.accountId,
        container: props.container,
        name: props.name,
        versionId: v.versionId,
        snapshot: v.snapshot
      })
      setConfirmKey(null)
      props.onRestored()
      load()
    } catch (err) {
      setError(stripIpcWrapper(err instanceof Error ? err.message : String(err)))
    } finally {
      setRestoring(false)
    }
  }

  function kindLabel(v: BlobVersionInfo): string {
    if (v.isCurrent) return 'Current'
    if (v.versionId) return 'Version'
    if (v.snapshot) return 'Snapshot'
    return 'Copy'
  }

  const onlyCurrent = versions !== null && versions.every((v) => v.isCurrent)

  return (
    <div className="modal-backdrop" onClick={props.onCancel}>
      <div
        className="modal glass strong dialog fade-in"
        role="dialog"
        aria-label={`Version history for ${leaf}`}
        onClick={(e) => e.stopPropagation()}
      >
        <h3>Version history</h3>
        <p className="muted small" title={props.name}>
          {props.name}
        </p>
        {loading ? (
          <p className="muted small">Loading…</p>
        ) : error ? (
          <div className="preview-error">
            <p className="error-text">{error}</p>
            <button className="btn ghost small" onClick={load}>
              Retry
            </button>
          </div>
        ) : versions !== null && versions.length === 0 ? (
          <p className="muted small">No versions found.</p>
        ) : (
          <>
            {onlyCurrent && (
              <p className="muted small">
                Only the current copy exists — enable blob versioning on the storage account to keep history.
              </p>
            )}
            <ul className="version-list">
              {(versions ?? []).map((v) => {
                const key = rowKey(v)
                return (
                  <li key={key} className="version-row">
                    <div className="version-main">
                      <strong>
                        {kindLabel(v)}
                        {v.isCurrent && <span className="pill conn-pill version-badge">current</span>}
                      </strong>
                      <span className="muted small">
                        {[v.lastModified ? new Date(v.lastModified).toLocaleString() : null, formatBytes(v.size)]
                          .filter(Boolean)
                          .join(' · ')}
                      </span>
                    </div>
                    {!v.isCurrent &&
                      (confirmKey === key ? (
                        <span className="row">
                          <button
                            className="btn danger small"
                            disabled={restoring}
                            onClick={() => void restore(v)}
                          >
                            {restoring ? 'Restoring…' : 'Confirm restore'}
                          </button>
                          <button className="btn ghost small" disabled={restoring} onClick={() => setConfirmKey(null)}>
                            Cancel
                          </button>
                        </span>
                      ) : (
                        <button
                          className="btn ghost small"
                          title="Copy this version over the current blob"
                          onClick={() => setConfirmKey(key)}
                        >
                          Restore…
                        </button>
                      ))}
                  </li>
                )
              })}
            </ul>
          </>
        )}
        <div className="row end">
          <button className="btn ghost" onClick={props.onCancel}>
            Close
          </button>
        </div>
      </div>
    </div>
  )
}
