import { useEffect, useState } from 'react'
import type { AccountSummary, ActivityEntry } from '../../../shared/types'
import logoUrl from '../assets/logo.png'
import { APP_NAME, APP_TAGLINE } from '../../../shared/config'

function sasWarning(expiry?: string | null): string | null {
  if (!expiry) return null
  const ms = Date.parse(expiry)
  if (Number.isNaN(ms)) return null
  if (ms <= Date.now()) return `SAS expired ${new Date(ms).toLocaleDateString()}`
  const days = Math.ceil((ms - Date.now()) / 86_400_000)
  return days <= 14 ? `SAS expires in ${days}d` : null
}

function hostOf(endpoint: string): string {
  try {
    return new URL(endpoint).host
  } catch {
    return endpoint
  }
}

export default function HomeView(props: {
  accounts: AccountSummary[]
  onNewConnection: () => void
  onSelect: (accountId: string) => void
}): React.JSX.Element {
  const [activities, setActivities] = useState<ActivityEntry[]>([])

  useEffect(() => {
    window.api.activity.list().then(setActivities).catch(console.error)
    return window.api.activity.onUpdate(setActivities)
  }, [])

  const recent = activities.slice(0, 8)
  const pinned = props.accounts.filter((a) => a.pinned)

  return (
    <div className="home fade-in">
      <section className="card home-hero">
        <div className="hero-logo-frame home-logo">
          <img src={logoUrl} alt="Blobfish" className="hero-logo-img" />
        </div>
        <div className="home-hero-text">
          <h2>Welcome to {APP_NAME}</h2>
          <p className="muted">{APP_TAGLINE}</p>
          <div className="home-stats">
            <span className="pill conn-pill">
              {props.accounts.length} {props.accounts.length === 1 ? 'connection' : 'connections'}
            </span>
            {pinned.length > 0 && <span className="pill conn-pill">★ {pinned.length} pinned</span>}
          </div>
          {props.accounts.length === 0 && (
            <p className="muted small home-hint">
              Connect with a connection string, SAS URL, or account key to get started.
              Credentials stay encrypted in your OS keychain.
            </p>
          )}
        </div>
        <div className="home-cta-row">
          <button className="btn mint" onClick={props.onNewConnection}>
            + New connection
          </button>
        </div>
      </section>

      {props.accounts.length > 0 && (
        <section className="card home-section">
          <h3>Connections</h3>
          {props.accounts.map((a) => {
            const warn = sasWarning(a.sasExpiry)
            return (
              <button key={a.id} className="home-conn" onClick={() => props.onSelect(a.id)} title={a.endpoint}>
                <span className={`kind-ico ${a.kind}`} aria-hidden />
                <span className="home-conn-text">
                  <span className="account-name" title={a.name}>
                    {a.name}
                  </span>
                  <span className="account-sub" title={a.containerName ?? a.accountName ?? hostOf(a.endpoint)}>
                    {a.containerName ?? a.accountName ?? hostOf(a.endpoint)}
                  </span>
                </span>
                {warn && <span className="pill warn">{warn}</span>}
                <span className="twisty open" aria-hidden>
                  ›
                </span>
              </button>
            )
          })}
        </section>
      )}

      {recent.length > 0 && (
        <section className="card home-section">
          <h3>Recent activity</h3>
          <ul className="activity-list">
            {recent.map((e) => (
              <li key={e.id} className="activity-row">
                <span className={`a-dot ${e.status}`} aria-hidden>
                  {e.status === 'success' ? '✓' : '✕'}
                </span>
                <div className="a-main">
                  <div>{e.text}</div>
                  <div className="muted small">{new Date(e.at).toLocaleString()}</div>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
