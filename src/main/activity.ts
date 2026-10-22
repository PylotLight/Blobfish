import { app, shell } from "electron";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { rename, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { getMainWindow } from "./window";
import {
  ACTIVITY_FILE,
  parsePersistedActivities,
  serializeActivities,
} from "../shared/activity-store";
import type {
  ActivityEntry,
  ActivityKind,
  ActivityStatus,
  TransferDirection,
} from "../shared/types";

const MAX_ENTRIES = 120;
/**
 * Identical failures fired in bursts (sidebar prefetch + explorer listing
 * hitting the same 403 off VPN) collapse into one entry instead of spamming
 * the dock. Comparison ignores the quoted resource names — "List blobs in
 * 'chat-x' failed" and "Access container 'chat-x' failed" share the same
 * normalized detail — and scans recent history, not just the latest entry.
 */
const DEDUPE_MS = 30_000;
const DEDUPE_SCAN = 8;

function normalizeDetail(detail: string | undefined): string {
  return (detail ?? "")
    .toLowerCase()
    .replace(/['"][^'"]*['"]/g, "'…'")
    .replace(/\s+/g, " ")
    .trim();
}

let entries: ActivityEntry[] = [];

function emit(): void {
  getMainWindow()?.webContents.send("activity:changed", entries);
}

export function logActivity(input: {
  kind: ActivityKind;
  text: string;
  detail?: string;
  status: ActivityStatus;
  durationMs?: number;
  localPath?: string;
  transferDirection?: TransferDirection;
  accountId?: string;
  container?: string;
}): ActivityEntry {
  const now = Date.now();
  const normDetail = normalizeDetail(input.detail);
  for (const existing of entries.slice(0, DEDUPE_SCAN)) {
    if (
      existing.kind === input.kind &&
      existing.status === input.status &&
      normalizeDetail(existing.detail) === normDetail &&
      now - existing.at < DEDUPE_MS
    ) {
      return existing;
    }
    // Stop scanning once entries are older than the window (list is newest-first).
    if (now - existing.at >= DEDUPE_MS) break;
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
    transferDirection: input.transferDirection,
    accountId: input.accountId,
    container: input.container,
  };
  entries = [entry, ...entries].slice(0, MAX_ENTRIES);
  emit();
  return entry;
}

export function listActivities(): ActivityEntry[] {
  return entries;
}

/** 'completed' clears everything (all entries are finished events); 'successful' keeps failures. */
export function clearActivities(
  mode: "completed" | "successful",
): ActivityEntry[] {
  entries =
    mode === "completed" ? [] : entries.filter((e) => e.status !== "success");
  emit();
  return entries;
}

export async function deleteDownloadedFile(
  id: string,
  pathOverride?: string,
): Promise<{ success: boolean; movedOrMissing?: boolean; message: string }> {
  const entry = entries.find((e) => e.id === id);
  const targetPath = pathOverride || entry?.localPath;
  if (!targetPath) {
    return { success: false, message: "File path unknown." };
  }

  // Catch error when moving item to trash or unlinking if trying to delete something that has already moved or been removed
  try {
    if (!existsSync(targetPath)) {
      if (entry) {
        entry.fileDeleted = true;
        emit();
      }
      return {
        success: true,
        movedOrMissing: true,
        message: "File has already been moved or deleted.",
      };
    }

    try {
      await shell.trashItem(targetPath);
    } catch {
      // If moving to system trash fails, fallback to unlink
      try {
        await unlink(targetPath);
      } catch (unlinkErr: unknown) {
        const isEnoent =
          (typeof unlinkErr === "object" &&
            unlinkErr !== null &&
            "code" in unlinkErr &&
            (unlinkErr as { code?: string }).code === "ENOENT") ||
          !existsSync(targetPath);
        if (isEnoent) {
          if (entry) {
            entry.fileDeleted = true;
            emit();
          }
          return {
            success: true,
            movedOrMissing: true,
            message: "File has already been moved or deleted.",
          };
        }
        throw unlinkErr;
      }
    }

    if (entry) {
      entry.fileDeleted = true;
      emit();
    }
    return { success: true, message: "File moved to trash." };
  } catch (err: unknown) {
    const isEnoent =
      (typeof err === "object" &&
        err !== null &&
        "code" in err &&
        (err as { code?: string }).code === "ENOENT") ||
      !existsSync(targetPath);
    if (isEnoent) {
      if (entry) {
        entry.fileDeleted = true;
        emit();
      }
      return {
        success: true,
        movedOrMissing: true,
        message: "File has already been moved or deleted.",
      };
    }
    return {
      success: false,
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

/* ---------------- persistence (ordered shutdown writes it, launch reads it back) ---------------- */

function activityPath(): string {
  return join(app.getPath("userData"), ACTIVITY_FILE);
}

/** Read last session's activity feed. Call once at startup, before the window asks for it. */
let loaded = false;

export function loadActivities(): void {
  loaded = true;
  try {
    const path = activityPath();
    if (!existsSync(path)) return;
    const restored = parsePersistedActivities(
      JSON.parse(readFileSync(path, "utf8")),
    );
    // Anything logged before load (unlikely this early) stays on top.
    const ids = new Set(entries.map((e) => e.id));
    entries = [...entries, ...restored.filter((e) => !ids.has(e.id))].slice(
      0,
      MAX_ENTRIES,
    );
  } catch (err) {
    console.warn(
      "[activity] could not read activity log:",
      err instanceof Error ? err.message : String(err),
    );
  }
}

/** Write the feed atomically (temp + rename, 0600: it holds local paths and account ids). */
export async function saveActivities(): Promise<void> {
  // Quitting before launch finished must not replace last session's log with an empty one.
  if (!loaded) return;
  const path = activityPath();
  await writeFile(`${path}.tmp`, serializeActivities(entries), { mode: 0o600 });
  await rename(`${path}.tmp`, path);
}
