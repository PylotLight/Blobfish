import { basename } from "node:path";
import type {
  TransferDirection,
  TransferInfo,
  TransfersDelta,
  TransfersSnapshot,
  TransfersSummary,
} from "../../shared/types";
import { compareTransfers } from "../../shared/transfers-delta";
import { downloadConnections } from "../ranged-download";
import { getMainWindow } from "../window";
import {
  DEFAULT_MAX_PARALLEL,
  DEFAULT_UPLOAD_CONCURRENCY,
  EMIT_MS,
  SINGLE_SHOT_BYTES,
  type ActiveTransfer,
} from "./types";

export let uploadConcurrency = DEFAULT_UPLOAD_CONCURRENCY;
export let maxParallel = DEFAULT_MAX_PARALLEL;
export function setUploadConcurrency(n: number): void {
  uploadConcurrency = n;
}
export function setMaxParallel(n: number): void {
  maxParallel = n;
}
export function nextSeq(): number {
  seqCounter += 1;
  return seqCounter;
}
export function nextRetrySeq(): number {
  retrySeq -= 1;
  return retrySeq;
}
export function clearEmitTimer(): void {
  if (emitTimer) {
    clearTimeout(emitTimer);
    emitTimer = null;
  }
}
export const transfers: ActiveTransfer[] = [];
let emitTimer: NodeJS.Timeout | null = null;
export let seqCounter = 0;
export let retrySeq = 0;
/** Last emitted rev; the renderer applies delta `rev` on top of `rev - 1`. */
export let rev = 0;
/* Rows changed / removed since the last emit. Emits carry only these, so a 5,000-file
 * queue costs a few KB per progress tick instead of the whole list. */
export const dirty = new Set<string>();
export const removed = new Set<string>();

export function buildDelta(): TransfersDelta {
  rev += 1;
  const upserts: TransferInfo[] = [];
  for (const id of dirty) {
    const t = byId.get(id);
    if (t) upserts.push(toInfo(t));
  }
  const delta: TransfersDelta = {
    ...summary(),
    upserts,
    removed: [...removed],
  };
  dirty.clear();
  removed.clear();
  return delta;
}

export function emitNow(): void {
  if (emitTimer) {
    clearTimeout(emitTimer);
    emitTimer = null;
  }
  getMainWindow()?.webContents.send("transfers:changed", buildDelta());
}

export function markDirty(id?: string): void {
  if (id !== undefined) dirty.add(id);
  if (emitTimer) return;
  emitTimer = setTimeout(() => {
    emitTimer = null;
    getMainWindow()?.webContents.send("transfers:changed", buildDelta());
  }, EMIT_MS);
}

export function forget(t: ActiveTransfer): void {
  byId.delete(t.id);
  dirty.delete(t.id);
  removed.add(t.id);
  const idx = transfers.indexOf(t);
  if (idx !== -1) transfers.splice(idx, 1);
}

export function toInfo(t: ActiveTransfer): TransferInfo {
  const remaining = Math.max(0, t.spec.totalBytes - t.doneBytes);
  return {
    id: t.id,
    direction: t.spec.direction,
    accountId: t.spec.accountId,
    accountName: t.spec.accountName,
    container: t.spec.container,
    name: t.spec.name,
    totalBytes: t.spec.totalBytes,
    doneBytes: t.doneBytes,
    status: t.status,
    speedBps:
      t.status === "active" && t.speedBps > 0
        ? Math.round(t.speedBps)
        : undefined,
    etaSec:
      t.status === "active" && t.speedBps > 0 && t.spec.totalBytes > 0
        ? remaining / t.speedBps
        : undefined,
    error: t.error,
    localPath: t.spec.localPath,
    // Uploads stripe blocks and downloads fetch ranges across N connections
    // (files up to 8 MiB go in one request).
    concurrency: t.connections,
    seq: t.seq,
    startedAt: t.startedAt,
    finishedAt: t.finishedAt,
  };
}

export const byId = new Map<string, ActiveTransfer>();

export function connectionsFor(
  direction: TransferDirection,
  totalBytes: number,
): number {
  // Unknown size (0) shows 1 until the download's HEAD tells us how many ranges it gets.
  if (totalBytes <= SINGLE_SHOT_BYTES) return 1;
  return direction === "download"
    ? downloadConnections(totalBytes, uploadConcurrency)
    : uploadConcurrency;
}

/** Counts only: O(n) over the queue but no row serialization. */
export function summary(): TransfersSummary {
  let active = 0;
  let queued = 0;
  let finished = 0;
  let up = 0;
  let down = 0;
  let aggregateBps = 0;
  for (const t of byId.values()) {
    if (t.status === "active") {
      active += 1;
      if (t.speedBps > 0) aggregateBps += t.speedBps;
    } else if (t.status === "queued") queued += 1;
    else finished += 1;
    if (t.status === "active" || t.status === "queued") {
      if (t.spec.direction === "upload") up += 1;
      else down += 1;
    }
  }
  return {
    rev,
    active,
    queued,
    finished,
    up,
    down,
    aggregateBps: Math.round(aggregateBps),
    uploadConcurrency,
    maxParallel,
  };
}

/** Full list for `transfers:list` (window load, crash-guard reload, or a missed delta). */
export function snapshot(): TransfersSnapshot {
  // Newest first for the panel; actives float above.
  const list = [...byId.values()].map(toInfo).sort(compareTransfers);
  return { ...summary(), transfers: list };
}

export function tick(id: string, loadedBytes: number): void {
  const t = byId.get(id);
  if (!t || t.status !== "active") return;
  const now = Date.now();
  const dt = (now - t.lastTickAt) / 1000;
  if (dt > 0.05) {
    // The SDK fires onProgress every ~64 KiB (thousands of times a second), so
    // diffing against the previous callback undercounted speed ~100x.
    const instant = Math.max(0, loadedBytes - t.lastTickBytes) / dt;
    t.speedBps = t.speedBps > 0 ? t.speedBps * 0.7 + instant * 0.3 : instant;
    t.lastTickAt = now;
    t.lastTickBytes = loadedBytes;
  }
  t.doneBytes = Math.min(loadedBytes, t.spec.totalBytes || loadedBytes);
  if (t.spec.totalBytes === 0 && loadedBytes > 0)
    t.spec.totalBytes = loadedBytes;
  markDirty(id);
}

export function describe(t: ActiveTransfer): string {
  return t.spec.direction === "upload"
    ? `Upload '${basename(t.spec.name)}' → '${t.spec.container}'`
    : `Download '${t.spec.name}' from '${t.spec.container}'`;
}
