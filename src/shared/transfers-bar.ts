/**
 * Collapsed transfers bar chips (pure). Completed transfers leave the transfers list and
 * live on in the activity feed, so the "done" count has to come from there: counting rows
 * showed "✓ 0" right after a download finished. Rows left over are failed/cancelled.
 */
import type { ActivityEntry } from './types'

export interface BarChips {
  /** Successful transfers in the activity feed (0 = hide the chip). */
  done: number
  /** Failed or cancelled rows still in the transfers list (0 = hide the chip). */
  failed: number
}

export function barChips(
  activities: readonly Pick<ActivityEntry, 'kind' | 'status'>[],
  leftoverRows: number
): BarChips {
  let done = 0
  for (const a of activities) if (a.kind === 'transfer' && a.status === 'success') done++
  return { done, failed: Math.max(0, leftoverRows) }
}
