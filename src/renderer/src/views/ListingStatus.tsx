import type { ListingPhase } from '../../../shared/listing-pager'
import './ListingStatus.css'

const count = new Intl.NumberFormat()

/** One-line strip under the action bar while a big folder is still listing,
 *  or when it paused with more to load. Says plainly that filter / sort /
 *  select all only see the rows loaded so far. */
export default function ListingStatus(props: {
  phase: ListingPhase | undefined
  loaded: number
  error?: string
  filtering: boolean
  onStop: () => void
  onLoadMore: () => void
}): React.JSX.Element | null {
  const { phase, loaded } = props
  if (phase !== 'more' && phase !== 'cap' && phase !== 'stopped' && phase !== 'error') return null
  const n = count.format(loaded)
  const scope = props.filtering ? 'Filter, sort and select all cover these only.' : 'Sort and select all cover these only.'
  let text: string
  if (phase === 'more') text = `Loading more… ${n} items so far.`
  else if (phase === 'cap') text = `Showing the first ${n} items. This folder has more.`
  else if (phase === 'stopped') text = `Stopped at ${n} items. This folder has more.`
  else text = `Couldn't load the rest after ${n} items${props.error ? `: ${props.error}` : '.'}`
  return (
    <div className={`listing-status ${phase}`} role="status" aria-live="polite">
      {phase === 'more' && <span className="listing-status-spin" aria-hidden />}
      <span className="listing-status-text">
        {text} <span className="listing-status-scope">{scope}</span>
      </span>
      {phase === 'more' ? (
        <button className="btn ghost small" onClick={props.onStop}>
          Stop
        </button>
      ) : (
        <button className="btn ghost small" onClick={props.onLoadMore}>
          {phase === 'error' ? 'Retry' : 'Load more'}
        </button>
      )}
    </div>
  )
}
