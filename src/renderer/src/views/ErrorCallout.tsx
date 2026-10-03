import { useState } from 'react'
import type { ExplorerError } from './errors'

export default function ErrorCallout(props: {
  error: ExplorerError
  onRetry?: () => void
  onDismiss?: () => void
  compact?: boolean
}): React.JSX.Element {
  const { error } = props
  const [showDetails, setShowDetails] = useState(false)
  const [copied, setCopied] = useState(false)

  async function copyDetails(): Promise<void> {
    try {
      await navigator.clipboard.writeText(`${error.title}\n${error.message}\n\n${error.technical}`)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1600)
    } catch {
      // Clipboard may be unavailable — selection fallback is still possible.
    }
  }

  return (
    <div className="error-callout" role="alert">
      <span className="error-callout-icon" aria-hidden>
        !
      </span>
      <div className="error-callout-main">
        <div className="error-callout-title-row">
          <strong className="error-callout-title">{error.title}</strong>
          {props.onDismiss && (
            <button className="mini-btn error-dismiss" onClick={props.onDismiss} aria-label="Dismiss error">
              ✕
            </button>
          )}
        </div>
        <p className="error-callout-msg">{error.message}</p>
        <div className="error-callout-actions">
          {props.onRetry && (
            <button className="btn ghost small error-retry" onClick={props.onRetry}>
              ↻ Retry
            </button>
          )}
          <button className="linklike small" onClick={() => setShowDetails((v) => !v)}>
            {showDetails ? 'Hide details ▴' : 'Details ▾'}
          </button>
          <button className="linklike small" onClick={() => void copyDetails()}>
            {copied ? 'Copied ✓' : 'Copy details'}
          </button>
        </div>
        {showDetails && <pre className="error-technical">{error.technical}</pre>}
      </div>
    </div>
  )
}
