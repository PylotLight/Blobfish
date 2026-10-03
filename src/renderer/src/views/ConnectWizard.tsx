import { useEffect, useMemo, useRef, useState } from 'react'
import type { AccountCreateInput, AccountSummary, StorageKind } from '../../../shared/types'
import { stripIpcWrapper } from './errors'
import {
  parseConnectionString,
  parseSasUrl,
  suggestDisplayName
} from '../../../shared/parse'

type Method = 'connection-string' | 'sas-url' | 'account-key'

const STEPS = ['Select Resource', 'Select Connection Method', 'Enter Connection Info', 'Summary'] as const

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

const METHOD_META: Record<Method, { title: string; desc: string }> = {
  'connection-string': {
    title: 'Connection string (Key or SAS)',
    desc: 'Full connection string with an account key or SAS.'
  },
  'sas-url': {
    title: 'Shared access signature URL (SAS)',
    desc: 'Paste a service or container SAS URL.'
  },
  'account-key': {
    title: 'Account name and key',
    desc: 'We build the connection string for you.'
  }
}

function methodsFor(kind: StorageKind): Method[] {
  // Account scope leads with the key; container scopes lead with SAS URL.
  return kind === 'account'
    ? ['connection-string', 'sas-url', 'account-key']
    : ['sas-url', 'connection-string', 'account-key']
}

export default function ConnectWizard(props: {
  onClose: () => void
  onAdded: (a: AccountSummary) => void
}): React.JSX.Element {
  const [step, setStep] = useState(0)
  const [kind, setKind] = useState<StorageKind>('account')
  const [method, setMethod] = useState<Method>('connection-string')
  const [secret, setSecret] = useState('')
  const [acctName, setAcctName] = useState('')
  const [acctKey, setAcctKey] = useState('')
  const [endpointMode, setEndpointMode] = useState<'azure' | 'custom'>('azure')
  const [customEndpoint, setCustomEndpoint] = useState('http://127.0.0.1:10000/devstoreaccount1')
  const [containerName, setContainerName] = useState('')
  const [prefix, setPrefix] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [nameTouched, setNameTouched] = useState(false)
  const [containerTouched, setContainerTouched] = useState(false)
  const [prefixTouched, setPrefixTouched] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const lastAutoContainer = useRef('')
  const lastAutoPrefix = useRef('')

  // Keep the method valid when the resource kind changes.
  useEffect(() => {
    const valid = methodsFor(kind)
    if (!valid.includes(method)) setMethod(valid[0] as Method)
  }, [kind, method])

  // Auto-extract the display name from the secret until the user edits it.
  const effectiveSecretPreview = useMemo(() => {
    if (method === 'account-key') {
      return acctName.trim() ? `AccountName=${acctName.trim()}` : ''
    }
    return secret.trim()
  }, [method, secret, acctName])

  useEffect(() => {
    if (nameTouched) return
    const suggestion = suggestDisplayName(
      effectiveSecretPreview,
      containerName || undefined,
      prefix || undefined
    )
    setDisplayName(suggestion)
  }, [effectiveSecretPreview, containerName, prefix, nameTouched])

  const needsContainer = kind !== 'account'

  // Live-autofill container + directory from a pasted SAS URL. User edits
  // win: once touched, we only overwrite the field while it still holds the
  // previous auto value (or is empty).
  useEffect(() => {
    if (method !== 'sas-url') return
    let parsedContainer: string | undefined
    let parsedPrefix: string | undefined
    try {
      const parsed = parseSasUrl(secret.trim())
      parsedContainer = parsed.containerName
      parsedPrefix = parsed.prefix
    } catch {
      return
    }
    if (parsedContainer) {
      if (!containerTouched || containerName === '' || containerName === lastAutoContainer.current) {
        lastAutoContainer.current = parsedContainer
        setContainerName(parsedContainer)
      }
    }
    if (parsedPrefix) {
      if (!prefixTouched || prefix === '' || prefix === lastAutoPrefix.current) {
        lastAutoPrefix.current = parsedPrefix
        setPrefix(parsedPrefix)
      }
    }
  }, [secret, method, containerTouched, prefixTouched, containerName, prefix])

  function buildSecret(): string {
    if (method === 'account-key') {
      const name = acctName.trim()
      const key = acctKey.trim()
      if (!name) throw new Error('Account name is required.')
      if (!key) throw new Error('Account key is required.')
      if (endpointMode === 'custom') {
        const ep = customEndpoint.trim().replace(/\/+$/, '')
        if (!ep) throw new Error('Emulator endpoint is required.')
        return `DefaultEndpointsProtocol=http;AccountName=${name};AccountKey=${key};BlobEndpoint=${ep};`
      }
      return `DefaultEndpointsProtocol=https;AccountName=${name};AccountKey=${key};EndpointSuffix=core.windows.net`
    }
    const s = secret.trim()
    if (!s) throw new Error('Paste a connection string or SAS URL to continue.')
    return s
  }

  /** Human-readable parse of whatever will be stored — shown in Summary. */
  const preview = useMemo(() => {
    try {
      const s = buildSecret()
      if (s.includes('AccountName=') || s === 'UseDevelopmentStorage=true') {
        const p = parseConnectionString(s)
        return { endpoint: p.endpoint, container: containerName.trim() || undefined, expiry: null as string | null }
      }
      const p = parseSasUrl(s)
      return {
        endpoint: p.endpoint,
        container: containerName.trim() || p.containerName,
        expiry: p.sasExpiry
      }
    } catch {
      return null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [secret, acctName, acctKey, endpointMode, customEndpoint, containerName, method])

  const canNext = step === 0 || step === 1

  function next(): void {
    setError(null)
    setStep((s) => Math.min(s + 1, STEPS.length - 1))
  }

  async function attach(): Promise<void> {
    setBusy(true)
    setError(null)
    try {
      const input: AccountCreateInput = {
        name: displayName.trim(),
        kind,
        secret: buildSecret(),
        containerName: containerName.trim() || undefined,
        prefix: prefix.trim() || undefined
      }
      const added = await window.api.accounts.add(input)
      props.onAdded(added)
      props.onClose()
    } catch (err) {
      setError(stripIpcWrapper(err instanceof Error ? err.message : String(err)))
    } finally {
      setBusy(false)
    }
  }

  async function fillAzurite(): Promise<void> {
    try {
      const tpl = await window.api.accounts.azuriteTemplate()
      setSecret(tpl)
      setAcctName('devstoreaccount1')
      setEndpointMode('custom')
    } catch (err) {
      setError(stripIpcWrapper(err instanceof Error ? err.message : String(err)))
    }
  }

  return (
    <div className="modal-backdrop wiz-backdrop" onClick={props.onClose}>
      <div
        className="wizard glass strong"
        role="dialog"
        aria-label="Connect to Azure Storage"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="wiz-head">
          <h2>Connect to Azure Storage</h2>
          <button className="icon-btn" onClick={props.onClose} aria-label="Close">
            ✕
          </button>
        </header>

        <ol className="wiz-steps">
          {STEPS.map((label, i) => (
            <li key={label} className={i === step ? 'current' : i < step ? 'done' : ''}>
              <button className="wiz-step-btn" onClick={() => i < step && setStep(i)}>
                <span className="wiz-num">{i < step ? '✓' : i + 1}</span>
                {label}
              </button>
              {i < STEPS.length - 1 && <span className="wiz-sep" aria-hidden>›</span>}
            </li>
          ))}
        </ol>

        <div className="wiz-body" key={step}>
          {step === 0 && (
            <>
              <h3>What do you want to attach?</h3>
              <div className="kind-list">
                {(Object.keys(KIND_META) as StorageKind[]).map((k) => (
                  <button
                    key={k}
                    className={`kind-row${kind === k ? ' selected' : ''}`}
                    onClick={() => setKind(k)}
                  >
                    <span className={`kind-icon ${k}`} aria-hidden />
                    <span className="kind-text">
                      <span className="kind-title">{KIND_META[k].title}</span>
                      <span className="kind-desc">{KIND_META[k].desc}</span>
                    </span>
                    <span className="radio" aria-hidden />
                  </button>
                ))}
              </div>
            </>
          )}

          {step === 1 && (
            <>
              <h3>How will you connect{kind === 'account' ? ' to the storage account' : ''}?</h3>
              <div className="kind-list">
                {methodsFor(kind).map((m) => (
                  <button
                    key={m}
                    className={`kind-row slim${method === m ? ' selected' : ''}`}
                    onClick={() => setMethod(m)}
                  >
                    <span className="kind-text">
                      <span className="kind-title">{METHOD_META[m].title}</span>
                      <span className="kind-desc">{METHOD_META[m].desc}</span>
                    </span>
                    <span className="radio" aria-hidden />
                  </button>
                ))}
              </div>
              <button className="btn ghost small azurite-link" onClick={() => void fillAzurite()}>
                Use local Azurite emulator defaults
              </button>
            </>
          )}

          {step === 2 && (
            <>
              <h3>Enter connection info</h3>
              {method === 'account-key' ? (
                <>
                  <div className="grid2">
                    <label className="field">
                      <span>Account name</span>
                      <input
                        value={acctName}
                        onChange={(e) => setAcctName(e.target.value)}
                        placeholder="myaccount"
                        autoComplete="off"
                      />
                    </label>
                    <label className="field">
                      <span>Environment</span>
                      <select
                        value={endpointMode}
                        onChange={(e) => setEndpointMode(e.target.value as 'azure' | 'custom')}
                      >
                        <option value="azure">Azure (global)</option>
                        <option value="custom">Emulator / custom</option>
                      </select>
                    </label>
                  </div>
                  <label className="field">
                    <span>Account key</span>
                    <input
                      type="password"
                      value={acctKey}
                      onChange={(e) => setAcctKey(e.target.value)}
                      placeholder="paste key…"
                      autoComplete="off"
                    />
                  </label>
                  {endpointMode === 'custom' && (
                    <label className="field">
                      <span>Blob endpoint</span>
                      <input
                        value={customEndpoint}
                        onChange={(e) => setCustomEndpoint(e.target.value)}
                        placeholder="http://127.0.0.1:10000/devstoreaccount1"
                      />
                    </label>
                  )}
                </>
              ) : (
                <label className="field">
                  <span>{method === 'sas-url' ? 'SAS URL' : 'Connection string'}</span>
                  <textarea
                    className="secret-input"
                    value={secret}
                    onChange={(e) => setSecret(e.target.value)}
                    rows={method === 'sas-url' ? 3 : 4}
                    placeholder={
                      method === 'sas-url'
                        ? 'https://myacct.blob.core.windows.net/mycontainer?sv=…&sig=…'
                        : 'DefaultEndpointsProtocol=https;AccountName=…;AccountKey=…;EndpointSuffix=core.windows.net'
                    }
                    spellCheck={false}
                  />
                </label>
              )}

              {needsContainer && (
                <div className="grid2">
                  <label className="field">
                    <span>Container</span>
                    <input
                      value={containerName}
                      onChange={(e) => {
                        setContainerName(e.target.value)
                        setContainerTouched(true)
                      }}
                      placeholder={
                        method === 'connection-string' || method === 'account-key'
                          ? 'required — mycontainer'
                          : 'auto-detected from URL'
                      }
                    />
                    {method === 'sas-url' && containerName !== '' && !containerTouched && (
                      <span className="muted small hint">Auto-detected from SAS URL — editable.</span>
                    )}
                  </label>
                  <label className="field">
                    <span>Directory (optional)</span>
                    <input
                      value={prefix}
                      onChange={(e) => {
                        setPrefix(e.target.value)
                        setPrefixTouched(true)
                      }}
                      placeholder="uploads/2026"
                    />
                  </label>
                </div>
              )}
              {!needsContainer && method !== 'account-key' && (
                <p className="muted small hint">
                  Account scope — leave the URL as the service root to list every container,
                  or include a container path to scope down.
                </p>
              )}
            </>
          )}

          {step === 3 && (
            <>
              <h3>Summary</h3>
              <label className="field">
                <span>Display name</span>
                <input
                  value={displayName}
                  onChange={(e) => {
                    setDisplayName(e.target.value)
                    setNameTouched(true)
                  }}
                  placeholder="e.g. prod blobs"
                />
              </label>
              <ul className="kv summary">
                <li>
                  <span>Resource</span>
                  <strong>{KIND_META[kind].title}</strong>
                </li>
                <li>
                  <span>Method</span>
                  <strong>{METHOD_META[method].title}</strong>
                </li>
                <li>
                  <span>Endpoint</span>
                  <code>{preview?.endpoint ?? '—'}</code>
                </li>
                {preview?.container && (
                  <li>
                    <span>Container</span>
                    <code>{preview.container}</code>
                  </li>
                )}
                {preview?.expiry && (
                  <li>
                    <span>SAS expiry</span>
                    <code>{new Date(preview.expiry).toLocaleDateString()}</code>
                  </li>
                )}
              </ul>
              <p className="muted small">Secrets are encrypted with the OS keychain — never stored in plaintext.</p>
            </>
          )}

          {error && <p className="error-text">{error}</p>}
        </div>

        <footer className="wiz-foot">
          <button className="btn ghost" onClick={props.onClose} disabled={busy}>
            Cancel
          </button>
          <div className="row">
            {step > 0 && (
              <button className="btn ghost" onClick={() => setStep((s) => s - 1)} disabled={busy}>
                Back
              </button>
            )}
            {canNext ? (
              <button className="btn mint" onClick={next}>
                Next
              </button>
            ) : step === 2 ? (
              <button className="btn mint" onClick={next}>
                Review
              </button>
            ) : (
              <button className="btn mint" onClick={() => void attach()} disabled={busy}>
                {busy ? 'Attaching…' : 'Attach'}
              </button>
            )}
          </div>
        </footer>
      </div>
    </div>
  )
}
