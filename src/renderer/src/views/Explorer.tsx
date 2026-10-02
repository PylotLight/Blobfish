import { useEffect, useMemo, useState } from 'react'
import type {
  AccountSummary,
  ListBlobsResult,
  StorageBlobItem,
  StorageContainer
} from '../../../shared/types'
import type { SelectionTarget } from '../App'
import { ConfirmDialog, PromptDialog } from './Dialogs'

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
  onOpenContainer: (container: string) => void
  onChanged: () => void
  onContainersChanged: (accountId: string) => void
}): React.JSX.Element {
  const { account } = props
  const [containers, setContainers] = useState<StorageContainer[]>([])
  const [container, setContainer] = useState<string | null>(null)
  const [blobs, setBlobs] = useState<ListBlobsResult | null>(null)
  const [navPrefix, setNavPrefix] = useState('')
  const [backHist, setBackHist] = useState<string[]>([])
  const [fwdHist, setFwdHist] = useState<string[]>([])
  const [selection, setSelection] = useState<Set<string>>(new Set())
  const [filter, setFilter] = useState('')
  const [loadingList, setLoadingList] = useState(false)
  const [loadingContainers, setLoadingContainers] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [sortKey, setSortKey] = useState<SortKey>('name')
  const [sortDir, setSortDir] = useState<SortDir>(1)

  interface ConfirmState {
    title: string
    body?: string
    items?: string[]
    requireText?: string
    confirmLabel: string
    run: () => Promise<void>
  }

  interface PromptState {
    title: string
    label: string
    initial?: string
    placeholder?: string
    hint?: string
    confirmLabel: string
    validate?: (v: string) => string | null
    submit: (v: string) => Promise<void>
  }

  const [confirm, setConfirm] = useState<ConfirmState | null>(null)
  const [prompt, setPrompt] = useState<PromptState | null>(null)

  const accountId = account?.id

  function flash(message: string): void {
    setNotice(message)
    window.setTimeout(() => setNotice((n) => (n === message ? null : n)), 3200)
  }

  function fail(err: unknown): void {
    setError(err instanceof Error ? err.message : String(err))
  }

  function resetNav(): void {
    setNavPrefix('')
    setBackHist([])
    setFwdHist([])
    setSelection(new Set())
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
          if (cs.length === 1) return cs[0]?.name ?? null
          return null
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
    setFilter('')
    setError(null)
    resetNav()
    if (!accountId) return
    loadContainers(accountId, account?.containerName ?? props.target?.container ?? undefined)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountId])

  // Sidebar picks (account or container rows, or post-wizard selection).
  useEffect(() => {
    if (props.target?.container) {
      setContainer(props.target.container)
      resetNav()
    }
    // Account-row clicks pass container: null → stay where we are.
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

  /* ---------- prefix history ---------- */

  function go(next: string): void {
    setBackHist((h) => [...h, navPrefix])
    setFwdHist([])
    setNavPrefix(next)
    setSelection(new Set())
  }

  function goBack(): void {
    if (backHist.length === 0) return
    const prev = backHist[backHist.length - 1]!
    setBackHist((h) => h.slice(0, -1))
    setFwdHist((h) => [navPrefix, ...h])
    setNavPrefix(prev)
    setSelection(new Set())
  }

  function goForward(): void {
    if (fwdHist.length === 0) return
    const [next, ...rest] = fwdHist
    setFwdHist(rest)
    setBackHist((h) => [...h, navPrefix])
    setNavPrefix(next!)
    setSelection(new Set())
  }

  function goUp(): void {
    const segs = navPrefix.split('/').filter(Boolean)
    if (segs.length === 0) {
      // At container root → up means back to the container directory.
      setContainer(null)
      resetNav()
      return
    }
    go(segs.slice(0, -1).join('/'))
  }

  /* ---------- derived ---------- */

  const scoped = Boolean(account?.containerName)
  const warn = sasWarning(account?.sasExpiry)

  const visibleBlobs = useMemo(() => {
    const items = blobs?.items ?? []
    const q = filter.trim().toLowerCase()
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
  }, [blobs, filter, sortKey, sortDir])

  const visibleContainers = useMemo(() => {
    const q = filter.trim().toLowerCase()
    const filtered =
      q === '' ? containers : containers.filter((c) => c.name.toLowerCase().includes(q))
    const sorted = [...filtered]
    sorted.sort((a, b) =>
      sortKey === 'modified'
        ? (a.lastModified ?? '').localeCompare(b.lastModified ?? '') * sortDir
        : a.name.localeCompare(b.name) * sortDir
    )
    return sorted
  }, [containers, filter, sortKey, sortDir])

  const crumbs = useMemo(
    () => (navPrefix === '' ? [] : navPrefix.split('/').filter(Boolean)),
    [navPrefix]
  )

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

  function toggleAll(keys: string[]): void {
    setSelection((prev) => (prev.size === keys.length && keys.length > 0 ? new Set() : new Set(keys)))
  }

  /* ---------- CRUD ---------- */

  async function run(label: string, fn: () => Promise<string | void>): Promise<void> {
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
    setPrompt({
      title: 'New container',
      label: 'Container name',
      placeholder: 'mycontainer',
      hint: 'Lowercase letters, numbers and dashes · 3–63 chars.',
      confirmLabel: 'Create',
      validate: (v) =>
        /^[a-z0-9]([a-z0-9-]{1,61}[a-z0-9])?$/.test(v)
          ? null
          : 'Use 3–63 lowercase letters, numbers and dashes.',
      submit: async (v) => {
        setBusy('container')
        try {
          await window.api.storage.createContainer({ accountId, container: v })
          flash(`Container "${v}" created`)
          loadContainers(accountId, v)
          props.onContainersChanged(accountId)
        } catch (err) {
          fail(err)
          throw err
        } finally {
          setBusy(null)
        }
      }
    })
  }

  function onDeleteContainer(name: string): void {
    if (!accountId) return
    setConfirm({
      title: `Delete container "${name}"?`,
      body: 'Everything inside is permanently deleted. This cannot be undone.',
      requireText: name,
      confirmLabel: 'Delete',
      run: async () => {
        setBusy('container')
        try {
          await window.api.storage.deleteContainer({ accountId, container: name })
          flash(`Container "${name}" deleted`)
          if (container === name) {
            setContainer(null)
            setBlobs(null)
            resetNav()
          }
          loadContainers(accountId)
          props.onContainersChanged(accountId)
        } catch (err) {
          fail(err)
          throw err
        } finally {
          setBusy(null)
        }
      }
    })
  }

  function onNewFolder(): void {
    if (!accountId || !container) return
    setPrompt({
      title: 'New folder',
      label: 'Folder name',
      placeholder: 'reports',
      hint: 'A single folder level — slashes are not allowed.',
      confirmLabel: 'Create',
      validate: (v) =>
        v === '' || v.includes('/') ? 'Use a single folder name without slashes.' : null,
      submit: async (v) => {
        await run('folder', async () => {
          await window.api.storage.createFolder({
            accountId,
            container,
            prefix: blobs?.prefix || undefined,
            folderName: v
          })
          return `Folder "${v}" created`
        })
      }
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
    setConfirm({
      title: `Delete ${n} item${n === 1 ? '' : 's'}?`,
      body: 'Blobs are permanently deleted. Folders delete everything beneath them.',
      items: [...selection],
      confirmLabel: 'Delete',
      run: async () => {
        await run('delete', async () => {
          const count = await window.api.storage.deleteBlobs({
            accountId,
            container,
            names: [...selection]
          })
          return `Deleted ${count} item${count === 1 ? '' : 's'}`
        })
      }
    })
  }

  function onRename(): void {
    if (!accountId || !container) return
    const picked = [...selection].filter((k) => !k.endsWith('/'))
    if (picked.length !== 1) return
    const src = picked[0]!
    const currentLeaf = src.includes('/') ? src.slice(src.lastIndexOf('/') + 1) : src
    setPrompt({
      title: 'Rename file',
      label: 'New file name',
      initial: currentLeaf,
      confirmLabel: 'Rename',
      validate: (v) =>
        v === '' || v.includes('/') ? 'Use a file name without slashes.' : null,
      submit: async (v) => {
        if (v === currentLeaf) return
        await run('rename', async () => {
          await window.api.storage.renameBlob({
            accountId,
            container,
            source: src,
            destLeaf: v
          })
          return `Renamed to "${v}"`
        })
      }
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

  const actionBar = (
    <div className="actionbar" role="toolbar" aria-label="Blob actions">
      <Action icon="↑" label="Upload" primary onClick={onUpload} disabled={!container || busy !== null} working={busy === 'upload'} workingLabel="Uploading…" />
      <Action icon="↓" label={`Download${selection.size > 0 ? ` (${selection.size})` : ''}`} onClick={onDownload} disabled={selection.size === 0 || busy !== null} />
      <Action icon="+" label="New folder" onClick={onNewFolder} disabled={!container || busy !== null} />
      <Action icon="☑" label="Select all" onClick={() => toggleAll(visibleBlobs.map(keyOf))} disabled={visibleBlobs.length === 0} />
      <span className="action-sep" aria-hidden />
      <Action icon="✎" label="Rename" onClick={onRename} disabled={!canRename || busy !== null} />
      <Action icon="✕" label={`Delete${selection.size > 0 ? ` (${selection.size})` : ''}`} danger onClick={onDelete} disabled={selection.size === 0 || busy !== null} />
      <span className="action-sep" aria-hidden />
      <Action icon="↻" label="Refresh" onClick={reloadBlobs} disabled={!container || busy !== null} />
    </div>
  )

  const navRow = (
    <div className="navrow">
      <div className="nav-btns">
        <button className="nav-btn" onClick={goBack} disabled={backHist.length === 0} title="Back" aria-label="Back">←</button>
        <button className="nav-btn" onClick={goForward} disabled={fwdHist.length === 0} title="Forward" aria-label="Forward">→</button>
        <button className="nav-btn" onClick={goUp} disabled={!container} title="Up" aria-label="Up">↑</button>
      </div>
      <nav className="address" aria-label="Path">
        <button className="crumb addr-acct" onClick={() => { setContainer(null); resetNav() }} title={account.name}>
          {account.containerName ?? account.accountName ?? account.name}
        </button>
        {container && (
          <>
            <span className="sep">/</span>
            <button className="crumb root" onClick={() => go('')}>
              {container}
            </button>
          </>
        )}
        {crumbs.map((seg, i) => (
          <span key={i} className="crumb-seg">
            <span className="sep">/</span>
            <button className="crumb" onClick={() => go(crumbs.slice(0, i + 1).join('/'))}>
              {seg}
            </button>
          </span>
        ))}
      </nav>
      <label className="addr-filter">
        <span aria-hidden>⌕</span>
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter…"
          aria-label="Filter current view"
        />
      </label>
    </div>
  )

  // ----- account level: container directory -----
  if (!container) {
    return (
      <div className="explorer fade-in">
        <div className="card explorer-head">
          <div className="row between head-top">
            <div className="head-id">
              <span className="eyebrow">Storage account</span>
              <h2>{account.name}</h2>
              <span className="muted small">
                <code>{account.endpoint}</code>
              </span>
            </div>
            <div className="row tight">
              {warn && <span className="pill warn">{warn}</span>}
              {!scoped && (
                <button className="btn mint small" disabled={busy !== null} onClick={onNewContainer}>
                  New container
                </button>
              )}
            </div>
          </div>
          {navRow}
        </div>

        <div className="card explorer-body">
          {error && <p className="error-text" role="alert">{error}</p>}
          {loadingContainers ? (
            <ul className="skeleton">
              {Array.from({ length: 8 }, (_, i) => (
                <li key={i} style={{ animationDelay: `${i * 40}ms` }} />
              ))}
            </ul>
          ) : visibleContainers.length === 0 ? (
            <div className="empty-note">
              <p className="muted">No containers{filter ? ` matching "${filter}"` : ''}.</p>
              {!scoped && (
                <button className="btn mint small" onClick={onNewContainer}>
                  New container
                </button>
              )}
            </div>
          ) : (
            <table className="blob-table dir-table table-in">
              <thead>
                <tr>
                  <Th label="Name" k="name" sortKey={sortKey} dir={sortDir} onSort={toggleSort} wide />
                  <Th label="Last Modified" k="modified" sortKey={sortKey} dir={sortDir} onSort={toggleSort} />
                  {!scoped && <th><span className="sr">Actions</span></th>}
                </tr>
              </thead>
              <tbody>
                {visibleContainers.map((c, i) => (
                  <tr
                    key={c.name}
                    className="row-in clickable"
                    style={{ animationDelay: `${Math.min(i, 10) * 12}ms` }}
                    onClick={() => props.onOpenContainer(c.name)}
                  >
                    <td className="name-col">
                      <span className="file-row">
                        <span className="file-ico container-lg" aria-hidden />
                        {c.name}
                      </span>
                    </td>
                    <td className="muted">
                      {c.lastModified ? new Date(c.lastModified).toLocaleString() : '—'}
                    </td>
                    {!scoped && (
                      <td className="row-act" onClick={(e) => e.stopPropagation()}>
                        <button
                          className="mini-btn danger-x"
                          title={`Delete container "${c.name}"`}
                          onClick={() => onDeleteContainer(c.name)}
                        >
                          ✕
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        {confirm && (
        <ConfirmDialog
          title={confirm.title}
          body={confirm.body}
          items={confirm.items}
          requireText={confirm.requireText}
          confirmLabel={confirm.confirmLabel}
          onCancel={() => setConfirm(null)}
          onConfirm={confirm.run}
        />
      )}
      {prompt && (
        <PromptDialog
          title={prompt.title}
          label={prompt.label}
          initial={prompt.initial}
          placeholder={prompt.placeholder}
          hint={prompt.hint}
          confirmLabel={prompt.confirmLabel}
          validate={prompt.validate}
          onCancel={() => setPrompt(null)}
          onSubmit={prompt.submit}
        />
      )}
      {notice && <div className="toast glass strong toast-in">{notice}</div>}
      </div>
    )
  }

  // ----- container level: blob browser -----
  return (
    <div className="explorer fade-in">
      <div className="card explorer-head">
        <div className="row between head-top">
          <div className="head-id">
            <span className="eyebrow">Blob container</span>
            <h2>{container}</h2>
          </div>
          <div className="row tight">
            {warn && <span className="pill warn">{warn}</span>}
            {!scoped && (
              <button
                className="btn ghost small"
                disabled={busy !== null}
                onClick={() => onDeleteContainer(container)}
                title="Delete this container and everything in it"
              >
                Delete container
              </button>
            )}
          </div>
        </div>
        {actionBar}
        {navRow}
      </div>

      <div className="card explorer-body">
        {error && <p className="error-text" role="alert">{error}</p>}
        {loadingList ? (
          <ul className="skeleton">
            {Array.from({ length: 8 }, (_, i) => (
              <li key={i} style={{ animationDelay: `${i * 40}ms` }} />
            ))}
          </ul>
        ) : visibleBlobs.length === 0 ? (
          <div className="empty-note">
            <p className="muted">This folder is empty{filter ? ` (nothing matches "${filter}")` : ''}.</p>
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
          <table className="blob-table table-in">
            <thead>
              <tr>
                <th className="check-col">
                  <input
                    type="checkbox"
                    aria-label="Select all"
                    checked={selection.size > 0 && selection.size === visibleBlobs.length}
                    onChange={() => toggleAll(visibleBlobs.map(keyOf))}
                  />
                </th>
                <Th label="Name" k="name" sortKey={sortKey} dir={sortDir} onSort={toggleSort} wide />
                <Th label="Size" k="size" sortKey={sortKey} dir={sortDir} onSort={toggleSort} />
                <Th label="Last Modified" k="modified" sortKey={sortKey} dir={sortDir} onSort={toggleSort} />
              </tr>
            </thead>
            <tbody>
              {visibleBlobs.map((item, i) => {
                const key = keyOf(item)
                return (
                  <tr
                    key={key}
                    className={`row-in${selection.has(key) ? ' selected' : ''}`}
                    style={{ animationDelay: `${Math.min(i, 10) * 12}ms` }}
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
                          onClick={() => go(blobs && blobs.prefix ? `${blobs.prefix}/${item.leaf}` : item.name)}
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

      {confirm && (
        <ConfirmDialog
          title={confirm.title}
          body={confirm.body}
          items={confirm.items}
          requireText={confirm.requireText}
          confirmLabel={confirm.confirmLabel}
          onCancel={() => setConfirm(null)}
          onConfirm={confirm.run}
        />
      )}
      {prompt && (
        <PromptDialog
          title={prompt.title}
          label={prompt.label}
          initial={prompt.initial}
          placeholder={prompt.placeholder}
          hint={prompt.hint}
          confirmLabel={prompt.confirmLabel}
          validate={prompt.validate}
          onCancel={() => setPrompt(null)}
          onSubmit={prompt.submit}
        />
      )}
      {notice && <div className="toast glass strong toast-in">{notice}</div>}
    </div>
  )
}

function Action(props: {
  icon: string
  label: string
  onClick: () => void
  disabled?: boolean
  primary?: boolean
  danger?: boolean
  working?: boolean
  workingLabel?: string
}): React.JSX.Element {
  return (
    <button
      className={`action${props.primary ? ' primary' : ''}${props.danger ? ' danger' : ''}`}
      onClick={props.onClick}
      disabled={props.disabled}
    >
      <span className="action-icon" aria-hidden>
        {props.icon}
      </span>
      {props.working ? (props.workingLabel ?? props.label) : props.label}
    </button>
  )
}

function Th(props: {
  label: string
  k: 'name' | 'size' | 'modified'
  sortKey: string
  dir: 1 | -1
  onSort: (k: 'name' | 'size' | 'modified') => void
  wide?: boolean
}): React.JSX.Element {
  const active = props.sortKey === props.k
  return (
    <th className={props.wide ? 'wide' : ''}>
      <button className={`th-btn${active ? ' active' : ''}`} onClick={() => props.onSort(props.k)}>
        {props.label}
        <span className="sort-arrow">{active ? (props.dir === 1 ? ' ↑' : ' ↓') : ''}</span>
      </button>
    </th>
  )
}
