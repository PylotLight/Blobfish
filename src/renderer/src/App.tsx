import { useCallback, useEffect, useState } from 'react'
import { APP_NAME, APP_TAGLINE } from '../../shared/config'
import type { AccountSummary, StorageContainer, SysInfo } from '../../shared/types'
import logoUrl from './assets/logo.png'
import Explorer from './views/Explorer'
import ConnectWizard from './views/ConnectWizard'
import TransfersPanel from './views/TransfersPanel'
import { ConfirmDialog, PromptDialog } from './views/Dialogs'
import { DEFAULT_PREFS, accentVars, loadPrefs, savePrefs, SettingsView, type Prefs } from './views/Settings'

export interface SelectionTarget {
  accountId: string
  container: string | null
  tick: number
}

export default function App(): React.JSX.Element {
  const [accounts, setAccounts] = useState<AccountSummary[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [target, setTarget] = useState<SelectionTarget | null>(null)
  const [showWizard, setShowWizard] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [prefs, setPrefs] = useState<Prefs>(() => loadPrefs())
  const [platform, setPlatform] = useState<SysInfo['platform'] | null>(null)
  const [encAvailable, setEncAvailable] = useState<boolean | null>(null)
  const [appVersion, setAppVersion] = useState<string | null>(null)
  const [sidebarWidth, setSidebarWidth] = useState<number>(() => {
    const saved = localStorage.getItem('blobfish.sidebarWidth')
    if (saved) {
      const parsed = parseInt(saved, 10)
      if (!Number.isNaN(parsed) && parsed >= 260 && parsed <= 600) return parsed
    }
    return 340
  })
  const [isDraggingSidebar, setIsDraggingSidebar] = useState(false)

  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const [containersCache, setContainersCache] = useState<Record<string, StorageContainer[]>>({})
  const [loadingContainers, setLoadingContainers] = useState<Record<string, boolean>>({})
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [detachFor, setDetachFor] = useState<AccountSummary | null>(null)
  const [createFor, setCreateFor] = useState<string | null>(null)
  const [renameContainerFor, setRenameContainerFor] = useState<{ accountId: string; name: string } | null>(null)
  const [deleteContainerFor, setDeleteContainerFor] = useState<{ accountId: string; name: string } | null>(null)
  const [quickOpen, setQuickOpen] = useState(true)
  const [allOpen, setAllOpen] = useState(true)

  const refreshAccounts = useCallback(() => {
    window.api.accounts
      .list()
      .then((list) => {
        setAccounts(list)
        setSelectedId((prev) => {
          if (prev && list.some((a) => a.id === prev)) return prev
          return list[0]?.id ?? null
        })
      })
      .catch(console.error)
  }, [])

  useEffect(() => {
    refreshAccounts()
    window.api.sys.info().then((s) => setPlatform(s.platform)).catch(console.error)
    window.api.accounts.encryption().then(setEncAvailable).catch(() => setEncAvailable(false))
    window.api.app.version().then(setAppVersion).catch(() => setAppVersion(null))
  }, [refreshAccounts])

  // Persist prefs + apply native vibrancy (macOS only; harmless elsewhere).
  useEffect(() => {
    savePrefs(prefs)
    if (platform === 'darwin') {
      window.api.glass.set(prefs.vibrancy ? 'fullscreen-ui' : null).catch(console.error)
    }
    window.api.transfers
      .configure({ uploadConcurrency: prefs.uploadConcurrency, maxParallel: prefs.maxParallel })
      .catch(console.error)
  }, [prefs, platform])

  // Drag-to-resize sidebar width
  useEffect(() => {
    if (!isDraggingSidebar) return
    const handleMouseMove = (e: MouseEvent) => {
      const maxW = Math.min(640, Math.floor(window.innerWidth * 0.55))
      const newWidth = Math.max(260, Math.min(maxW, e.clientX))
      setSidebarWidth(newWidth)
    }
    const handleMouseUp = () => {
      setIsDraggingSidebar(false)
      localStorage.setItem('blobfish.sidebarWidth', String(sidebarWidth))
    }
    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
  }, [isDraggingSidebar, sidebarWidth])

  function updatePrefs(next: Prefs): void {
    // Reset to defaults keeps one obvious escape hatch if a theme misbehaves.
    setPrefs({ ...DEFAULT_PREFS, ...next })
  }

  const ensureContainers = useCallback((accountId: string) => {
    setContainersCache((prev) => {
      if (prev[accountId]) return prev
      void window.api.storage
        .listContainers(accountId)
        .then((cs) => setContainersCache((p) => ({ ...p, [accountId]: cs })))
        .catch(() => setContainersCache((p) => ({ ...p, [accountId]: [] })))
        .finally(() =>
          setLoadingContainers((p) => ({ ...p, [accountId]: false }))
        )
      setLoadingContainers((p) => ({ ...p, [accountId]: true }))
      return prev
    })
  }, [])

  function toggleExpand(accountId: string): void {
    setExpanded((prev) => {
      const next = !prev[accountId]
      if (next) ensureContainers(accountId)
      return { ...prev, [accountId]: next }
    })
  }

  function selectAccount(accountId: string, container: string | null = null): void {
    setSelectedId(accountId)
    setTarget((t) => ({ accountId, container, tick: (t?.tick ?? 0) + 1 }))
  }

  function invalidateContainers(accountId: string): void {
    setContainersCache((prev) => {
      const next = { ...prev }
      delete next[accountId]
      return next
    })
    if (expanded[accountId]) ensureContainers(accountId)
  }

  async function commitRename(id: string): Promise<void> {
    const value = renameValue.trim()
    setRenamingId(null)
    if (value === '') return
    try {
      await window.api.accounts.update(id, { name: value })
      refreshAccounts()
    } catch (err) {
      console.error(err)
    }
  }

  const selected = accounts.find((a) => a.id === selectedId) ?? null
  const pinned = accounts.filter((a) => a.pinned)
  const unpinned = accounts.filter((a) => !a.pinned)

  function accountRow(a: AccountSummary): React.JSX.Element {
    const isActive = a.id === selectedId
    const isOpen = expanded[a.id] ?? false
    const cached = containersCache[a.id]
    const loading = loadingContainers[a.id] ?? false
    const canManageContainers = a.kind === 'account' && !a.containerName
    const leaves = (
      <>
        {loading && <li className="tree-loading">Loading…</li>}
        {!loading && cached?.length === 0 && <li className="tree-loading">No containers.</li>}
        {cached?.map((c) => (
          <li key={c.name} className="tree-leaf-row">
            <button
              className={`tree-leaf${target?.accountId === a.id && target.container === c.name ? ' active' : ''}`}
              onClick={() => selectAccount(a.id, c.name)}
              title={c.name}
            >
              <span className="kind-ico container" aria-hidden />
              <span className="leaf-name">{c.name}</span>
            </button>
            {canManageContainers && (
              <span className="leaf-actions">
                <button
                  className="mini-btn"
                  title={`Rename container "${c.name}"`}
                  onClick={() => setRenameContainerFor({ accountId: a.id, name: c.name })}
                >
                  ✎
                </button>
                <button
                  className="mini-btn danger-x"
                  title={`Delete container "${c.name}"`}
                  onClick={() => setDeleteContainerFor({ accountId: a.id, name: c.name })}
                >
                  ✕
                </button>
              </span>
            )}
          </li>
        ))}
      </>
    )
    return (
      <li key={a.id} className="tree-account">
        <div className={`tree-row${isActive ? ' active' : ''}`}>
          <button
            className={`twisty${isOpen ? ' open' : ''}`}
            onClick={() => toggleExpand(a.id)}
            aria-label={isOpen ? 'Collapse' : 'Expand'}
          >
            ›
          </button>
          <button
            className="tree-main"
            onClick={() => {
              selectAccount(a.id)
              if (!isOpen) toggleExpand(a.id)
            }}
            title={`${a.name}\n${a.containerName ? `Container: ${a.containerName}\n` : ''}Endpoint: ${a.endpoint}`}
          >
            <span className={`kind-ico ${a.kind}`} aria-hidden />
            <span className="tree-text">
              {renamingId === a.id ? (
                <input
                  className="rename-input"
                  value={renameValue}
                  autoFocus
                  onChange={(e) => setRenameValue(e.target.value)}
                  onBlur={() => void commitRename(a.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void commitRename(a.id)
                    if (e.key === 'Escape') setRenamingId(null)
                  }}
                  onClick={(e) => e.stopPropagation()}
                />
              ) : (
                <span className="account-name" title={a.name}>{a.name}</span>
              )}
              <span className="account-sub" title={a.containerName ?? a.accountName ?? hostOf(a.endpoint)}>
                {a.containerName ?? a.accountName ?? hostOf(a.endpoint)}
              </span>
            </span>
          </button>
          <span className="tree-actions">
            <button
              className={`mini-btn${a.pinned ? ' on' : ''}`}
              title={a.pinned ? 'Unpin from Quick Access' : 'Pin to Quick Access'}
              onClick={() =>
                window.api.accounts
                  .pin(a.id, !a.pinned)
                  .then(() => refreshAccounts())
                  .catch(console.error)
              }
            >
              {a.pinned ? '★' : '☆'}
            </button>
            <button
              className="mini-btn"
              title="Rename"
              onClick={() => {
                setRenamingId(a.id)
                setRenameValue(a.name)
              }}
            >
              ✎
            </button>
            <button
              className="mini-btn danger-x"
              title="Detach (deletes stored secret)"
              onClick={() => setDetachFor(a)}
            >
              ✕
            </button>
          </span>
        </div>
        {isOpen && a.kind === 'account' && (
          <ul className="tree-containers">
            <li className="group-row">
              <span className="kind-ico service" aria-hidden />
              Blob Containers
              {cached && <span className="count">{cached.length}</span>}
              <button
                className="mini-btn group-add"
                title="New container in this account"
                onClick={() => setCreateFor(a.id)}
              >
                +
              </button>
            </li>
            {leaves}
          </ul>
        )}
        {isOpen && a.kind !== 'account' && <ul className="tree-containers">{leaves}</ul>}
      </li>
    )
  }

  return (
    <div
      className="shell"
      data-platform={platform ?? 'unknown'}
      data-theme={prefs.theme}
      data-accent={prefs.accent}
      data-density={prefs.density}
      data-motion={prefs.motion}
      style={accentVars(prefs) as React.CSSProperties}
    >
      <aside className="sidebar" style={{ width: `${sidebarWidth}px` }}>
        <div className="traffic-spacer" aria-hidden />
        <div className="brand">
          <div className="brand-logo-frame">
            <img src={logoUrl} alt="Blobfish" className="brand-logo-img" />
          </div>
          <div className="brand-details">
            <div className="brand-name-row">
              <h1 className="brand-title">{APP_NAME}</h1>
              <span className="brand-badge">Azure</span>
            </div>
            <p className="brand-tagline">{APP_TAGLINE}</p>
          </div>
        </div>

        <button className="btn mint attach-cta" onClick={() => setShowWizard(true)}>
          + New connection
        </button>
        {encAvailable === false && (
          <p className="error-text small">Keychain encryption unavailable — attach disabled.</p>
        )}

        <div className="tree-scroll">
          {pinned.length > 0 && (
            <section className="tree-section">
              <button className="section-toggle" onClick={() => setQuickOpen((v) => !v)}>
                <span className={`twisty${quickOpen ? ' open' : ''}`}>›</span>
                <span className="star">★</span> Quick Access
              </button>
              {quickOpen && <ul className="tree">{pinned.map(accountRow)}</ul>}
            </section>
          )}

          <section className="tree-section">
            <button className="section-toggle" onClick={() => setAllOpen((v) => !v)}>
              <span className={`twisty${allOpen ? ' open' : ''}`}>›</span>
              Storage accounts
              <span className="count">{accounts.length}</span>
            </button>
            {allOpen && (
              accounts.length === 0 ? (
                <div className="empty-sidebar-card">
                  <p className="empty-sidebar-title">No storage accounts</p>
                  <p className="muted small empty-note">
                    Connect with a connection string, SAS URL, or account key to get started.
                  </p>
                </div>
              ) : (
                <ul className="tree">{(pinned.length > 0 ? unpinned : accounts).map(accountRow)}</ul>
              )
            )}
          </section>
        </div>

        <div className="side-foot">
          <button className="settings-btn" onClick={() => setShowSettings(true)}>
            <span aria-hidden>⚙</span> Settings
          </button>
          <span className="status-sub">
            {accounts.length} {accounts.length === 1 ? 'connection' : 'connections'} · OS Keychain encrypted{appVersion ? ` · v${appVersion}` : ''}
          </span>
        </div>
      </aside>

      <div
        className={`sidebar-resizer${isDraggingSidebar ? ' dragging' : ''}`}
        onMouseDown={(e) => {
          e.preventDefault()
          setIsDraggingSidebar(true)
        }}
        onDoubleClick={() => {
          setSidebarWidth((w) => (w > 360 ? 300 : 440))
        }}
        title="Drag to resize sidebar · Double-click to toggle width"
        aria-label="Resize sidebar"
      />

      <div className="content no-topbar">
        <main className="view">
          {showSettings ? (
            <SettingsView
              prefs={prefs}
              vibrancySupported={platform === 'darwin'}
              onChange={updatePrefs}
              onBack={() => setShowSettings(false)}
            />
          ) : (
            <Explorer
              key={selected?.id ?? 'none'}
              account={selected}
              target={target?.accountId === selected?.id ? target : null}
              onOpenContainer={(c) => {
                if (selected) selectAccount(selected.id, c)
              }}
              onChanged={refreshAccounts}
              onContainersChanged={invalidateContainers}
              onNewConnection={() => setShowWizard(true)}
            />
          )}
        </main>
        {!showSettings && <TransfersPanel onOpenSettings={() => setShowSettings(true)} />}
      </div>

      {showWizard && (
        <ConnectWizard
          onClose={() => setShowWizard(false)}
          onAdded={(a) => {
            refreshAccounts()
            selectAccount(a.id, a.containerName ?? null)
            setExpanded((p) => ({ ...p, [a.id]: true }))
            ensureContainers(a.id)
          }}
        />
      )}

      {detachFor && (
        <ConfirmDialog
          title={`Detach "${detachFor.name}"?`}
          body="The encrypted secret is deleted from this machine. You can re-attach any time with the same connection string or SAS."
          confirmLabel="Detach"
          onCancel={() => setDetachFor(null)}
          onConfirm={async () => {
            const id = detachFor.id
            await window.api.accounts.remove(id)
            setContainersCache((p) => {
              const next = { ...p }
              delete next[id]
              return next
            })
            refreshAccounts()
          }}
        />
      )}

      {createFor && (
        <PromptDialog
          title="New container"
          label="Container name"
          placeholder="mycontainer"
          hint="Lowercase letters, numbers and dashes · 3–63 chars."
          confirmLabel="Create"
          validate={(v) =>
            /^[a-z0-9]([a-z0-9-]{1,61}[a-z0-9])?$/.test(v)
              ? null
              : 'Use 3–63 lowercase letters, numbers and dashes.'
          }
          onCancel={() => setCreateFor(null)}
          onSubmit={async (v) => {
            const id = createFor
            await window.api.storage.createContainer({ accountId: id, container: v })
            setExpanded((p) => ({ ...p, [id]: true }))
            invalidateContainers(id)
          }}
        />
      )}

      {renameContainerFor && (
        <PromptDialog
          title={`Rename container "${renameContainerFor.name}"`}
          label="New container name"
          initial={renameContainerFor.name}
          placeholder="mycontainer"
          hint="Copies everything to the new container, then deletes the old one."
          confirmLabel="Rename"
          validate={(v) =>
            /^[a-z0-9]([a-z0-9-]{1,61}[a-z0-9])?$/.test(v)
              ? null
              : 'Use 3–63 lowercase letters, numbers and dashes.'
          }
          onCancel={() => setRenameContainerFor(null)}
          onSubmit={async (v) => {
            const { accountId, name } = renameContainerFor
            const dest = await window.api.storage.renameContainer({
              accountId,
              source: name,
              dest: v
            })
            invalidateContainers(accountId)
            if (target?.accountId === accountId && target.container === name) {
              selectAccount(accountId, dest)
            }
          }}
        />
      )}

      {deleteContainerFor && (
        <ConfirmDialog
          title={`Delete container "${deleteContainerFor.name}"?`}
          body="Everything inside is permanently deleted. This cannot be undone."
          requireText={deleteContainerFor.name}
          confirmLabel="Delete"
          onCancel={() => setDeleteContainerFor(null)}
          onConfirm={async () => {
            const { accountId, name } = deleteContainerFor
            await window.api.storage.deleteContainer({ accountId, container: name })
            invalidateContainers(accountId)
            if (target?.accountId === accountId && target.container === name) {
              selectAccount(accountId, null)
            }
          }}
        />
      )}
    </div>
  )
}

function hostOf(endpoint: string): string {
  try {
    return new URL(endpoint).host
  } catch {
    return endpoint
  }
}
