import { dialog } from 'electron'
import { randomUUID } from 'node:crypto'
import { mkdir, stat, unlink } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { decryptSecret } from './accounts'
import { logActivity } from './activity'
import { getMainWindow } from './window'
import {
  blobServiceFromSecret,
  dataLakeServiceFromSecret,
  expandFiles,
  friendlyError,
  isConnectionStringSecret,
  isDfsEndpoint
} from './azure'
import type {
  TransferDirection,
  TransferInfo,
  TransferStatus,
  TransfersSnapshot
} from '../shared/types'
import { formatBytes, formatDuration } from '../shared/format'

/* Tuning: 8 parallel block connections saturates most links without
 * hammering the service; 8 MiB blocks keep a 2 GiB file to 256 parts
 * (well under the 50k block limit) while staying memory-light. */
const DEFAULT_UPLOAD_CONCURRENCY = 8
const DEFAULT_MAX_PARALLEL = 2
const LARGE_FILE_BYTES = 1024 * 1024 * 1024
const LARGE_BLOCK_SIZE = 8 * 1024 * 1024
const EMIT_MS = 250

let uploadConcurrency = DEFAULT_UPLOAD_CONCURRENCY
let maxParallel = DEFAULT_MAX_PARALLEL

export function configureTransfers(opts: { uploadConcurrency?: number; maxParallel?: number }): TransfersSnapshot {
  if (opts.uploadConcurrency !== undefined) {
    uploadConcurrency = Math.min(16, Math.max(1, Math.floor(opts.uploadConcurrency)))
  }
  if (opts.maxParallel !== undefined) {
    maxParallel = Math.min(4, Math.max(1, Math.floor(opts.maxParallel)))
  }
  startNext()
  return snapshot()
}

interface ActiveTransfer {
  id: string
  spec: {
    direction: TransferDirection
    accountId: string
    accountName: string
    container: string
    /** Blob path. */
    name: string
    localPath: string
    totalBytes: number
    dfs: boolean
  }
  status: TransferStatus
  doneBytes: number
  error?: string
  controller?: AbortController
  enqueuedAt: number
  startedAt?: number
  finishedAt?: number
  lastTickAt: number
  speedBps: number
}

const transfers: ActiveTransfer[] = []
let emitTimer: NodeJS.Timeout | null = null

function emitNow(): void {
  if (emitTimer) {
    clearTimeout(emitTimer)
    emitTimer = null
  }
  getMainWindow()?.webContents.send('transfers:changed', snapshot())
}

function markDirty(): void {
  if (emitTimer) return
  emitTimer = setTimeout(() => {
    emitTimer = null
    getMainWindow()?.webContents.send('transfers:changed', snapshot())
  }, EMIT_MS)
}

function toInfo(t: ActiveTransfer): TransferInfo {
  const remaining = Math.max(0, t.spec.totalBytes - t.doneBytes)
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
    speedBps: t.status === 'active' && t.speedBps > 0 ? Math.round(t.speedBps) : undefined,
    etaSec:
      t.status === 'active' && t.speedBps > 0 && t.spec.totalBytes > 0
        ? remaining / t.speedBps
        : undefined,
    error: t.error,
    // Blob uploads stripe across N block connections; downloads and
    // DataLake paths report per-file progress on their own stream count.
    concurrency: t.spec.direction === 'upload' ? uploadConcurrency : 1,
    startedAt: t.startedAt,
    finishedAt: t.finishedAt
  }
}

const byId = new Map<string, ActiveTransfer>()

export function snapshot(): TransfersSnapshot {
  const list = [...byId.values()].map(toInfo)
  // Newest first for the panel; actives float above.
  list.sort((a, b) => {
    const rank = (s: TransferStatus): number =>
      s === 'active' ? 0 : s === 'queued' ? 1 : 2
    return rank(a.status) - rank(b.status) || (b.startedAt ?? 0) - (a.startedAt ?? 0)
  })
  const active = list.filter((t) => t.status === 'active')
  return {
    transfers: list,
    active: active.length,
    queued: list.filter((t) => t.status === 'queued').length,
    aggregateBps: Math.round(active.reduce((sum, t) => sum + (t.speedBps ?? 0), 0)),
    uploadConcurrency,
    maxParallel
  }
}

function enqueue(spec: ActiveTransfer['spec']): string {
  const id = randomUUID()
  const record: ActiveTransfer = {
    id,
    spec,
    status: 'queued',
    doneBytes: 0,
    enqueuedAt: Date.now(),
    lastTickAt: Date.now(),
    speedBps: 0
  }
  transfers.push(record)
  byId.set(id, record)
  emitNow()
  void startNext()
  return id
}

function activeCount(): number {
  let n = 0
  for (const t of byId.values()) if (t.status === 'active') n += 1
  return n
}

async function startNext(): Promise<void> {
  while (activeCount() < maxParallel) {
    const next = transfers.find((t) => t.status === 'queued')
    if (!next) break
    void run(next)
  }
}

function tick(id: string, loadedBytes: number): void {
  const t = byId.get(id)
  if (!t || t.status !== 'active') return
  const now = Date.now()
  const dt = (now - t.lastTickAt) / 1000
  if (dt > 0.05) {
    const instant = Math.max(0, loadedBytes - t.doneBytes) / dt
    t.speedBps = t.speedBps > 0 ? t.speedBps * 0.7 + instant * 0.3 : instant
    t.lastTickAt = now
  }
  t.doneBytes = Math.min(loadedBytes, t.spec.totalBytes || loadedBytes)
  if (t.spec.totalBytes === 0 && loadedBytes > 0) t.spec.totalBytes = loadedBytes
  markDirty()
}

function describe(t: ActiveTransfer): string {
  return t.spec.direction === 'upload'
    ? `Upload '${basename(t.spec.name)}' → '${t.spec.container}'`
    : `Download '${t.spec.name}' from '${t.spec.container}'`
}

async function run(t: ActiveTransfer): Promise<void> {
  t.status = 'active'
  t.startedAt = Date.now()
  t.lastTickAt = Date.now()
  t.controller = new AbortController()
  emitNow()
  const wallStart = Date.now()
  try {
    if (t.spec.direction === 'upload') {
      if (t.spec.dfs) await runDfsUpload(t)
      else await runBlobUpload(t)
    } else {
      if (t.spec.dfs) await runDfsDownload(t)
      else await runBlobDownload(t)
    }
    t.status = 'completed'
    t.doneBytes = t.spec.totalBytes
    t.finishedAt = Date.now()
    const size = formatBytes(t.spec.totalBytes)
    const conn = t.spec.direction === 'upload' ? ` · ${uploadConcurrency} connections` : ''
    logActivity({
      kind: 'transfer',
      text: `${describe(t)} complete`,
      detail: `${size} in ${formatDuration(t.finishedAt - wallStart)}${conn}`,
      status: 'success',
      durationMs: t.finishedAt - wallStart
    })
  } catch (err) {
    if (t.controller?.signal.aborted || (err instanceof Error && err.name === 'AbortError')) {
      t.status = 'cancelled'
      t.finishedAt = Date.now()
      // Remove partial downloads so a retry starts clean.
      if (t.spec.direction === 'download') {
        await unlink(t.spec.localPath).catch(() => {})
      }
      logActivity({ kind: 'transfer', text: `${describe(t)} cancelled`, status: 'failed' })
    } else {
      const friendly = friendlyError(err, `${t.spec.direction === 'upload' ? 'Upload' : 'Download'} failed`)
      t.status = 'failed'
      t.error = friendly.message
      t.finishedAt = Date.now()
      logActivity({
        kind: 'transfer',
        text: `${describe(t)} failed`,
        detail: friendly.message,
        status: 'failed',
        durationMs: Date.now() - wallStart
      })
    }
  } finally {
    t.controller = undefined
    emitNow()
    void startNext()
  }
}

/* ---------------- engines ---------------- */

async function runBlobUpload(t: ActiveTransfer): Promise<void> {
  const { profile, secret } = decryptSecret(t.spec.accountId)
  const svc = blobServiceFromSecret(profile.endpoint, secret)
  const blob = svc.getContainerClient(t.spec.container).getBlockBlobClient(t.spec.name)
  await blob.uploadFile(t.spec.localPath, {
    blockSize: t.spec.totalBytes >= LARGE_FILE_BYTES ? LARGE_BLOCK_SIZE : undefined,
    concurrency: uploadConcurrency,
    onProgress: (e) => tick(t.id, e.loadedBytes),
    abortSignal: t.controller?.signal
  })
}

async function runDfsUpload(t: ActiveTransfer): Promise<void> {
  const { secret } = decryptSecret(t.spec.accountId)
  const fs = dataLakeServiceFromSecret(secret).getFileSystemClient(t.spec.container)
  const file = fs.getFileClient(t.spec.name)
  await file.create().catch(() => {})
  await file.uploadFile(t.spec.localPath, {
    maxConcurrency: uploadConcurrency,
    onProgress: (e) => tick(t.id, e.loadedBytes),
    abortSignal: t.controller?.signal
  })
}

async function runBlobDownload(t: ActiveTransfer): Promise<void> {
  const { profile, secret } = decryptSecret(t.spec.accountId)
  const svc = blobServiceFromSecret(profile.endpoint, secret)
  const blob = svc.getContainerClient(t.spec.container).getBlobClient(t.spec.name)
  try {
    const props = await blob.getProperties()
    if (props.contentLength) t.spec.totalBytes = props.contentLength
  } catch {
    // Size stays as listed; progress still streams by bytes.
  }
  await mkdir(join(t.spec.localPath, '..'), { recursive: true }).catch(() => {})
  await blob.downloadToFile(t.spec.localPath, 0, undefined, {
    maxRetryRequests: 10,
    onProgress: (e) => tick(t.id, e.loadedBytes),
    abortSignal: t.controller?.signal
  })
}

async function runDfsDownload(t: ActiveTransfer): Promise<void> {
  const { secret } = decryptSecret(t.spec.accountId)
  const fs = dataLakeServiceFromSecret(secret).getFileSystemClient(t.spec.container)
  const file = fs.getFileClient(t.spec.name)
  try {
    const props = await file.getProperties()
    if (props.contentLength) t.spec.totalBytes = props.contentLength
  } catch {
    // Size stays as listed; progress still streams by bytes.
  }
  await mkdir(join(t.spec.localPath, '..'), { recursive: true }).catch(() => {})
  await file.readToFile(t.spec.localPath, 0, undefined, {
    onProgress: (e) => tick(t.id, e.loadedBytes),
    abortSignal: t.controller?.signal
  })
}

/* ---------------- public ops ---------------- */

export async function enqueueUpload(
  accountId: string,
  container: string,
  prefix?: string
): Promise<string[]> {
  const win = getMainWindow()
  const picked = await dialog.showOpenDialog(win!, {
    title: 'Upload to Blobfish',
    properties: ['openFile', 'multiSelections']
  })
  if (picked.canceled || picked.filePaths.length === 0) return []
  const { profile } = decryptSecret(accountId)
  const base = [profile.prefix, prefix].filter(Boolean).join('/').replace(/^\/+|\/+$/g, '')
  const ids: string[] = []
  for (const fp of picked.filePaths) {
    const size = (await stat(fp).catch(() => null))?.size ?? 0
    const dest = base ? `${base}/${basename(fp)}` : basename(fp)
    ids.push(
      enqueue({
        direction: 'upload',
        accountId,
        accountName: profile.name,
        container,
        name: dest,
        localPath: fp,
        totalBytes: size,
        dfs: isDfsEndpoint(profile.endpoint)
      })
    )
  }
  return ids
}

export async function enqueueDownload(
  accountId: string,
  container: string,
  names: string[]
): Promise<string[]> {
  if (names.length === 0) throw new Error('Nothing selected to download.')
  const win = getMainWindow()
  const picked = await dialog.showOpenDialog(win!, {
    title: 'Download destination',
    properties: ['openDirectory', 'createDirectory']
  })
  if (picked.canceled || picked.filePaths.length === 0) return []
  const destDir = picked.filePaths[0]!
  const { profile, secret } = decryptSecret(accountId)
  const files = await expandFiles(profile.endpoint, secret, container, names)
  const targets: Array<{ name: string; size?: number }> =
    files.length > 0 ? files : names.filter((n) => !n.endsWith('/')).map((name) => ({ name }))
  const ids: string[] = []
  for (const f of targets) {
    // Preserve folder structure relative to the common root for multi-picks.
    const rel = f.name.includes('/') ? f.name.slice(f.name.indexOf('/') + 1) : basename(f.name)
    ids.push(
      enqueue({
        direction: 'download',
        accountId,
        accountName: profile.name,
        container,
        name: f.name,
        localPath: join(destDir, rel || basename(f.name)),
        totalBytes: f.size ?? 0,
        dfs: isDfsEndpoint(profile.endpoint)
      })
    )
  }
  return ids
}

export function cancelTransfer(id: string): TransfersSnapshot {
  const t = byId.get(id)
  if (!t) return snapshot()
  if (t.status === 'active') {
    t.controller?.abort()
  } else if (t.status === 'queued') {
    t.status = 'cancelled'
    t.finishedAt = Date.now()
  }
  emitNow()
  return snapshot()
}

export function cancelAll(): TransfersSnapshot {
  for (const t of byId.values()) {
    if (t.status === 'active') t.controller?.abort()
    else if (t.status === 'queued') {
      t.status = 'cancelled'
      t.finishedAt = Date.now()
    }
  }
  emitNow()
  return snapshot()
}

export function retryTransfer(id: string): TransfersSnapshot {
  const t = byId.get(id)
  if (!t || (t.status !== 'failed' && t.status !== 'cancelled')) return snapshot()
  t.status = 'queued'
  t.error = undefined
  t.doneBytes = 0
  t.speedBps = 0
  t.startedAt = undefined
  t.finishedAt = undefined
  // Retries jump the queue so a failed 2 GiB upload restarts immediately.
  const idx = transfers.indexOf(t)
  if (idx > 0) {
    transfers.splice(idx, 1)
    const firstActive = transfers.findIndex((x) => x.status === 'active')
    transfers.splice(firstActive === -1 ? transfers.length : firstActive, 0, t)
  }
  emitNow()
  void startNext()
  return snapshot()
}

/** Drop finished rows from the panel (queued/active are untouched). */
export function clearFinished(): TransfersSnapshot {
  for (const [id, t] of byId) {
    if (t.status === 'completed' || t.status === 'failed' || t.status === 'cancelled') {
      byId.delete(id)
      const idx = transfers.indexOf(t)
      if (idx !== -1) transfers.splice(idx, 1)
    }
  }
  emitNow()
  return snapshot()
}
