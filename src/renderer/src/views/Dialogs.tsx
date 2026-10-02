import { useEffect, useRef, useState } from 'react'

function useDismiss(onCancel: () => void): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCancel])
}

/**
 * Intentional-action confirm. Destructive operations pass `requireText`
 * (the user must type the container/account name) so a stray click
 * can never delete anything.
 */
export function ConfirmDialog(props: {
  title: string
  body?: string
  items?: string[]
  requireText?: string
  confirmLabel?: string
  danger?: boolean
  onCancel: () => void
  onConfirm: () => Promise<void>
}): React.JSX.Element {
  const [typed, setTyped] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const confirmRef = useRef<HTMLButtonElement>(null)
  useDismiss(props.onCancel)

  useEffect(() => {
    if (!props.requireText) confirmRef.current?.focus()
  }, [props.requireText])

  const matches = !props.requireText || typed.trim() === props.requireText

  async function submit(): Promise<void> {
    if (!matches || busy) return
    setBusy(true)
    setError(null)
    try {
      await props.onConfirm()
      props.onCancel()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const shown = (props.items ?? []).slice(0, 8)
  const extra = (props.items ?? []).length - shown.length

  return (
    <div className="modal-backdrop" onClick={props.onCancel}>
      <div
        className="modal glass strong dialog fade-in"
        role="alertdialog"
        aria-label={props.title}
        onClick={(e) => e.stopPropagation()}
      >
        <h3>{props.title}</h3>
        {props.body && <p className="muted">{props.body}</p>}
        {shown.length > 0 && (
          <ul className="dialog-items">
            {shown.map((item) => (
              <li key={item}>
                <code>{item}</code>
              </li>
            ))}
            {extra > 0 && (
              <li className="muted small">+ {extra} more</li>
            )}
          </ul>
        )}
        {props.requireText && (
          <label className="field">
            <span>
              Type <code>{props.requireText}</code> to confirm
            </span>
            <input
              value={typed}
              autoFocus
              onChange={(e) => setTyped(e.target.value)}
              placeholder={props.requireText}
              autoComplete="off"
              spellCheck={false}
            />
          </label>
        )}
        {error && <p className="error-text">{error}</p>}
        <div className="row end">
          <button className="btn ghost" onClick={props.onCancel} disabled={busy}>
            Cancel
          </button>
          <button
            ref={confirmRef}
            className={`btn${props.danger === false ? ' mint' : ' danger'}`}
            disabled={!matches || busy}
            onClick={() => void submit()}
          >
            {busy ? 'Working…' : (props.confirmLabel ?? 'Confirm')}
          </button>
        </div>
      </div>
    </div>
  )
}

/** Validated text input — replaces `window.prompt` everywhere. */
export function PromptDialog(props: {
  title: string
  label: string
  initial?: string
  placeholder?: string
  hint?: string
  confirmLabel?: string
  validate?: (value: string) => string | null
  onCancel: () => void
  onSubmit: (value: string) => Promise<void>
}): React.JSX.Element {
  const [value, setValue] = useState(props.initial ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useDismiss(props.onCancel)

  const validation = props.validate?.(value.trim()) ?? null

  async function submit(): Promise<void> {
    if (validation || value.trim() === '' || busy) return
    setBusy(true)
    setError(null)
    try {
      await props.onSubmit(value.trim())
      props.onCancel()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="modal-backdrop" onClick={props.onCancel}>
      <div
        className="modal glass strong dialog fade-in"
        role="dialog"
        aria-label={props.title}
        onClick={(e) => e.stopPropagation()}
      >
        <h3>{props.title}</h3>
        <form
          onSubmit={(e) => {
            e.preventDefault()
            void submit()
          }}
        >
          <label className="field">
            <span>{props.label}</span>
            <input
              value={value}
              autoFocus
              onChange={(e) => setValue(e.target.value)}
              placeholder={props.placeholder}
              autoComplete="off"
              spellCheck={false}
            />
          </label>
          {props.hint && !validation && <p className="muted small hint">{props.hint}</p>}
          {validation && value.trim() !== '' && <p className="error-text">{validation}</p>}
          {error && <p className="error-text">{error}</p>}
          <div className="row end">
            <button type="button" className="btn ghost" onClick={props.onCancel} disabled={busy}>
              Cancel
            </button>
            <button type="submit" className="btn mint" disabled={validation !== null || value.trim() === '' || busy}>
              {busy ? 'Working…' : (props.confirmLabel ?? 'Confirm')}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
