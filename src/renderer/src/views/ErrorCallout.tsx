import { useState } from 'react'
import type { ExplorerError } from './errors'
import { Icon } from './Icon'

/**
 * Slim single-line error banner. The full story lives in the activity dock —
 * this is just the inline pointer with retry, so the page never shows both
 * a big card and the same failure twice.
 */
export default function ErrorCallout(props: {
  error: ExplorerError
  onRetry?: () => void
  onDismiss?: () => void
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
    <div className="error-banner" role="alert">
      <div className="error-banner-row">
        <span className="error-banner-icon" aria-hidden>
          !
        </span>
        <span className="error-banner-title">{error.title}</span>
        <span className="error-banner-actions">
          {props.onRetry && (
            <button className="error-retry" onClick={props.onRetry}>
              <Icon name="refresh" size={13} /> Retry
            </button>
          )}
          <button className="error-text-btn" onClick={() => setShowDetails((v) => !v)}>
            {showDetails ? 'Hide details' : 'Details'} <Icon name={showDetails ? 'chevronUp' : 'chevronDown'} size={12} />
          </button>
          {props.onDismiss && (
            <button className="error-text-btn" onClick={props.onDismiss} aria-label="Dismiss error" title="Dismiss">
              <Icon name="close" size={13} />
            </button>
          )}
        </span>
      </div>
      {showDetails && (
        <div className="error-banner-detail">
          <p>{error.message} See the activity dock for the full history.</p>
          <pre className="error-technical">{error.technical}</pre>
          <button className="error-text-btn" onClick={() => void copyDetails()}>
            {copied ? <>Copied <Icon name="check" size={12} /></> : 'Copy details'}
          </button>
        </div>
      )}
    </div>
  )
}
