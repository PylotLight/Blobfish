import { useCallback, useEffect, useRef, useState } from 'react'
import { APP_NAME, APP_TAGLINE } from '../../shared/config'
import type { AccountSummary, StorageContainer, SysInfo } from '../../shared/types'
import logoUrl from './assets/logo.png'
import Explorer from './views/Explorer'
import HomeView from './views/Home'
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
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(() => {
    try {
      return localStorage.getItem('blobfish.sidebarCollapsed') === '1'
    } catch {
      return false
    }
  })

  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const [containersCache, setContainersCache] = useState<Record<string, StorageContainer[]>>({})
  const [containersFailed, setContainersFailed] = useState<Record<string, boolean>>({})
  const [loadingContainers, setLoadingContainers] = useState<Record<string, boolean>>({})
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [detachFor, setDetachFor] = useState<AccountSummary | null>(null)
  const [createFor, setCreateFor] = useState<string | null>(null)
  const [renameContainerFor, setRenameContainerFor] = useState<{ accountId: string; name: string } | null>(null)
  const [deleteContainerFor, setDeleteContainerFor] = useState<{ accountId: string; name: string } | null>(null)
  const [quickOpen, setQuickOpen] = useState(true)
  const [allOpen, setAllOpen] = useState(true)
  const [attachedOpen, setAttachedOpen] = useState(true)
  const [copiedSecretId, setCopiedSecretId] = useState<string | null>(null)
  const [secretError, setSecretError] = useState<string | null>(null)

  const refreshAccounts = useCallback(() => {
    window.api.accounts
      .list()
      .then((list) => {
        setAccounts(list)
        // Launch (and removals) land on the dashboard — never auto-pick.
        setSelectedId((prev) => (prev && list.some((a) => a.id === prev) ? prev : null))
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
  // Persist prefs + apply native vibrancy (macOS only; harmless elsewhere).
  // Transfer tuning is debounced — slider drags would otherwise spam IPC.
  useEffect(() => {
    savePrefs(prefs)
    if (platform === 'darwin') {
      window.api.glass.set(prefs.vibrancy ? 'fullscreen-ui' : null).catch(console.error)
    }
    const timer = window.setTimeout(() => {
      window.api.transfers
        .configure({ uploadConcurrency: prefs.uploadConcurrency, maxParallel: prefs.maxParallel })
        .catch(console.error)
    }, 250)
    return () => window.clearTimeout(timer)
  }, [prefs, platform])

  // Drag-to-resize sidebar width
  useEffect(() => {
    try {
      localStorage.setItem('blobfish.sidebarCollapsed', sidebarCollapsed ? '1' : '0')
    } catch {
      // Storage blocked — collapse state just won't persist.
    }
  }, [sidebarCollapsed])

  // ⌘B / Ctrl+B toggles the sidebar; Esc re-opens nothing, it just closes menus.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'b') {
        e.preventDefault()
        setSidebarCollapsed((v) => !v)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Drag-to-resize sidebar width. The live width is mirrored to a ref so
  // mouse-up persists the final value, not the stale closure at drag start.
  const sidebarWidthRef = useRef(sidebarWidth)
  sidebarWidthRef.current = sidebarWidth
  useEffect(() => {
    if (!isDraggingSidebar || sidebarCollapsed) return
    const handleMouseMove = (e: MouseEvent) => {
      const maxW = Math.min(640, Math.floor(window.innerWidth * 0.55))
      const newWidth = Math.max(260, Math.min(maxW, e.clientX))
      setSidebarWidth(newWidth)
    }
    const handleMouseUp = () => {
      setIsDraggingSidebar(false)
      try {
        localStorage.setItem('blobfish.sidebarWidth', String(sidebarWidthRef.current))
      } catch {
        // Storage blocked — width just won't persist.
      }
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
  }, [isDraggingSidebar, sidebarCollapsed])

  function updatePrefs(next: Prefs): void {
    // Reset to defaults keeps one obvious escape hatch if a theme misbehaves.
    setPrefs({ ...DEFAULT_PREFS, ...next })
  }

  const ensureContainers = useCallback((accountId: string) => {
    // Guard against duplicate in-flight fetches: expanding a row and the
    // explorer mounting for the same account used to fire listContainers
    // twice, which — off VPN — meant duplicate 403 activity entries.
    let shouldFetch = false
    setContainersCache((prev) => {
      if (prev[accountId]) return prev
      shouldFetch = true
      return prev
    })
    if (!shouldFetch) return
    setLoadingContainers((prev) => {
      if (prev[accountId]) {
        shouldFetch = false
        return prev
      }
      return { ...prev, [accountId]: true }
    })
    if (!shouldFetch) return
    void window.api.storage
      .listContainers(accountId)
      .then((cs) => {
        setContainersCache((p) => ({ ...p, [accountId]: cs }))
        setContainersFailed((p) => ({ ...p, [accountId]: false }))
      })
      .catch(() => {
        // A failed listing (e.g. 403 — SAS without account-level list) is
        // cached as a failure, not an empty account, so the sidebar says
        // so instead of the misleading "No containers."
        setContainersCache((p) => ({ ...p, [accountId]: [] }))
        setContainersFailed((p) => ({ ...p, [accountId]: true }))
      })
      .finally(() => setLoadingContainers((p) => ({ ...p, [accountId]: false })))
  }, [])

  function toggleExpand(accountId: string): void {
    const a = accounts.find((x) => x.id === accountId)
    // Container attachments open straight into their container — nothing to expand.
    if (a && a.kind !== 'account') return
    setExpanded((prev) => {
      const next = !prev[accountId]
      if (next) ensureContainers(accountId)
      return { ...prev, [accountId]: next }
    })
  }

  function selectAccount(accountId: string, container: string | null = null): void {
    const a = accounts.find((x) => x.id === accountId)
    const resolved =
      container ?? (a && a.kind !== 'account' ? (a.containerName ?? null) : null)
    setSelectedId(accountId)
    setTarget((t) => ({ accountId, container: resolved, tick: (t?.tick ?? 0) + 1 }))
  }

  function goHome(): void {
    setSelectedId(null)
    setTarget(null)
  }

  function invalidateContainers(accountId: string): void {
    setContainersCache((prev) => {
      const next = { ...prev }
      delete next[accountId]
      return next
    })
    setContainersFailed((prev) => {
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
  const visible = pinned.length > 0 ? accounts.filter((a) => !a.pinned) : accounts
  const visibleAccounts = visible.filter((a) => a.kind === 'account')
  const visibleContainers = visible.filter((a) => a.kind !== 'account')
  const pinnedContainerKeys = new Set(
    pinned
      .filter((a) => a.containerName)
      .map((a) => `${a.endpoint}::${(a.containerName ?? '').toLowerCase()}`)
  )

  function isContainerPinned(endpoint: string, container: string): boolean {
    return pinnedContainerKeys.has(`${endpoint}::${container.toLowerCase()}`)
  }

  function toggleContainerPin(source: AccountSummary, container: string): void {
    const match = accounts.find(
      (a) =>
        a.containerName &&
        a.endpoint === source.endpoint &&
        a.containerName.toLowerCase() === container.toLowerCase()
    )
    if (match?.pinned) {
      window.api.accounts.pin(match.id, false).then(() => refreshAccounts()).catch(console.error)
    } else if (match) {
      window.api.accounts.pin(match.id, true).then(() => refreshAccounts()).catch(console.error)
    } else {
      window.api.accounts
        .pinContainer(source.id, container)
        .then(() => refreshAccounts())
        .catch(console.error)
    }
  }

  function copySecret(id: string): void {
    // Secret never enters renderer JS — main decrypts and writes clipboard directly.
    setSecretError(null)
    window.api.accounts
      .copySecret(id)
      .then(() => {
        setCopiedSecretId(id)
        window.setTimeout(() => setCopiedSecretId((cur) => (cur === id ? null : cur)), 1600)
      })
      .catch((err: unknown) => {
        console.error(err)
        setSecretError(err instanceof Error ? err.message : String(err))
      })
  }

  function exportSecret(id: string): void {
    setSecretError(null)
    window.api.accounts
      .exportSecret(id)
      .catch((err: unknown) => {
        console.error(err)
        setSecretError(err instanceof Error ? err.message : String(err))
      })
  }

  const [rowMenu, setRowMenu] = useState<{ x: number; y: number; account: AccountSummary } | null>(null)

  function openRowMenu(e: React.MouseEvent, a: AccountSummary): void {
    e.preventDefault()
    e.stopPropagation()
    setRowMenu({ x: e.clientX, y: e.clientY, account: a })
  }

  // Escape closes the row menu.
  useEffect(() => {
    if (!rowMenu) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setRowMenu(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [rowMenu])

  function accountRow(a: AccountSummary): React.JSX.Element {
    const isActive = a.id === selectedId
    const isOpen = expanded[a.id] ?? false
    const cached = containersCache[a.id]
    const loading = loadingContainers[a.id] ?? false
    const listFailed = containersFailed[a.id] ?? false
    const canManageContainers = a.kind === 'account' && !a.containerName
    const isScopedContainer = a.kind !== 'account'
    const leaves = (
      <>
        {loading && <li className="tree-loading">Loading…</li>}
        {!loading && cached?.length === 0 && (
          <li className="tree-loading">
            {listFailed ? 'Cannot list containers — SAS may lack permission.' : 'No containers.'}
          </li>
        )}
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
                  className={`mini-btn${isContainerPinned(a.endpoint, c.name) ? ' on' : ''}`}
                  title={
                    isContainerPinned(a.endpoint, c.name)
                      ? `Unpin container "${c.name}" from Quick Access`
                      : `Pin container "${c.name}" to Quick Access`
                  }
                  onClick={() => toggleContainerPin(a, c.name)}
                >
                  {isContainerPinned(a.endpoint, c.name) ? '★' : '☆'}
                </button>
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
          {isScopedContainer ? (
            <span className="twisty leaf-spacer" aria-hidden />
          ) : (
            <button
              className={`twisty${isOpen ? ' open' : ''}`}
              onClick={() => toggleExpand(a.id)}
              aria-label={isOpen ? 'Collapse' : 'Expand'}
            >
              ›
            </button>
          )}
          <button
            className="tree-main"
            onClick={() => {
              selectAccount(a.id, a.kind === 'account' ? null : (a.containerName ?? null))
              if (!isOpen && !isScopedContainer) toggleExpand(a.id)
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
              title="More actions"
              aria-label={`Actions for ${a.name}`}
              onClick={(e) => openRowMenu(e, a)}
            >
              ⋯
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
      </li>
    )
  }

  return (
    <div
      className={`shell${sidebarCollapsed ? ' sidebar-collapsed' : ''}`}
      data-platform={platform ?? 'unknown'}
      data-theme={prefs.theme}
      data-accent={prefs.accent}
      data-density={prefs.density}
      data-motion={prefs.motion}
      style={accentVars(prefs) as React.CSSProperties}
    >
      <aside
        className="sidebar"
        style={sidebarCollapsed ? undefined : { width: `${sidebarWidth}px` }}
        aria-hidden={sidebarCollapsed}
      >
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
          <button
            className="mini-btn sidebar-collapse-btn"
            onClick={() => setSidebarCollapsed(true)}
            title="Collapse sidebar (⌘B)"
            aria-label="Collapse sidebar"
          >
            ⟨
          </button>
        </div>

        <div className="side-actions">
          <button className={`btn ghost home-cta${selectedId === null ? ' active-opt' : ''}`} onClick={goHome}>
            ⌂ Home
          </button>
          <button className="btn mint attach-cta" onClick={() => setShowWizard(true)}>
            + New connection
          </button>
        </div>
        {encAvailable === false && (
          <p className="error-text small">Keychain encryption unavailable — attach disabled.</p>
        )}
        {secretError && (
          <p className="error-text small">Secret action failed: {secretError}</p>
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
              <span className="count">{visibleAccounts.length}</span>
            </button>
            {allOpen && (
              visibleAccounts.length === 0 && visibleContainers.length === 0 ? (
                <div className="empty-sidebar-card">
                  <p className="empty-sidebar-title">No storage accounts</p>
                  <p className="muted small empty-note">
                    Connect with a connection string, SAS URL, or account key to get started.
                  </p>
                </div>
              ) : (
                <ul className="tree">{visibleAccounts.map(accountRow)}</ul>
              )
            )}
          </section>

          {visibleContainers.length > 0 && (
            <section className="tree-section">
              <button className="section-toggle" onClick={() => setAttachedOpen((v) => !v)}>
                <span className={`twisty${attachedOpen ? ' open' : ''}`}>›</span>
                Attached containers
                <span className="count">{visibleContainers.length}</span>
              </button>
              {attachedOpen && <ul className="tree">{visibleContainers.map(accountRow)}</ul>}
            </section>
          )}
        </div>

        <div className="side-foot">
          <div className="side-foot-row">
            <button className="settings-btn" onClick={() => setShowSettings(true)}>
              <span aria-hidden>⚙</span> Settings
            </button>
            <button
              className="quit-btn"
              onClick={() => window.api.app.quit()}
              title="Quit Blobfish"
              aria-label="Quit Blobfish"
            >
              <span aria-hidden>⏻</span>
            </button>
          </div>
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
        {sidebarCollapsed && (
          <button
            className="sidebar-expand-btn"
            onClick={() => setSidebarCollapsed(false)}
            title="Expand sidebar (⌘B)"
            aria-label="Expand sidebar"
          >
            ⟩
          </button>
        )}
        <main className="view">
          {showSettings ? (
            <SettingsView
              prefs={prefs}
              vibrancySupported={platform === 'darwin'}
              onChange={updatePrefs}
              onBack={() => setShowSettings(false)}
            />
          ) : selected ? (
            <Explorer
              key={selected.id}
              account={selected}
              target={target?.accountId === selected?.id ? target : null}
              onOpenContainer={(c) => {
                if (selected) selectAccount(selected.id, c)
              }}
              onChanged={refreshAccounts}
              onContainersChanged={invalidateContainers}
              onNewConnection={() => setShowWizard(true)}
            />
          ) : (
            <HomeView
              accounts={accounts}
              onNewConnection={() => setShowWizard(true)}
              onSelect={(id) => selectAccount(id)}
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
            if (a.kind === 'account') {
              setExpanded((p) => ({ ...p, [a.id]: true }))
              ensureContainers(a.id)
            }
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
            setContainersFailed((p) => {
              const next = { ...p }
              delete next[id]
              return next
            })
            refreshAccounts()
          }}
        />
      )}

      {rowMenu && (
        <>
          <div className="ctx-overlay" onClick={() => setRowMenu(null)} />
          <div
            className="ctx-menu glass strong"
            role="menu"
            aria-label={`Actions for ${rowMenu.account.name}`}
            style={{
              left: `${Math.min(rowMenu.x, window.innerWidth - 240)}px`,
              top: `${Math.min(rowMenu.y, window.innerHeight - 280)}px`
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              role="menuitem"
              onClick={() => copySecret(rowMenu.account.id)}
              title="Copy the SAS URL / connection string to the clipboard"
            >
              {copiedSecretId === rowMenu.account.id ? '✓ Copied to clipboard' : '⧉ Copy connection secret'}
            </button>
            <button
              role="menuitem"
              onClick={() => {
                setRowMenu(null)
                exportSecret(rowMenu.account.id)
              }}
            >
              ⤓ Export secret to file…
            </button>
            <button
              role="menuitem"
              onClick={() => {
                setRowMenu(null)
                setRenamingId(rowMenu.account.id)
                setRenameValue(rowMenu.account.name)
              }}
            >
              ✎ Rename…
            </button>
            <div className="ctx-sep" aria-hidden />
            <button
              role="menuitem"
              className="danger"
              onClick={() => {
                setRowMenu(null)
                setDetachFor(rowMenu.account)
              }}
            >
              ✕ Detach…
            </button>
          </div>
        </>
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
