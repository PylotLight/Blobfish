import { useEffect, useMemo, useState } from 'react'
import type {
  AccountSummary,
  ListBlobsResult,
  StorageBlobItem,
  StorageContainer
} from '../../../shared/types'
import type { SelectionTarget } from '../App'

type SortKey = 'name' | 'size' | 'modified'
type SortDir = 1 | -1

function formatBytes(n?: number): string {
  if (n === undefined) return '—'
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`
}

function sasWarning(expiry?: string | null): string | null {
  if (!expiry) return null
  const ms = Date.parse(expiry)
  if (Number.isNaN(ms)) return null
  if (ms <= Date.now()) return `SAS expired ${new Date(ms).toLocaleDateString()}`
  const days = Math.ceil((ms - Date.now()) / 86_400_000)
  return days <= 14 ? `SAS expires in ${days}d` : null
}

function keyOf(item: StorageBlobItem): string {
  return item.isPrefix ? `${item.name}/` : item.name
}

export default function Explorer(props: {
  account: AccountSummary | null
  target: SelectionTarget | null
  globalQuery: string
  onChanged: () => void
  onContainersChanged: (accountId: string) => void
}): React.JSX.Element {
  const { account } = props
  const [containers, setContainers] = useState<StorageContainer[]>([])
  const [container, setContainer] = useState<string | null>(null)
  const [blobs, setBlobs] = useState<ListBlobsResult | null>(null)
  const [navPrefix, setNavPrefix] = useState('')
  const [selection, setSelection] = useState<Set<string>>(new Set())
  const [loadingList, setLoadingList] = useState(false)
  const [loadingContainers, setLoadingContainers] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [sortKey, setSortKey] = useState<SortKey>('name')
  const [sortDir, setSortDir] = useState<SortDir>(1)

  const accountId = account?.id

  function flash(message: string): void {
    setNotice(message)
    window.setTimeout(() => setNotice((n) => (n === message ? null : n)), 3200)
  }

  function fail(err: unknown): void {
    setError(err instanceof Error ? err.message : String(err))
  }

  const loadContainers = (id: string, highlight?: string | null) => {
    setLoadingContainers(true)
    window.api.storage
      .listContainers(id)
      .then((cs) => {
        setContainers(cs)
        setContainer((prev) => {
          if (highlight && cs.some((c) => c.name === highlight)) return highlight
          if (prev && cs.some((c) => c.name === prev)) return prev
          return cs.length === 1 ? (cs[0]?.name ?? null) : null
        })
        if (cs.length === 0) setError('No containers found.')
      })
      .catch(fail)
      .finally(() => setLoadingContainers(false))
  }

  // Initial load per account.
  useEffect(() => {
    setContainers([])
    setContainer(null)
    setBlobs(null)
    setNavPrefix('')
    setSelection(new Set())
    setError(null)
    if (!accountId) return
    loadContainers(accountId, account?.containerName ?? props.target?.container ?? undefined)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountId])

  // Sidebar container picks.
  useEffect(() => {
    if (props.target?.container) {
      setContainer(props.target.container)
      setNavPrefix('')
      setSelection(new Set())
    } else if (props.target && props.target.container === null) {
      // Account row clicked — keep current container choice.
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.target?.tick])

  // Blob listing.
  useEffect(() => {
    if (!accountId || !container) return
    let cancelled = false
    setLoadingList(true)
    setError(null)
    window.api.storage
      .listBlobs({ accountId, container, prefix: navPrefix || undefined })
      .then((res) => {
        if (!cancelled) {
          setBlobs(res)
          setSelection(new Set())
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          fail(err)
          setBlobs(null)
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingList(false)
      })
    return () => {
      cancelled = true
    }
  }, [accountId, container, navPrefix])

  function reloadBlobs(): void {
    if (!accountId || !container) return
    setLoadingList(true)
    window.api.storage
      .listBlobs({ accountId, container, prefix: navPrefix || undefined })
      .then((res) => {
        setBlobs(res)
        setSelection(new Set())
      })
      .catch(fail)
      .finally(() => setLoadingList(false))
  }

  const scoped = Boolean(account?.containerName)
  const warn = sasWarning(account?.sasExpiry)

  const visible = useMemo(() => {
    const items = blobs?.items ?? []
    const q = props.globalQuery.trim().toLowerCase()
    const filtered = q === '' ? items : items.filter((i) => i.leaf.toLowerCase().includes(q))
    const sorted = [...filtered]
    sorted.sort((a, b) => {
      if (a.isPrefix !== b.isPrefix) return a.isPrefix ? -1 : 1
      let cmp = 0
      if (sortKey === 'name') cmp = a.leaf.localeCompare(b.leaf)
      else if (sortKey === 'size') cmp = (a.size ?? -1) - (b.size ?? -1)
      else cmp = (a.lastModified ?? '').localeCompare(b.lastModified ?? '')
      return cmp * sortDir
    })
    return sorted
  }, [blobs, props.globalQuery, sortKey, sortDir])

  const crumbs = useMemo(() => {
    const eff = blobs?.prefix ?? navPrefix
    return eff === '' ? [] : eff.split('/').filter(Boolean)
  }, [blobs, navPrefix])

  function toggleSort(key: SortKey): void {
    if (key === sortKey) setSortDir((d) => (d === 1 ? -1 : 1))
    else {
      setSortKey(key)
      setSortDir(1)
    }
  }

  function toggleOne(key: string): void {
    setSelection((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  /* ---------- CRUD actions ---------- */

  async function run(label: string, fn: () => Promise<string | void>): Promise<void> {
    if (!accountId) return
    setBusy(label)
    setError(null)
    try {
      const msg = await fn()
      if (msg) flash(msg)
      reloadBlobs()
    } catch (err) {
      fail(err)
    } finally {
      setBusy(null)
    }
  }

  function onNewContainer(): void {
    if (!accountId) return
    const name = window.prompt('New container name (lowercase, 3–63 chars):', '')
    if (!name?.trim()) return
    setBusy('container')
    window.api.storage
      .createContainer({ accountId, container: name.trim() })
      .then(() => {
        flash(`Container "${name.trim()}" created`)
        loadContainers(accountId, name.trim())
        props.onContainersChanged(accountId)
      })
      .catch(fail)
      .finally(() => setBusy(null))
  }

  function onDeleteContainer(): void {
    if (!accountId || !container) return
    if (!window.confirm(`Delete container "${container}" and everything in it?`)) return
    setBusy('container')
    window.api.storage
      .deleteContainer({ accountId, container })
      .then(() => {
        flash(`Container "${container}" deleted`)
        setContainer(null)
        setBlobs(null)
        loadContainers(accountId)
        props.onContainersChanged(accountId)
      })
      .catch(fail)
      .finally(() => setBusy(null))
  }

  function onNewFolder(): void {
    if (!accountId || !container) return
    const name = window.prompt('New folder name:', '')
    if (!name?.trim()) return
    void run('folder', async () => {
      await window.api.storage.createFolder({
        accountId,
        container,
        prefix: blobs?.prefix || undefined,
        folderName: name.trim()
      })
      return `Folder "${name.trim()}" created`
    })
  }

  function onUpload(): void {
    if (!accountId || !container) return
    setBusy('upload')
    window.api.storage
      .upload({ accountId, container, prefix: blobs?.prefix || undefined })
      .then((files) => {
        if (files.length > 0) {
          flash(`Uploaded ${files.length} file${files.length === 1 ? '' : 's'}`)
          reloadBlobs()
        }
      })
      .catch(fail)
      .finally(() => setBusy(null))
  }

  function onDownload(): void {
    if (!accountId || !container || selection.size === 0) return
    setBusy('download')
    window.api.storage
      .download({ accountId, container, names: [...selection] })
      .then((dir) => {
        if (dir) flash(`Downloaded to ${dir}`)
      })
      .catch(fail)
      .finally(() => setBusy(null))
  }

  function onDelete(): void {
    if (!accountId || !container || selection.size === 0) return
    const n = selection.size
    if (!window.confirm(`Delete ${n} item${n === 1 ? '' : 's'}?`)) return
    void run('delete', async () => {
      const count = await window.api.storage.deleteBlobs({
        accountId,
        container,
        names: [...selection]
      })
      return `Deleted ${count} item${count === 1 ? '' : 's'}`
    })
  }

  function onRename(): void {
    if (!accountId || !container) return
    const picked = [...selection].filter((k) => !k.endsWith('/'))
    if (picked.length !== 1) return
    const src = picked[0]!
    const currentLeaf = src.includes('/') ? src.slice(src.lastIndexOf('/') + 1) : src
    const next = window.prompt('Rename file to:', currentLeaf)
    if (!next?.trim() || next.trim() === currentLeaf) return
    void run('rename', async () => {
      await window.api.storage.renameBlob({
        accountId,
        container,
        source: src,
        destLeaf: next.trim()
      })
      return `Renamed to "${next.trim()}"`
    })
  }

  /* ---------- render ---------- */

  if (!account) {
    return (
      <section className="card empty-hero fade-in">
        <h2>Blobfish</h2>
        <p className="muted">Attach a storage account to browse containers and blobs.</p>
        <p className="muted small">Connection strings and SAS URLs stay encrypted in your OS keychain.</p>
      </section>
    )
  }

  const selectedFiles = [...selection].filter((k) => !k.endsWith('/'))
  const canRename = selectedFiles.length === 1 && selection.size === 1

  return (
    <div className="explorer fade-in" key={`${account.id}`}>
      <div className="card explorer-head">
        <div className="row between head-top">
          <div className="head-id">
            <h2>{account.name}</h2>
            <span className="muted small">
              <code>{account.endpoint}</code>
              {account.containerName && (
                <>
                  {' / '}<code>{account.containerName}</code>
                </>
              )}
            </span>
          </div>
          {warn && <span className="pill warn">{warn}</span>}
        </div>

        <div className="toolbar">
          <label className="container-pick">
            <span>Container</span>
            <select
              value={container ?? ''}
              disabled={loadingContainers || containers.length === 0}
              onChange={(e) => {
                setContainer(e.target.value || null)
                setNavPrefix('')
              }}
            >
              {containers.length === 0 && <option value="">—</option>}
              {containers.map((c) => (
                <option key={c.name} value={c.name}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          {!scoped && (
            <div className="row tight">
              <button className="btn ghost small" disabled={busy !== null} onClick={onNewContainer}>
                New container
              </button>
              <button
                className="btn ghost small"
                disabled={!container || busy !== null}
                onClick={onDeleteContainer}
              >
                Delete container
              </button>
            </div>
          )}
          <div className="toolbar-sep" />
          <div className="row tight">
            <button className="btn ghost small" disabled={!container || busy !== null} onClick={onNewFolder}>
              New folder
            </button>
            <button
              className="btn mint small"
              disabled={!container || busy !== null}
              onClick={onUpload}
            >
              {busy === 'upload' ? 'Uploading…' : 'Upload'}
            </button>
            <button
              className="btn ghost small"
              disabled={selection.size === 0 || busy !== null}
              onClick={onDownload}
            >
              Download{selection.size > 0 ? ` (${selection.size})` : ''}
            </button>
            <button
              className="btn ghost small"
              disabled={!canRename || busy !== null}
              onClick={onRename}
            >
              Rename
            </button>
            <button
              className="btn danger small"
              disabled={selection.size === 0 || busy !== null}
              onClick={onDelete}
            >
              Delete{selection.size > 0 ? ` (${selection.size})` : ''}
            </button>
            <button className="btn ghost small" disabled={busy !== null} onClick={reloadBlobs}>
              Refresh
            </button>
          </div>
        </div>

        {container && (
          <nav className="crumbs path" aria-label="Path">
            <button className="crumb root" onClick={() => setNavPrefix('')}>
              {container}
            </button>
            {crumbs.map((seg, i) => (
              <span key={i} className="crumb-seg">
                <span className="sep">/</span>
                <button className="crumb" onClick={() => setNavPrefix(crumbs.slice(0, i + 1).join('/'))}>
                  {seg}
                </button>
              </span>
            ))}
          </nav>
        )}
      </div>

      <div className="card explorer-body">
        {error && (
          <p className="error-text" role="alert">
            {error}
          </p>
        )}
        {loadingList ? (
          <ul className="skeleton">
            {Array.from({ length: 8 }, (_, i) => (
              <li key={i} style={{ animationDelay: `${i * 40}ms` }} />
            ))}
          </ul>
        ) : !container ? (
          <p className="muted empty-note">
            {containers.length > 1 ? 'Pick a container above to browse.' : 'Loading containers…'}
          </p>
        ) : visible.length === 0 ? (
          <div className="empty-note">
            <p className="muted">This folder is empty.</p>
            <div className="row">
              <button className="btn mint small" onClick={onUpload}>
                Upload files
              </button>
              <button className="btn ghost small" onClick={onNewFolder}>
                New folder
              </button>
            </div>
          </div>
        ) : (
          <table className="blob-table">
            <thead>
              <tr>
                <th className="check-col">
                  <input
                    type="checkbox"
                    aria-label="Select all"
                    checked={selection.size > 0 && selection.size === visible.length}
                    onChange={() =>
                      setSelection((prev) =>
                        prev.size === visible.length ? new Set() : new Set(visible.map(keyOf))
                      )
                    }
                  />
                </th>
                <Th label="Name" k="name" sortKey={sortKey} dir={sortDir} onSort={toggleSort} />
                <Th label="Size" k="size" sortKey={sortKey} dir={sortDir} onSort={toggleSort} />
                <Th label="Modified" k="modified" sortKey={sortKey} dir={sortDir} onSort={toggleSort} />
              </tr>
            </thead>
            <tbody>
              {visible.map((item, i) => {
                const key = keyOf(item)
                return (
                  <tr
                    key={key}
                    className={`row-in${selection.has(key) ? ' selected' : ''}`}
                    style={{ animationDelay: `${Math.min(i, 14) * 18}ms` }}
                  >
                    <td className="check-col">
                      <input
                        type="checkbox"
                        aria-label={`Select ${item.leaf}`}
                        checked={selection.has(key)}
                        onChange={() => toggleOne(key)}
                      />
                    </td>
                    <td className="name-col">
                      {item.isPrefix ? (
                        <button
                          className="linklike folder"
                          onClick={() =>
                            setNavPrefix(
                              blobs && blobs.prefix ? `${blobs.prefix}/${item.leaf}` : item.name
                            )
                          }
                        >
                          <span className="file-ico folder" aria-hidden />
                          {item.leaf}
                        </button>
                      ) : (
                        <span className="file-row" title={item.name}>
                          <span className="file-ico file" aria-hidden />
                          {item.leaf}
                        </span>
                      )}
                    </td>
                    <td className="num">{item.isPrefix ? '—' : formatBytes(item.size)}</td>
                    <td className="muted">
                      {item.lastModified ? new Date(item.lastModified).toLocaleString() : '—'}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      {notice && <div className="toast glass strong toast-in">{notice}</div>}
    </div>
  )
}

function Th(props: {
  label: string
  k: 'name' | 'size' | 'modified'
  sortKey: string
  dir: 1 | -1
  onSort: (k: 'name' | 'size' | 'modified') => void
}): React.JSX.Element {
  const active = props.sortKey === props.k
  return (
    <th>
      <button className={`th-btn${active ? ' active' : ''}`} onClick={() => props.onSort(props.k)}>
        {props.label}
        <span className="sort-arrow">{active ? (props.dir === 1 ? ' ↑' : ' ↓') : ''}</span>
      </button>
    </th>
  )
}
