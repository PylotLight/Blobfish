import { useCallback, useEffect, useState } from 'react'
import { APP_NAME, APP_TAGLINE } from '../../shared/config'
import type { AccountSummary, GlassState, SysInfo } from '../../shared/types'
import Kitchen from './views/Kitchen'
import TrayDemo from './views/TrayDemo'
import Glass from './views/Glass'
import Agent from './views/Agent'
import Explorer, { AddAccountDialog } from './views/Explorer'

type Tab = 'explorer' | 'kitchen' | 'tray' | 'glass' | 'agent'

const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'explorer', label: 'Explorer' },
  { id: 'kitchen', label: 'Kitchen sink' },
  { id: 'tray', label: 'Tray' },
  { id: 'glass', label: 'Glass' },
  { id: 'agent', label: 'Agent mode' }
]

export default function App(): React.JSX.Element {
  const [tab, setTab] = useState<Tab>('explorer')
  const [sys, setSys] = useState<SysInfo | null>(null)
  const [glass, setGlass] = useState<GlassState | null>(null)
  const [query, setQuery] = useState('')

  const [accounts, setAccounts] = useState<AccountSummary[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [showAdd, setShowAdd] = useState(false)
  const [encAvailable, setEncAvailable] = useState<boolean | null>(null)

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
    window.api.sys.info().then(setSys).catch(console.error)
    window.api.glass.get().then(setGlass).catch(console.error)
    refreshAccounts()
    window.api.accounts.encryption().then(setEncAvailable).catch(() => setEncAvailable(false))
  }, [refreshAccounts])

  const selected = accounts.find((a) => a.id === selectedId) ?? null
  const vibrancyOn = glass !== null && glass.vibrancy !== null

  return (
    <div className="shell" data-platform={sys?.platform ?? 'unknown'}>
      <aside className="sidebar">
        <div className="traffic-spacer" aria-hidden />
        <div className="brand">
          <h1>{APP_NAME}</h1>
          <p>{APP_TAGLINE}</p>
        </div>
        <nav className="nav" role="tablist" aria-label="Sections">
          {TABS.map((t) => (
            <button
              key={t.id}
              role="tab"
              aria-selected={tab === t.id}
              className={tab === t.id ? 'active' : ''}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </nav>

        <div className="accounts-block">
          <div className="accounts-head">
            <span>Storage</span>
            <button className="btn ghost small" onClick={() => setShowAdd(true)}>
              + Attach
            </button>
          </div>
          {encAvailable === false && (
            <p className="error-text small">Keychain encryption unavailable — attach disabled.</p>
          )}
          {accounts.length === 0 ? (
            <p className="muted small">No storage attached.</p>
          ) : (
            <ul className="accounts-list">
              {accounts.map((a) => (
                <li key={a.id}>
                  <button
                    className={`account-row${a.id === selectedId ? ' active' : ''}`}
                    onClick={() => {
                      setSelectedId(a.id)
                      setTab('explorer')
                    }}
                    title={`${a.endpoint}${a.containerName ? ` / ${a.containerName}` : ''}`}
                  >
                    <span className={`kind-dot ${a.kind}`} aria-hidden />
                    <span className="account-text">
                      <span className="account-name">{a.name}</span>
                      <span className="account-sub">
                        {a.containerName ?? a.accountName ?? new URL(a.endpoint).host}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="side-foot">
          <span className={`status-pill${vibrancyOn ? ' on' : ''}`}>
            vibrancy {glass === null ? '…' : vibrancyOn ? 'on' : 'off'}
          </span>
          <span className="status-sub">
            {sys ? `${sys.platform} · e${window.api.versions.electron()}` : '…'}
          </span>
        </div>
      </aside>

      <div className="content">
        <header className="topbar">
          <button
            className="btn ghost"
            title="Hide the whole app (macOS: Cmd+H behavior)"
            onClick={() => void window.api.app.hide()}
          >
            Hide
          </button>
          <input
            className="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={tab === 'explorer' ? 'Filter blobs…' : 'Search the day…'}
            aria-label="Search"
          />
          <span className="weather pill">
            {sys ? `${sys.hostname} · ${sys.cpus} cores` : '…'}
          </span>
        </header>

        <main className="view">
          {tab === 'explorer' && (
            <Explorer
              accounts={accounts}
              selected={selected}
              onSelect={setSelectedId}
              onChanged={refreshAccounts}
              globalQuery={query}
            />
          )}
          {tab === 'kitchen' && <Kitchen />}
          {tab === 'tray' && <TrayDemo platform={sys?.platform} />}
          {tab === 'glass' && (
            <Glass
              platform={sys?.platform}
              query={query}
              glass={glass}
              onGlassChange={setGlass}
            />
          )}
          {tab === 'agent' && <Agent />}
        </main>
      </div>

      {showAdd && (
        <AddAccountDialog
          onClose={() => setShowAdd(false)}
          onAdded={(a) => {
            refreshAccounts()
            setSelectedId(a.id)
            setTab('explorer')
          }}
        />
      )}
    </div>
  )
}
