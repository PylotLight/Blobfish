import { shell } from 'electron'
import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { unlink } from 'node:fs/promises'
import { getMainWindow } from './window'
import type { ActivityEntry, ActivityKind, ActivityStatus, TransferDirection } from '../shared/types'

const MAX_ENTRIES = 120
/** Identical failures fired in bursts (sidebar + explorer fetch the same
 * listing) collapse into one entry instead of spamming the dock. */
const DEDUPE_MS = 30_000

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
  localPath?: string
  transferDirection?: TransferDirection
}): ActivityEntry {
  const latest = entries[0]
  if (
    latest &&
    latest.kind === input.kind &&
    latest.text === input.text &&
    latest.detail === input.detail &&
    latest.status === input.status &&
    Date.now() - latest.at < DEDUPE_MS
  ) {
    return latest
  }
  const entry: ActivityEntry = {
    id: randomUUID(),
    at: Date.now(),
    kind: input.kind,
    text: input.text,
    detail: input.detail,
    status: input.status,
    durationMs: input.durationMs,
    localPath: input.localPath,
    transferDirection: input.transferDirection
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

export async function deleteDownloadedFile(
  id: string,
  pathOverride?: string
): Promise<{ success: boolean; movedOrMissing?: boolean; message: string }> {
  const entry = entries.find((e) => e.id === id)
  const targetPath = pathOverride || entry?.localPath
  if (!targetPath) {
    return { success: false, message: 'File path unknown.' }
  }

  // Catch error when moving item to trash or unlinking if trying to delete something that has already moved or been removed
  try {
    if (!existsSync(targetPath)) {
      if (entry) {
        entry.fileDeleted = true
        emit()
      }
      return { success: true, movedOrMissing: true, message: 'File has already been moved or deleted.' }
    }

    try {
      await shell.trashItem(targetPath)
    } catch {
      // If moving to system trash fails, fallback to unlink
      try {
        await unlink(targetPath)
      } catch (unlinkErr: unknown) {
        const isEnoent =
          (typeof unlinkErr === 'object' && unlinkErr !== null && 'code' in unlinkErr && (unlinkErr as { code?: string }).code === 'ENOENT') ||
          !existsSync(targetPath)
        if (isEnoent) {
          if (entry) {
            entry.fileDeleted = true
            emit()
          }
          return { success: true, movedOrMissing: true, message: 'File has already been moved or deleted.' }
        }
        throw unlinkErr
      }
    }

    if (entry) {
      entry.fileDeleted = true
      emit()
    }
    return { success: true, message: 'File moved to trash.' }
  } catch (err: unknown) {
    const isEnoent =
      (typeof err === 'object' && err !== null && 'code' in err && (err as { code?: string }).code === 'ENOENT') ||
      !existsSync(targetPath)
    if (isEnoent) {
      if (entry) {
        entry.fileDeleted = true
        emit()
      }
      return { success: true, movedOrMissing: true, message: 'File has already been moved or deleted.' }
    }
    return { success: false, message: err instanceof Error ? err.message : String(err) }
  }
}
