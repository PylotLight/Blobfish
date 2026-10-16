import type { TransferInfo, TransferStatus, TransfersDelta, TransfersSnapshot, TransfersSummary } from './types'

/**
 * Transfers reach the renderer as compact deltas: the rows that changed since the last
 * emit plus the ids that left. A 5,000-file folder download used to resend every row
 * (~1.6 MB) four times a second; now an emit carries the couple of active rows.
 */

const rank = (s: TransferStatus): number => (s === 'active' ? 0 : s === 'queued' ? 1 : 2)

/** Panel order: active, then queued (in queue order), then finished newest first. */
export function compareTransfers(a: TransferInfo, b: TransferInfo): number {
  return rank(a.status) - rank(b.status) || (b.startedAt ?? 0) - (a.startedAt ?? 0) || a.seq - b.seq
}

export interface TransfersView {
  rev: number
  summary: TransfersSummary
  rows: Map<string, TransferInfo>
  /** Ids in panel order. Reused as-is when an update only moves bytes. */
  order: string[]
}

function summaryOf(s: TransfersSummary): TransfersSummary {
  return {
    rev: s.rev,
    active: s.active,
    queued: s.queued,
    finished: s.finished,
    up: s.up,
    down: s.down,
    aggregateBps: s.aggregateBps,
    uploadConcurrency: s.uploadConcurrency,
    maxParallel: s.maxParallel
  }
}

function sortedIds(rows: Map<string, TransferInfo>): string[] {
  return [...rows.values()].sort(compareTransfers).map((t) => t.id)
}

export function viewFromSnapshot(snap: TransfersSnapshot): TransfersView {
  const rows = new Map(snap.transfers.map((t) => [t.id, t]))
  return { rev: snap.rev, summary: summaryOf(snap), rows, order: sortedIds(rows) }
}

/**
 * Apply one delta. Returns the same view for a stale delta, or `null` when a delta was
 * missed (rev gap), which means the caller should re-fetch the full list.
 */
export function applyTransfersDelta(view: TransfersView, delta: TransfersDelta): TransfersView | null {
  if (delta.rev <= view.rev) return view
  if (delta.rev !== view.rev + 1) return null
  const rows = new Map(view.rows)
  let reorder = delta.removed.length > 0
  for (const id of delta.removed) rows.delete(id)
  for (const t of delta.upserts) {
    const prev = rows.get(t.id)
    if (!prev || prev.status !== t.status || prev.startedAt !== t.startedAt || prev.seq !== t.seq) reorder = true
    rows.set(t.id, t)
  }
  return {
    rev: delta.rev,
    summary: summaryOf(delta),
    rows,
    order: reorder ? sortedIds(rows) : view.order
  }
}
