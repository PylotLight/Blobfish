import { dialog } from 'electron'
import { randomUUID } from 'node:crypto'
import { mkdir, readdir, stat } from 'node:fs/promises'
import { basename, join, relative, sep } from 'node:path'
import { decryptSecret } from './accounts'
import { logActivity } from './activity'
import { getMainWindow } from './window'
import {
  blobContainerClientFromSecret,
  dataLakeFileSystemClientFromSecret,
  friendlyError,
  isDfsEndpoint
} from './azure'
import type {
  TransferDirection,
  TransferInfo,
  TransferStatus,
  TransfersDelta,
  TransfersSnapshot,
  TransfersSummary
} from '../shared/types'
import { formatBytes, formatDuration } from '../shared/format'
import { compareTransfers } from '../shared/transfers-delta'
import { downloadConnections, downloadRangesToFile, downloadViaPartFile, type RangeReader } from './ranged-download'

/* Tuning: 8 parallel block connections saturates most links without
 * hammering the service; 8 MiB blocks keep a 2 GiB file to 256 parts
 * (well under the 50k block limit) while staying memory-light. */
const DEFAULT_UPLOAD_CONCURRENCY = 8
const DEFAULT_MAX_PARALLEL = 2
const LARGE_FILE_BYTES = 1024 * 1024 * 1024
const LARGE_BLOCK_SIZE = 8 * 1024 * 1024
/* Anything bigger than this is striped across `uploadConcurrency` block
 * connections. The SDK defaults (blob: 256 MiB, DataLake: 100 MiB) send
 * everything below that as ONE request on ONE connection, so a 200 MB file
 * never used the parallel path at all. */
const SINGLE_SHOT_BYTES = 8 * 1024 * 1024
const EMIT_MS = 250

let uploadConcurrency = DEFAULT_UPLOAD_CONCURRENCY
let maxParallel = DEFAULT_MAX_PARALLEL

export function configureTransfers(opts: { uploadConcurrency?: number; maxParallel?: number }): TransfersSummary {
  if (opts.uploadConcurrency !== undefined) {
    uploadConcurrency = Math.min(16, Math.max(1, Math.floor(opts.uploadConcurrency)))
  }
  if (opts.maxParallel !== undefined) {
    maxParallel = Math.min(4, Math.max(1, Math.floor(opts.maxParallel)))
  }
  startNext()
  // Queued rows show the connections they will use; only resend the ones that changed.
  for (const t of byId.values()) {
    if (t.status !== 'queued') continue
    const c = connectionsFor(t.spec.direction, t.spec.totalBytes)
    if (c !== t.connections) {
      t.connections = c
      markDirty(t.id)
    }
  }
  return summary()
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
  seq: number
  /** Connections this transfer is using / will use. */
  connections: number
  doneBytes: number
  error?: string
  controller?: AbortController
  enqueuedAt: number
  startedAt?: number
  finishedAt?: number
  lastTickAt: number
  /** doneBytes at lastTickAt: speed is measured over the whole window, not the last callback. */
  lastTickBytes: number
  speedBps: number
}

const transfers: ActiveTransfer[] = []
let emitTimer: NodeJS.Timeout | null = null
let seqCounter = 0
let retrySeq = 0
/** Last emitted rev; the renderer applies delta `rev` on top of `rev - 1`. */
let rev = 0
/* Rows changed / removed since the last emit. Emits carry only these, so a 5,000-file
 * queue costs a few KB per progress tick instead of the whole list. */
const dirty = new Set<string>()
const removed = new Set<string>()

function buildDelta(): TransfersDelta {
  rev += 1
  const upserts: TransferInfo[] = []
  for (const id of dirty) {
    const t = byId.get(id)
    if (t) upserts.push(toInfo(t))
  }
  const delta: TransfersDelta = { ...summary(), upserts, removed: [...removed] }
  dirty.clear()
  removed.clear()
  return delta
}

function emitNow(): void {
  if (emitTimer) {
    clearTimeout(emitTimer)
    emitTimer = null
  }
  getMainWindow()?.webContents.send('transfers:changed', buildDelta())
}

function markDirty(id?: string): void {
  if (id !== undefined) dirty.add(id)
  if (emitTimer) return
  emitTimer = setTimeout(() => {
    emitTimer = null
    getMainWindow()?.webContents.send('transfers:changed', buildDelta())
  }, EMIT_MS)
}

function forget(t: ActiveTransfer): void {
  byId.delete(t.id)
  dirty.delete(t.id)
  removed.add(t.id)
  const idx = transfers.indexOf(t)
  if (idx !== -1) transfers.splice(idx, 1)
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
    localPath: t.spec.localPath,
    // Uploads stripe blocks and downloads fetch ranges across N connections
    // (files up to 8 MiB go in one request).
    concurrency: t.connections,
    seq: t.seq,
    startedAt: t.startedAt,
    finishedAt: t.finishedAt
  }
}

const byId = new Map<string, ActiveTransfer>()

function connectionsFor(direction: TransferDirection, totalBytes: number): number {
  if (totalBytes > 0 && totalBytes <= SINGLE_SHOT_BYTES) return 1
  return direction === 'download' ? downloadConnections(totalBytes || Infinity, uploadConcurrency) : uploadConcurrency
}

/** Counts only: O(n) over the queue but no row serialization. */
export function summary(): TransfersSummary {
  let active = 0
  let queued = 0
  let finished = 0
  let up = 0
  let down = 0
  let aggregateBps = 0
  for (const t of byId.values()) {
    if (t.status === 'active') {
      active += 1
      if (t.speedBps > 0) aggregateBps += t.speedBps
    } else if (t.status === 'queued') queued += 1
    else finished += 1
    if (t.status === 'active' || t.status === 'queued') {
      if (t.spec.direction === 'upload') up += 1
      else down += 1
    }
  }
  return { rev, active, queued, finished, up, down, aggregateBps: Math.round(aggregateBps), uploadConcurrency, maxParallel }
}

/** Full list for `transfers:list` (window load, crash-guard reload, or a missed delta). */
export function snapshot(): TransfersSnapshot {
  // Newest first for the panel; actives float above.
  const list = [...byId.values()].map(toInfo).sort(compareTransfers)
  return { ...summary(), transfers: list }
}

function enqueue(spec: ActiveTransfer['spec']): string {
  const id = randomUUID()
  const record: ActiveTransfer = {
    id,
    spec,
    status: 'queued',
    seq: ++seqCounter,
    connections: connectionsFor(spec.direction, spec.totalBytes),
    doneBytes: 0,
    enqueuedAt: Date.now(),
    lastTickAt: Date.now(),
    lastTickBytes: 0,
    speedBps: 0
  }
  transfers.push(record)
  byId.set(id, record)
  // Coalesced: a folder download enqueues thousands of rows in one go, and a
  // full snapshot per row is O(n²) bytes over IPC.
  markDirty(id)
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
    // The SDK fires onProgress every ~64 KiB (thousands of times a second), so
    // diffing against the previous callback undercounted speed ~100x.
    const instant = Math.max(0, loadedBytes - t.lastTickBytes) / dt
    t.speedBps = t.speedBps > 0 ? t.speedBps * 0.7 + instant * 0.3 : instant
    t.lastTickAt = now
    t.lastTickBytes = loadedBytes
  }
  t.doneBytes = Math.min(loadedBytes, t.spec.totalBytes || loadedBytes)
  if (t.spec.totalBytes === 0 && loadedBytes > 0) t.spec.totalBytes = loadedBytes
  markDirty(id)
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
  t.lastTickBytes = 0
  t.controller = new AbortController()
  t.connections = connectionsFor(t.spec.direction, t.spec.totalBytes)
  markDirty(t.id)
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
    const conn = t.connections > 1 ? ` · ${t.connections} connections` : ''
    logActivity({
      kind: 'transfer',
      text: `${describe(t)} complete`,
      detail: `${size} in ${formatDuration(t.finishedAt - wallStart)}${conn}`,
      status: 'success',
      durationMs: t.finishedAt - wallStart,
      localPath: t.spec.localPath,
      transferDirection: t.spec.direction,
      accountId: t.spec.accountId,
      container: t.spec.container
    })
    // Completed transfers live on in the activity feed (which carries
    // Open/Reveal/Delete) — the transfers list keeps in-flight and
    // retryable rows only, so nothing appears twice.
    forget(t)
  } catch (err) {
    if (t.controller?.signal.aborted || (err instanceof Error && err.name === 'AbortError')) {
      t.status = 'cancelled'
      t.finishedAt = Date.now()
      // The engine already removed the partial (.blobfish-part) file, so a retry starts clean
      // and a file that was at the destination before is untouched.
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
    markDirty(byId.has(t.id) ? t.id : undefined)
    void startNext()
  }
}

/* ---------------- engines ---------------- */

async function runBlobUpload(t: ActiveTransfer): Promise<void> {
  const { secret } = await decryptSecret(t.spec.accountId)
  const blob = blobContainerClientFromSecret(secret, t.spec.container).getBlockBlobClient(t.spec.name)
  await blob.uploadFile(t.spec.localPath, {
    blockSize: t.spec.totalBytes >= LARGE_FILE_BYTES ? LARGE_BLOCK_SIZE : undefined,
    concurrency: uploadConcurrency,
    maxSingleShotSize: SINGLE_SHOT_BYTES,
    onProgress: (e) => tick(t.id, e.loadedBytes),
    abortSignal: t.controller?.signal
  })
}

async function runDfsUpload(t: ActiveTransfer): Promise<void> {
  const { secret } = await decryptSecret(t.spec.accountId)
  const fs = dataLakeFileSystemClientFromSecret(secret, t.spec.container)
  const file = fs.getFileClient(t.spec.name)
  await file.create().catch(() => {})
  await file.uploadFile(t.spec.localPath, {
    maxConcurrency: uploadConcurrency,
    singleUploadThreshold: SINGLE_SHOT_BYTES,
    onProgress: (e) => tick(t.id, e.loadedBytes),
    abortSignal: t.controller?.signal
  })
}

/* Range requests stream through the SDK's retriable reader (resumes a dropped
 * socket from the last byte) and are pinned to the ETag seen up front, so a blob
 * overwritten mid-download fails with 412 instead of stitching two versions. */
const RANGE_RETRY_REQUESTS = 5

async function rangedDownload(t: ActiveTransfer, read: RangeReader): Promise<void> {
  const size = t.spec.totalBytes
  t.connections = downloadConnections(size, uploadConcurrency)
  markDirty(t.id)
  await mkdir(join(t.spec.localPath, '..'), { recursive: true }).catch(() => {})
  await downloadViaPartFile(t.spec.localPath, (part) =>
    downloadRangesToFile(part, read, {
      size,
      concurrency: uploadConcurrency,
      signal: t.controller?.signal,
      onProgress: (loaded) => tick(t.id, loaded)
    })
  )
}

async function runBlobDownload(t: ActiveTransfer): Promise<void> {
  const { secret } = await decryptSecret(t.spec.accountId)
  const blob = blobContainerClientFromSecret(secret, t.spec.container).getBlobClient(t.spec.name)
  let etag: string | undefined
  let sized = false
  try {
    const props = await blob.getProperties({ abortSignal: t.controller?.signal })
    if (props.contentLength !== undefined) {
      t.spec.totalBytes = props.contentLength
      sized = true
    }
    etag = props.etag
  } catch (err) {
    if (t.controller?.signal.aborted) throw err
    // Size unknown: fall through to the SDK's single-stream download below.
  }
  if (!sized) {
    t.connections = 1
    await mkdir(join(t.spec.localPath, '..'), { recursive: true }).catch(() => {})
    await downloadViaPartFile(t.spec.localPath, (part) =>
      blob
        .downloadToFile(part, 0, undefined, {
          maxRetryRequests: 10,
          onProgress: (e) => tick(t.id, e.loadedBytes),
          abortSignal: t.controller?.signal
        })
        .then(() => undefined)
    )
    return
  }
  await rangedDownload(t, async (offset, count, signal) => {
    const res = await blob.download(offset, count, {
      abortSignal: signal,
      maxRetryRequests: RANGE_RETRY_REQUESTS,
      conditions: etag ? { ifMatch: etag } : undefined
    })
    return res.readableStreamBody as AsyncIterable<Uint8Array> | undefined
  })
}

async function runDfsDownload(t: ActiveTransfer): Promise<void> {
  const { secret } = await decryptSecret(t.spec.accountId)
  const fs = dataLakeFileSystemClientFromSecret(secret, t.spec.container)
  const file = fs.getFileClient(t.spec.name)
  let etag: string | undefined
  let sized = false
  try {
    const props = await file.getProperties({ abortSignal: t.controller?.signal })
    if (props.contentLength !== undefined) {
      t.spec.totalBytes = props.contentLength
      sized = true
    }
    etag = props.etag
  } catch (err) {
    if (t.controller?.signal.aborted) throw err
  }
  if (!sized) {
    t.connections = 1
    await mkdir(join(t.spec.localPath, '..'), { recursive: true }).catch(() => {})
    await downloadViaPartFile(t.spec.localPath, (part) =>
      file
        .readToFile(part, 0, undefined, {
          onProgress: (e) => tick(t.id, e.loadedBytes),
          abortSignal: t.controller?.signal
        })
        .then(() => undefined)
    )
    return
  }
  await rangedDownload(t, async (offset, count, signal) => {
    const res = await file.read(offset, count, {
      abortSignal: signal,
      maxRetryRequests: RANGE_RETRY_REQUESTS,
      conditions: etag ? { ifMatch: etag } : undefined
    })
    return res.readableStreamBody as AsyncIterable<Uint8Array> | undefined
  })
}

/* ---------------- public ops ---------------- */

/** Collision-safe destination: `report.csv` → `report (2).csv` when taken. */
function uniqueDownloadPath(destDir: string, rel: string, used: Set<string>): string {
  const clean = rel.replace(/^\/+/, '') || 'download'
  let candidate = join(destDir, clean)
  if (!used.has(candidate)) {
    used.add(candidate)
    return candidate
  }
  const slash = clean.lastIndexOf('/')
  const dir = slash === -1 ? '' : clean.slice(0, slash + 1)
  const file = slash === -1 ? clean : clean.slice(slash + 1)
  const dot = file.lastIndexOf('.')
  const stem = dot > 0 ? file.slice(0, dot) : file
  const ext = dot > 0 ? file.slice(dot) : ''
  let n = 2
  while (used.has(candidate)) {
    candidate = join(destDir, `${dir}${stem} (${n})${ext}`)
    n += 1
  }
  used.add(candidate)
  return candidate
}

export async function enqueueUpload(
  accountId: string,
  container: string,
  prefix?: string,
  folder = false
): Promise<string[]> {
  const win = getMainWindow()
  const picked = await dialog.showOpenDialog(win!, {
    title: folder ? 'Upload folder to Blobfish' : 'Upload to Blobfish',
    properties: folder ? ['openDirectory', 'multiSelections'] : ['openFile', 'multiSelections']
  })
  if (picked.canceled || picked.filePaths.length === 0) return []
  const { profile } = await decryptSecret(accountId)
  const base = [profile.prefix, prefix].filter(Boolean).join('/').replace(/^\/+|\/+$/g, '')
  // Folder upload keeps the picked folder's name and layout: <base>/<folder>/<sub>/<file>.
  const files: Array<{ fp: string; rel: string }> = []
  for (const picked0 of picked.filePaths) {
    if (!folder) {
      files.push({ fp: picked0, rel: basename(picked0) })
      continue
    }
    const parent = join(picked0, '..')
    const entries = await readdir(picked0, { recursive: true, withFileTypes: true }).catch(() => [])
    for (const entry of entries) {
      if (!entry.isFile()) continue // dirs are implicit in blob names; symlinks skipped
      const fp = join(entry.parentPath, entry.name)
      files.push({ fp, rel: relative(parent, fp).split(sep).join('/') })
    }
  }
  const ids: string[] = []
  for (const { fp, rel } of files) {
    const size = (await stat(fp).catch(() => null))?.size ?? 0
    const dest = base ? `${base}/${rel}` : rel
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
  const { profile, secret } = await decryptSecret(accountId)
  const dfs = isDfsEndpoint(profile.endpoint)
  // Explicitly picked files download flat (basename only) — selecting files
  // must never recreate parent dirs or pull in unpicked siblings. Selected
  // folders expand to the files beneath them, preserved relative to the
  // selected folder.
  const targets: Array<{ name: string; size?: number; rel: string }> = []
  const seenBlobs = new Set<string>()
  const pushFile = (name: string, size: number | undefined, rel: string): void => {
    if (!name || name.endsWith('/') || seenBlobs.has(name)) return
    seenBlobs.add(name)
    pushFileRaw(name, size, rel)
  }
  const pushFileRaw = (name: string, size: number | undefined, rel: string): void => {
    targets.push({ name, size, rel: rel === '' ? basename(name) : rel })
  }
  for (const n of names.filter((x) => !x.endsWith('/'))) {
    pushFileRaw(n, undefined, basename(n))
    seenBlobs.add(n)
  }
  const folders = names.filter((n) => n.endsWith('/'))
  if (dfs) {
    const fs = dataLakeFileSystemClientFromSecret(secret, container)
    for (const f of folders) {
      const trimmed = f.replace(/\/$/, '')
      for await (const p of fs.listPaths({
        path: trimmed === '' ? undefined : trimmed,
        recursive: true
      })) {
        if (p.isDirectory || !p.name) continue
        const rel =
          trimmed === '' || p.name === trimmed
            ? basename(p.name)
            : p.name.startsWith(`${trimmed}/`)
              ? p.name.slice(trimmed.length + 1)
              : basename(p.name)
        pushFile(p.name, p.contentLength, rel)
      }
    }
  } else {
    const client = blobContainerClientFromSecret(secret, container)
    for (const f of folders) {
      for await (const b of client.listBlobsFlat({ prefix: f })) {
        if (b.name.endsWith('/')) continue // folder marker, not a file
        const rel = b.name === f || !b.name.startsWith(f) ? basename(b.name) : b.name.slice(f.length)
        pushFile(b.name, b.properties?.contentLength, rel)
      }
    }
  }
  if (targets.length === 0) throw new Error('No files to download — the selected folder is empty.')
  const usedPaths = new Set<string>()
  const ids: string[] = []
  for (const f of targets) {
    ids.push(
      enqueue({
        direction: 'download',
        accountId,
        accountName: profile.name,
        container,
        name: f.name,
        localPath: uniqueDownloadPath(destDir, f.rel, usedPaths),
        totalBytes: f.size ?? 0,
        dfs
      })
    )
  }
  return ids
}

export function cancelTransfer(id: string): TransfersSummary {
  const t = byId.get(id)
  if (!t) return summary()
  if (t.status === 'active') {
    t.controller?.abort()
  } else if (t.status === 'queued') {
    t.status = 'cancelled'
    t.finishedAt = Date.now()
    dirty.add(t.id)
  }
  emitNow()
  return summary()
}

export function cancelAll(): TransfersSummary {
  for (const t of byId.values()) {
    if (t.status === 'active') t.controller?.abort()
    else if (t.status === 'queued') {
      t.status = 'cancelled'
      t.finishedAt = Date.now()
      dirty.add(t.id)
    }
  }
  emitNow()
  return summary()
}

export function retryTransfer(id: string): TransfersSummary {
  const t = byId.get(id)
  if (!t || (t.status !== 'failed' && t.status !== 'cancelled')) return summary()
  t.status = 'queued'
  t.seq = --retrySeq
  dirty.add(t.id)
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
  return summary()
}

/** Drop finished rows from the panel (queued/active are untouched). */
export function clearFinished(): TransfersSummary {
  for (const t of [...byId.values()]) {
    if (t.status === 'completed' || t.status === 'failed' || t.status === 'cancelled') forget(t)
  }
  emitNow()
  return summary()
}

/* ---------------- quit (ordered shutdown) ---------------- */

/** What the quit prompt needs: transfers still moving bytes or waiting their turn. */
export function inFlightCounts(): { active: number; queued: number } {
  let active = 0
  let queued = 0
  for (const t of byId.values()) {
    if (t.status === 'active') active += 1
    else if (t.status === 'queued') queued += 1
  }
  return { active, queued }
}

/**
 * Cancel everything in flight and wait (bounded) for the engines to unwind, so partial
 * downloads are removed and each cancel lands in the activity log before it is persisted.
 * Queued rows are cancelled first so nothing new starts while the active ones abort.
 */
export async function stopTransfersForQuit(timeoutMs = 4_000): Promise<number> {
  const now = Date.now()
  let cancelled = 0
  for (const t of byId.values()) {
    if (t.status !== 'queued') continue
    t.status = 'cancelled'
    t.finishedAt = now
    dirty.add(t.id)
    cancelled += 1
    logActivity({ kind: 'transfer', text: `${describe(t)} cancelled`, detail: 'Blobfish quit before it started', status: 'failed' })
  }
  const unwinding = [...byId.values()].filter((t) => t.status === 'active')
  for (const t of unwinding) t.controller?.abort()
  cancelled += unwinding.length
  const deadline = Date.now() + timeoutMs
  // run() clears `controller` in its finally, after the partial file is gone and the cancel is logged.
  while (unwinding.some((t) => t.controller) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  if (emitTimer) {
    clearTimeout(emitTimer)
    emitTimer = null
  }
  return cancelled
}
