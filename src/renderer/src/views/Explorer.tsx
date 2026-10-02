import { useEffect, useMemo, useState } from 'react'
import type {
  AccountCreateInput,
  AccountSummary,
  ListBlobsResult,
  StorageBlobItem,
  StorageContainer,
  StorageKind
} from '../../../shared/types'

const KIND_META: Record<StorageKind, { title: string; desc: string }> = {
  account: {
    title: 'Storage account or service',
    desc: 'Attach to one or more services in a Storage account.'
  },
  'blob-container': {
    title: 'Blob container or directory',
    desc: 'Attach to an individual Blob container or directory.'
  },
  'adls-container': {
    title: 'ADLS Gen2 container or directory',
    desc: 'Attach to an individual ADLS Gen2 container or directory.'
  }
}

function kindLabel(kind: StorageKind): string {
  return KIND_META[kind].title
}

function sasWarning(expiry?: string | null): string | null {
  if (!expiry) return null
  const ms = Date.parse(expiry)
  if (Number.isNaN(ms)) return null
  const now = Date.now()
  if (ms <= now) return `SAS expired ${new Date(ms).toLocaleDateString()}`
  const days = Math.ceil((ms - now) / 86_400_000)
  if (days <= 14) return `SAS expires in ${days}d (${new Date(ms).toLocaleDateString()})`
  return null
}

function formatBytes(n?: number): string {
  if (n === undefined) return '—'
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`
}

/* ---------------- Add-account dialog ---------------- */

export function AddAccountDialog(props: {
  onClose: () => void
  onAdded: (a: AccountSummary) => void
}): React.JSX.Element {
  const [name, setName] = useState('')
  const [kind, setKind] = useState<StorageKind>('account')
  const [secret, setSecret] = useState('')
  const [containerName, setContainerName] = useState('')
  const [prefix, setPrefix] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const needsContainerField = kind !== 'account'
  const secretLooksLikeConnStr =
    secret.includes('AccountName=') || secret.includes('DefaultEndpointsProtocol=')

  async function submit(): Promise<void> {
    setBusy(true)
    setError(null)
    try {
      const input: AccountCreateInput = {
        name: name.trim(),
        kind,
        secret: secret.trim(),
        containerName: containerName.trim() || undefined,
        prefix: prefix.trim() || undefined
      }
      const added = await window.api.accounts.add(input)
      props.onAdded(added)
      props.onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const canSubmit = name.trim() !== '' && secret.trim() !== '' && !busy

  return (
    <div className="modal-backdrop" onClick={props.onClose}>
      <div
        className="modal glass strong connect-modal"
        role="dialog"
        aria-label="Attach storage"
        onClick={(e) => e.stopPropagation()}
      >
        <h3>Attach storage</h3>
        <p className="muted">Secrets are encrypted with the OS keychain — never stored in plaintext.</p>

        <div className="kind-list" role="radiogroup" aria-label="Attach type">
          {(Object.keys(KIND_META) as StorageKind[]).map((k) => (
            <button
              key={k}
              role="radio"
              aria-checked={kind === k}
              className={`kind-row${kind === k ? ' selected' : ''}`}
              onClick={() => setKind(k)}
            >
              <span className={`kind-icon ${k}`} aria-hidden />
              <span className="kind-text">
                <span className="kind-title">{KIND_META[k].title}</span>
                <span className="kind-desc">{KIND_META[k].desc}</span>
              </span>
            </button>
          ))}
        </div>

        <label className="field">
          <span>Display name</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. prod blobs"
          />
        </label>

        <label className="field">
          <span>Connection string or SAS URL</span>
          <textarea
            className="secret-input"
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
            placeholder={
              kind === 'account'
                ? 'DefaultEndpointsProtocol=https;AccountName=…;AccountKey=…  — or —  https://myacct.blob.core.windows.net/?sv=…&sig=…'
                : 'https://myacct.blob.core.windows.net/mycontainer?sv=…&sig=…'
            }
            rows={3}
          />
        </label>

        {(needsContainerField || secretLooksLikeConnStr) && (
          <label className="field">
            <span>Container name{needsContainerField ? ' (required for connection strings)' : ''}</span>
            <input
              value={containerName}
              onChange={(e) => setContainerName(e.target.value)}
              placeholder="mycontainer"
            />
          </label>
        )}

        {needsContainerField && (
          <label className="field">
            <span>Directory prefix (optional)</span>
            <input
              value={prefix}
              onChange={(e) => setPrefix(e.target.value)}
              placeholder="uploads/2026"
            />
          </label>
        )}

        {error && <p className="error-text">{error}</p>}

        <div className="row end">
          <button className="btn ghost" onClick={props.onClose} disabled={busy}>
            Cancel
          </button>
          <button className="btn mint" onClick={() => void submit()} disabled={!canSubmit}>
            {busy ? 'Attaching…' : 'Attach'}
          </button>
        </div>
      </div>
    </div>
  )
}

/* ---------------- Explorer (containers → blobs) ---------------- */

export default function Explorer(props: {
  accounts: AccountSummary[]
  selected: AccountSummary | null
  onSelect: (id: string) => void
  onChanged: () => void
  globalQuery: string
}): React.JSX.Element {
  const { accounts, selected } = props
  const [containers, setContainers] = useState<StorageContainer[]>([])
  const [container, setContainer] = useState<string | null>(null)
  const [blobs, setBlobs] = useState<ListBlobsResult | null>(null)
  const [navPrefix, setNavPrefix] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [localFilter, setLocalFilter] = useState('')

  // Load containers when the selected account changes.
  useEffect(() => {
    setContainers([])
    setContainer(null)
    setBlobs(null)
    setNavPrefix('')
    setError(null)
    if (!selected) return
    let cancelled = false
    setLoading(true)
    window.api.storage
      .listContainers(selected.id)
      .then((cs) => {
        if (cancelled) return
        setContainers(cs)
        // Scoped attachment or single container: dive straight in.
        const initial =
          selected.containerName ?? (cs.length === 1 ? cs[0]?.name ?? null : null)
        setContainer(initial)
        if (cs.length === 0) setError('No containers found.')
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [selected])

  // Load blobs when container / prefix changes.
  useEffect(() => {
    if (!selected || !container) return
    let cancelled = false
    setLoading(true)
    setError(null)
    window.api.storage
      .listBlobs({ accountId: selected.id, container, prefix: navPrefix || undefined })
      .then((res) => {
        if (!cancelled) setBlobs(res)
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err))
          setBlobs(null)
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [selected, container, navPrefix])

  const query = (props.globalQuery || localFilter).toLowerCase()
  const visible: StorageBlobItem[] = useMemo(() => {
    if (!blobs) return []
    if (query.trim() === '') return blobs.items
    return blobs.items.filter((i) => i.leaf.toLowerCase().includes(query))
  }, [blobs, query])

  const crumbs = useMemo(() => {
    const eff = blobs?.prefix ?? navPrefix
    if (!eff) return []
    return eff.split('/').filter(Boolean)
  }, [blobs, navPrefix])

  if (!selected) {
    return (
      <section className="card span2">
        <h2>Storage explorer</h2>
        <p className="muted">
          {accounts.length === 0
            ? 'No storage attached yet. Click “Attach storage” in the sidebar to add a connection string or SAS URL.'
            : 'Select a storage account in the sidebar to browse its containers.'}
        </p>
      </section>
    )
  }

  const warn = sasWarning(selected.sasExpiry)

  return (
    <div className="explorer">
      <div className="card">
        <div className="row between">
          <h2>
            {selected.name} <span className="muted">· {kindLabel(selected.kind)}</span>
          </h2>
          {warn && <span className="pill warn">{warn}</span>}
        </div>
        <p className="muted endpoint-line">
          <code>{selected.endpoint}</code>
          {selected.containerName && (
            <>
              {' / '}
              <code>{selected.containerName}</code>
            </>
          )}
          {selected.prefix && (
            <>
              {' / '}
              <code>{selected.prefix}</code>
            </>
          )}
        </p>

        <div className="row wrap">
          <button className="btn ghost" onClick={() => props.onChanged()}>
            Refresh
          </button>
          <button
            className="btn ghost"
            onClick={() => {
              if (!selected) return
              const next = window.prompt('Rename attachment', selected.name)
              if (next && next.trim() !== '') {
                void window.api.accounts
                  .update(selected.id, { name: next.trim() })
                  .then(() => props.onChanged())
                  .catch((err: unknown) =>
                    setError(err instanceof Error ? err.message : String(err))
                  )
              }
            }}
          >
            Rename
          </button>
          <button
            className="btn danger"
            onClick={() => {
              if (!selected) return
              if (!window.confirm(`Detach "${selected.name}"? The stored secret is deleted.`)) return
              void window.api.accounts
                .remove(selected.id)
                .then(() => props.onChanged())
                .catch((err: unknown) =>
                  setError(err instanceof Error ? err.message : String(err))
                )
            }}
          >
            Detach
          </button>
        </div>

        <h3 className="section-label">Containers</h3>
        {containers.length === 0 && !loading && !error && (
          <p className="muted">No containers.</p>
        )}
        <div className="container-chips">
          {containers.map((c) => (
            <button
              key={c.name}
              className={`chip${container === c.name ? ' active' : ''}`}
              onClick={() => {
                setContainer(c.name)
                setNavPrefix('')
              }}
            >
              {c.name}
            </button>
          ))}
        </div>
        {selected.kind !== 'account' && containers.length <= 1 && (
          <p className="muted small">Scoped attachment — only this container is visible.</p>
        )}
      </div>

      <div className="card">
        <div className="row between">
          <h2>
            Blobs{container ? (
              <>
                {' in '}<code>{container}</code>
              </>
            ) : (
              ''
            )}
          </h2>
          <input
            className="narrow-filter"
            value={localFilter}
            onChange={(e) => setLocalFilter(e.target.value)}
            placeholder="Filter…"
            aria-label="Filter blobs"
          />
        </div>

        {crumbs.length > 0 && (
          <div className="crumbs">
            <button
              className="crumb"
              onClick={() => setNavPrefix('')}
            >
              root
            </button>
            {crumbs.map((seg, i) => (
              <span key={i}>
                {' / '}
                <button
                  className="crumb"
                  onClick={() => setNavPrefix(crumbs.slice(0, i + 1).join('/'))}
                >
                  {seg}
                </button>
              </span>
            ))}
          </div>
        )}

        {loading && <p className="muted">Loading…</p>}
        {error && <p className="error-text">{error}</p>}
        {!loading && !error && container && visible.length === 0 && (
          <p className="muted">Empty{blobs?.prefix ? ` under "${blobs.prefix}"` : ''}.</p>
        )}
        {!container && !loading && <p className="muted">Pick a container above.</p>}

        {visible.length > 0 && (
          <table className="blob-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Size</th>
                <th>Modified</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((item) => (
                <tr key={item.name}>
                  <td>
                    {item.isPrefix ? (
                      <button
                        className="linklike"
                        onClick={() =>
                          setNavPrefix(blobs ? joinNav(blobs.prefix, item.leaf) : item.name)
                        }
                        title={`Open ${item.name}/`}
                      >
                        📁 {item.leaf}
                      </button>
                    ) : (
                      <span title={item.name}>
                        {item.contentType?.startsWith('image/') ? '🖼️' : '📄'} {item.leaf}
                      </span>
                    )}
                  </td>
                  <td className="num">{item.isPrefix ? '—' : formatBytes(item.size)}</td>
                  <td className="muted">
                    {item.lastModified ? new Date(item.lastModified).toLocaleString() : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}

function joinNav(base: string, leaf: string): string {
  return [base, leaf].filter(Boolean).join('/').replace(/^\/+|\/+$/g, '')
}
