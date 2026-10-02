import { randomUUID } from 'node:crypto'
import { getMainWindow } from './window'
import type { ActivityEntry, ActivityKind, ActivityStatus } from '../shared/types'

const MAX_ENTRIES = 120

let entries: ActivityEntry[] = []

function emit(): void {
  getMainWindow()?.webContents.send('activity:changed', entries)
}

export function logActivity(input: {
  kind: ActivityKind
  text: string
  detail?: string
  status: ActivityStatus
  durationMs?: number
}): ActivityEntry {
  const entry: ActivityEntry = {
    id: randomUUID(),
    at: Date.now(),
    kind: input.kind,
    text: input.text,
    detail: input.detail,
    status: input.status,
    durationMs: input.durationMs
  }
  entries = [entry, ...entries].slice(0, MAX_ENTRIES)
  emit()
  return entry
}

export function listActivities(): ActivityEntry[] {
  return entries
}

/** 'completed' clears everything (all entries are finished events); 'successful' keeps failures. */
export function clearActivities(mode: 'completed' | 'successful'): ActivityEntry[] {
  entries = mode === 'completed' ? [] : entries.filter((e) => e.status !== 'success')
  emit()
  return entries
}
