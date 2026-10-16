/**
 * Activity log persistence (pure). The main process keeps the activity feed in memory; on quit
 * it is written to `activity.json` in userData and read back on the next launch, so what
 * happened last session (including transfers cancelled by quitting) is still there.
 */
import type { ActivityEntry, ActivityKind, ActivityStatus } from './types'

export const ACTIVITY_FILE = 'activity.json'
export const ACTIVITY_STORE_VERSION = 1
/** Same cap as the in-memory feed. */
export const ACTIVITY_PERSIST_LIMIT = 120
/** Older entries are dropped on load: a week-old "upload complete" is noise, not history. */
export const ACTIVITY_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000

const KINDS: readonly ActivityKind[] = ['transfer', 'container', 'folder', 'blob', 'connection']
const STATUSES: readonly ActivityStatus[] = ['success', 'failed']

function optionalString(value: unknown, max = 4096): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value.slice(0, max) : undefined
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined
}

/** One entry from disk, or null when it isn't a usable entry. Unknown keys are dropped. */
export function parseActivityEntry(value: unknown): ActivityEntry | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  const r = value as Record<string, unknown>
  const id = optionalString(r.id, 200)
  const text = optionalString(r.text)
  const at = optionalNumber(r.at)
  if (!id || !text || at === undefined) return null
  if (!KINDS.includes(r.kind as ActivityKind) || !STATUSES.includes(r.status as ActivityStatus)) return null
  const entry: ActivityEntry = { id, at, kind: r.kind as ActivityKind, text, status: r.status as ActivityStatus }
  const detail = optionalString(r.detail)
  if (detail) entry.detail = detail
  const durationMs = optionalNumber(r.durationMs)
  if (durationMs !== undefined) entry.durationMs = durationMs
  const localPath = optionalString(r.localPath)
  if (localPath) entry.localPath = localPath
  if (r.transferDirection === 'upload' || r.transferDirection === 'download') entry.transferDirection = r.transferDirection
  if (r.fileDeleted === true) entry.fileDeleted = true
  const accountId = optionalString(r.accountId, 200)
  if (accountId) entry.accountId = accountId
  const container = optionalString(r.container, 1024)
  if (container) entry.container = container
  return entry
}

/** Newest-first, de-duplicated by id, capped, and without entries older than ACTIVITY_MAX_AGE_MS. */
export function parsePersistedActivities(value: unknown, now = Date.now()): ActivityEntry[] {
  if (typeof value !== 'object' || value === null) return []
  const record = value as Record<string, unknown>
  if (record.version !== ACTIVITY_STORE_VERSION || !Array.isArray(record.entries)) return []
  const seen = new Set<string>()
  const out: ActivityEntry[] = []
  for (const raw of record.entries) {
    const entry = parseActivityEntry(raw)
    if (!entry || seen.has(entry.id)) continue
    if (entry.at > now + 60_000 || now - entry.at > ACTIVITY_MAX_AGE_MS) continue
    seen.add(entry.id)
    out.push(entry)
  }
  out.sort((a, b) => b.at - a.at)
  return out.slice(0, ACTIVITY_PERSIST_LIMIT)
}

export function serializeActivities(entries: readonly ActivityEntry[]): string {
  return JSON.stringify({ version: ACTIVITY_STORE_VERSION, entries: entries.slice(0, ACTIVITY_PERSIST_LIMIT) })
}
