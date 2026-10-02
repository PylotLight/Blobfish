import { useCallback, useEffect, useState } from 'react'
import { APP_NAME, APP_TAGLINE } from '../../shared/config'
import type { AccountSummary, StorageContainer, SysInfo } from '../../shared/types'
import Explorer from './views/Explorer'
import ConnectWizard from './views/ConnectWizard'
import TransfersPanel from './views/TransfersPanel'
import { ConfirmDialog, PromptDialog } from './views/Dialogs'
import { DEFAULT_PREFS, loadPrefs, savePrefs, SettingsDialog, type Prefs } from './views/Settings'

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

  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const [containersCache, setContainersCache] = useState<Record<string, StorageContainer[]>>({})
  const [loadingContainers, setLoadingContainers] = useState<Record<string, boolean>>({})
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [detachFor, setDetachFor] = useState<AccountSummary | null>(null)
  const [createFor, setCreateFor] = useState<string | null>(null)
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
    const leaves = (
      <>
        {loading && <li className="tree-loading">Loading…</li>}
        {!loading && cached?.length === 0 && <li className="tree-loading">No containers.</li>}
        {cached?.map((c) => (
          <li key={c.name}>
            <button
              className={`tree-leaf${target?.accountId === a.id && target.container === c.name ? ' active' : ''}`}
              onClick={() => selectAccount(a.id, c.name)}
            >
              <span className="kind-ico container" aria-hidden />
              {c.name}
            </button>
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
            title={`${a.endpoint}${a.containerName ? ` / ${a.containerName}` : ''}`}
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
                <span className="account-name">{a.name}</span>
              )}
              <span className="account-sub">
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
      data-density={prefs.density}
      data-motion={prefs.motion}
    >
      <aside className="sidebar">
        <div className="traffic-spacer" aria-hidden />
        <div className="brand">
          <h1>{APP_NAME}</h1>
          <p>{APP_TAGLINE}</p>
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
                <p className="muted small empty-note">
                  Nothing attached yet. Connect with a connection string, SAS URL, or account key.
                </p>
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
            {accounts.length} connection{accounts.length === 1 ? '' : 's'} · secrets in OS keychain
          </span>
        </div>
      </aside>

      <div className="content no-topbar">
        <main className="view">
          <Explorer
            key={selected?.id ?? 'none'}
            account={selected}
            target={target?.accountId === selected?.id ? target : null}
            onOpenContainer={(c) => {
              if (selected) selectAccount(selected.id, c)
            }}
            onChanged={refreshAccounts}
            onContainersChanged={invalidateContainers}
          />
        </main>
        <TransfersPanel onOpenSettings={() => setShowSettings(true)} />
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

      {showSettings && (
        <SettingsDialog
          prefs={prefs}
          vibrancySupported={platform === 'darwin'}
          onChange={updatePrefs}
          onClose={() => setShowSettings(false)}
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
