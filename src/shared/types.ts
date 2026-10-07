import type { BrowserWindow } from 'electron'

/**
 * Shared contracts between main ↔ preload ↔ renderer.
 * Everything here is types only, so it is safe to import from any process.
 * Runtime values live in `./config`.
 */

/** A vibrancy material accepted by `win.setVibrancy()`. Derived from Electron's
 * own types so it can never drift from the installed version. */
export type VibrancyName = NonNullable<Parameters<BrowserWindow['setVibrancy']>[0]>

export interface SysInfo {
  platform: NodeJS.Platform
  arch: string
  release: string
  hostname: string
  cpus: number
  totalMem: number
  freeMem: number
}

export interface GlassState {
  platform: NodeJS.Platform
  vibrancy: VibrancyName | null
  transparent: boolean
}

/* ---------- Blobfish storage accounts (foundational slice) ---------- */

/**
 * Attach scope, mirroring Azure Storage Explorer's connect dialog:
 * - `account`: Storage account or service (account-level SAS / connection string,
 *   can list all containers).
 * - `blob-container`: individual Blob container or directory (container SAS URL
 *   or connection string + container name, optionally scoped to a prefix).
 * - `adls-container`: individual ADLS Gen2 container or directory (dfs endpoint,
 *   same shape as blob-container but listed via the DataLake SDK).
 */
export type StorageKind = 'account' | 'blob-container' | 'adls-container'

export const STORAGE_KINDS: readonly StorageKind[] = [
  'account',
  'blob-container',
  'adls-container'
] as const

export type AuthType = 'connection-string' | 'sas'

/** Non-secret metadata sent to the renderer. Secrets never leave main. */
export interface AccountSummary {
  id: string
  name: string
  kind: StorageKind
  /** Origin only, e.g. `https://myacct.blob.core.windows.net`. */
  endpoint: string
  containerName?: string
  /** Base directory inside the container (no leading/trailing slash). */
  prefix?: string
  authType: AuthType
  accountName?: string
  createdAt: number
  /** ISO expiry parsed from the SAS `se=` param, when present. */
  sasExpiry?: string | null
  /** Pinned attachments appear under Quick Access in the sidebar. */
  pinned?: boolean
}

export interface AccountCreateInput {
  name: string
  kind: StorageKind
  /** Connection string OR full SAS URL (service/container). */
  secret: string
  /** Required when `secret` is a connection string and kind != account. */
  containerName?: string
  /** Optional directory inside the container. */
  prefix?: string
}

export interface AccountUpdateInput {
  name?: string
  prefix?: string
}

export interface StorageContainer {
  name: string
  lastModified?: string
}

export interface StorageBlobItem {
  /** Full name relative to the container (prefix + leaf). */
  name: string
  /** Display leaf name. */
  leaf: string
  isPrefix: boolean
  size?: number
  lastModified?: string
  contentType?: string
}

export interface ListBlobsArgs {
  accountId: string
  container?: string
  prefix?: string
  pageSize?: number
}

export interface ListBlobsResult {
  container: string
  /** Effective prefix actually listed (base prefix + navigation). */
  prefix: string
  items: StorageBlobItem[]
}

/* ---------- CRUD ---------- */

export interface ContainerActionArgs {
  accountId: string
  container: string
}

export interface DeleteBlobsArgs {
  accountId: string
  container: string
  /** Blob names (or folder prefixes ending in `/`) to delete. */
  names: string[]
}

export interface CreateFolderArgs {
  accountId: string
  container: string
  /** Current prefix listings are scoped under. */
  prefix?: string
  folderName: string
}

export interface RenameBlobArgs {
  accountId: string
  container: string
  source: string
  destLeaf: string
}

export interface RenameContainerArgs {
  accountId: string
  source: string
  dest: string
}

/* ---------- Preview (range-based, never downloads the whole blob) ---------- */

export type PreviewFlavor = 'csv' | 'text'

export interface PreviewArgs {
  accountId: string
  container: string
  /** Full blob name. */
  name: string
  /** Byte offset to start this page at. Defaults to 0. */
  offset?: number
  /** Max bytes to fetch (clamped server-side to 4 KiB – 1 MiB). */
  maxBytes?: number
  /** Max lines to return per page (clamped server-side to 1 – 2000). */
  maxLines?: number
}

export interface PreviewResult {
  name: string
  /** Total blob size in bytes. */
  size: number
  contentType?: string
  /** `csv` renders a table; `text` renders monospaced lines. */
  flavor: PreviewFlavor
  /** True when the sample contains NUL bytes — metadata only, no text. */
  binary: boolean
  /**
   * True when neither the extension nor the content type claims text, but the
   * bytes sniff as text. Shown as a "best guess" hint in the UI.
   */
  guessed?: boolean
  encoding: string
  /** Byte offset this page started at. */
  offset: number
  /** Byte offset the next page should request. Equals `size` at EOF. */
  nextOffset: number
  eof: boolean
  /** Decoded text for this page (line-aligned except huge single lines). */
  text: string
  /** Bytes of usable text in this page. */
  bytesFetched: number
  /** Page ends mid-line; the next page continues the same line. */
  cutMidLine: boolean
}

export interface UploadEnqueueArgs {
  accountId: string
  container: string
  prefix?: string
}

export interface DownloadArgs {
  accountId: string
  container: string
  names: string[]
}

/* ---------- Transfers + activity ---------- */

export type TransferDirection = 'upload' | 'download'
export type TransferStatus = 'queued' | 'active' | 'completed' | 'failed' | 'cancelled'

export interface TransferInfo {
  id: string
  direction: TransferDirection
  accountId: string
  accountName: string
  container: string
  /** Blob path (upload destination / download source). */
  name: string
  totalBytes: number
  doneBytes: number
  status: TransferStatus
  /** Local filesystem path (download destination / upload source). */
  localPath?: string
  /** Exponential moving average, bytes/sec. */
  speedBps?: number
  etaSec?: number
  error?: string
  /** Parallel connections this transfer may use. */
  concurrency: number
  startedAt?: number
  finishedAt?: number
}

export interface TransfersSnapshot {
  transfers: TransferInfo[]
  active: number
  queued: number
  aggregateBps: number
  uploadConcurrency: number
  maxParallel: number
}

export interface TransferConfigure {
  uploadConcurrency?: number
  maxParallel?: number
}

/* ---------- Activity ---------- */
export type ActivityStatus = 'success' | 'failed'
export type ActivityKind = 'transfer' | 'container' | 'folder' | 'blob' | 'connection'

export interface ActivityEntry {
  id: string
  at: number
  kind: ActivityKind
  text: string
  detail?: string
  status: ActivityStatus
  durationMs?: number
  localPath?: string
  transferDirection?: TransferDirection
  fileDeleted?: boolean
}
