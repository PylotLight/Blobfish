import type { BrowserWindow } from "electron";

/**
 * Shared contracts between main ↔ preload ↔ renderer.
 * Everything here is types only, so it is safe to import from any process.
 * Runtime values live in `./config`.
 */

/** A vibrancy material accepted by `win.setVibrancy()`. Derived from Electron's
 * own types so it can never drift from the installed version. */
export type VibrancyName = NonNullable<
  Parameters<BrowserWindow["setVibrancy"]>[0]
>;

export interface SysInfo {
  platform: NodeJS.Platform;
  arch: string;
  release: string;
  hostname: string;
  cpus: number;
  totalMem: number;
  freeMem: number;
}

export interface GlassState {
  platform: NodeJS.Platform;
  vibrancy: VibrancyName | null;
  transparent: boolean;
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
export type StorageKind = "account" | "blob-container" | "adls-container";

export const STORAGE_KINDS: readonly StorageKind[] = [
  "account",
  "blob-container",
  "adls-container",
] as const;

export type AuthType = "connection-string" | "sas";

/** Non-secret metadata sent to the renderer. Secrets never leave main. */
export interface AccountSummary {
  id: string;
  name: string;
  kind: StorageKind;
  /** Origin only, e.g. `https://myacct.blob.core.windows.net`. */
  endpoint: string;
  containerName?: string;
  /** Base directory inside the container (no leading/trailing slash). */
  prefix?: string;
  authType: AuthType;
  accountName?: string;
  createdAt: number;
  /** ISO expiry parsed from the SAS `se=` param, when present. */
  sasExpiry?: string | null;
  /** Pinned attachments appear under Quick Access in the sidebar. */
  pinned?: boolean;
}

export interface AccountCreateInput {
  name: string;
  kind: StorageKind;
  /** Connection string OR full SAS URL (service/container). */
  secret: string;
  /** Required when `secret` is a connection string and kind != account. */
  containerName?: string;
  /** Optional directory inside the container. */
  prefix?: string;
}

/** Settings › Connections › Back up. `canceled` = user closed the save dialog. */
export type BackupSaveResult =
  | { ok: true; count: number; path: string }
  | { ok: false; canceled?: true; error?: string };

/** Settings › Connections › Restore. Merge only: `skipped` were already here. */
export type BackupRestoreResult =
  | { ok: true; added: number; skipped: number; invalid: number }
  | { ok: false; canceled?: true; error?: string };

export interface AccountUpdateInput {
  name?: string;
  prefix?: string;
}

export interface StorageContainer {
  name: string;
  lastModified?: string;
}

export interface StorageBlobItem {
  /** Full name relative to the container (prefix + leaf). */
  name: string;
  /** Display leaf name. */
  leaf: string;
  isPrefix: boolean;
  size?: number;
  lastModified?: string;
  contentType?: string;
  /** Soft-deleted (retained by the account's retention policy). */
  deleted?: boolean;
}

export interface ListBlobsArgs {
  accountId: string;
  container?: string;
  prefix?: string;
  pageSize?: number;
  /** Include soft-deleted blobs (blob storage only). */
  includeDeleted?: boolean;
  /** Opaque marker from the previous page's `continuationToken`. */
  continuationToken?: string;
}

export interface ListBlobsResult {
  container: string;
  /** Effective prefix actually listed (base prefix + navigation). */
  prefix: string;
  items: StorageBlobItem[];
  /** Set when the folder has more entries than this page; pass it back to get the next one. */
  continuationToken?: string;
}

/** What `storage:list-blobs` actually sends over IPC: the items stay a JSON
 *  string from the listing worker to the preload, so the main process never
 *  walks or re-serializes 5,000 objects per page. */
export interface ListBlobsWire {
  container: string;
  prefix: string;
  itemsJson: string;
  count: number;
  continuationToken?: string;
}

/* ---------- CRUD ---------- */

export interface ContainerActionArgs {
  accountId: string;
  container: string;
}

export interface DeleteBlobsArgs {
  accountId: string;
  container: string;
  /** Blob names (or folder prefixes ending in `/`) to delete. */
  names: string[];
}

export interface CopyBlobsArgs {
  accountId: string;
  container: string;
  /** Blob names (or folder prefixes ending in `/`) to copy/move. */
  names: string[];
  /** Destination folder inside the container (no leading/trailing slash). */
  destPrefix?: string;
  /** Overwrite blobs that already exist at the destination. */
  overwrite?: boolean;
}

export type MoveBlobsArgs = CopyBlobsArgs;

export interface CreateFolderArgs {
  accountId: string;
  container: string;
  /** Current prefix listings are scoped under. */
  prefix?: string;
  folderName: string;
}

export interface RenameBlobArgs {
  accountId: string;
  container: string;
  source: string;
  destLeaf: string;
}

export interface RenameContainerArgs {
  accountId: string;
  source: string;
  dest: string;
}

export interface BlobVersionInfo {
  /** Full blob name. */
  name: string;
  versionId?: string;
  snapshot?: string;
  lastModified?: string;
  size?: number;
  isCurrent: boolean;
}

export interface ListVersionsArgs {
  accountId: string;
  container: string;
  /** Full blob name. */
  name: string;
}

export interface RestoreVersionArgs {
  accountId: string;
  container: string;
  /** Full blob name to restore over. */
  name: string;
  versionId?: string;
  snapshot?: string;
}

export interface UndeleteBlobsArgs {
  accountId: string;
  container: string;
  /** Soft-deleted blob names to restore. */
  names: string[];
}

/* ---------- Preview (range-based, never downloads the whole blob) ---------- */

export type PreviewFlavor = "csv" | "text";

export interface PreviewArgs {
  accountId: string;
  container: string;
  /** Full blob name. */
  name: string;
  /** Byte offset to start this page at. Defaults to 0. */
  offset?: number;
  /** Max bytes to fetch (clamped server-side to 4 KiB – 1 MiB). */
  maxBytes?: number;
  /** Max lines to return per page (clamped server-side to 1 – 2000). */
  maxLines?: number;
}

export interface PreviewResult {
  name: string;
  /** Total blob size in bytes. */
  size: number;
  contentType?: string;
  /** `csv` renders a table; `text` renders monospaced lines. */
  flavor: PreviewFlavor;
  /** True when the sample contains NUL bytes — metadata only, no text. */
  binary: boolean;
  /**
   * True when neither the extension nor the content type claims text, but the
   * bytes sniff as text. Shown as a "best guess" hint in the UI.
   */
  guessed?: boolean;
  encoding: string;
  /** Byte offset this page started at. */
  offset: number;
  /** Byte offset the next page should request. Equals `size` at EOF. */
  nextOffset: number;
  eof: boolean;
  /** Decoded text for this page (line-aligned except huge single lines). */
  text: string;
  /** Bytes of usable text in this page. */
  bytesFetched: number;
  /** Page ends mid-line; the next page continues the same line. */
  cutMidLine: boolean;
}

export interface UploadEnqueueArgs {
  accountId: string;
  container: string;
  prefix?: string;
  /** Pick folders instead of files; uploads everything under them, keeping the layout. */
  folder?: boolean;
  /** Explicit local files/folders (drag and drop): skips the picker. Absolute paths, validated in main. */
  paths?: string[];
}

export interface DownloadArgs {
  accountId: string;
  container: string;
  names: string[];
}

/* ---------- Transfers + activity ---------- */

export type TransferDirection = "upload" | "download";
export type TransferStatus =
  "queued" | "active" | "completed" | "failed" | "cancelled";

export interface TransferInfo {
  id: string;
  direction: TransferDirection;
  accountId: string;
  accountName: string;
  container: string;
  /** Blob path (upload destination / download source). */
  name: string;
  totalBytes: number;
  doneBytes: number;
  status: TransferStatus;
  /** Local filesystem path (download destination / upload source). */
  localPath?: string;
  /** Exponential moving average, bytes/sec. */
  speedBps?: number;
  etaSec?: number;
  error?: string;
  /** Parallel connections this transfer may use. */
  concurrency: number;
  /** Queue position (enqueue order; retries go negative so they sort first). */
  seq: number;
  startedAt?: number;
  finishedAt?: number;
}

/** Counts and tuning, without rows: what invoke replies and every delta carry. */
export interface TransfersSummary {
  /** Bumped on every `transfers:changed` emit; deltas apply to the snapshot with rev - 1. */
  rev: number;
  active: number;
  queued: number;
  /** Completed (until removed), failed and cancelled rows. */
  finished: number;
  /** Active + queued uploads / downloads. */
  up: number;
  down: number;
  aggregateBps: number;
  uploadConcurrency: number;
  maxParallel: number;
}

/** Full list (`transfers:list`, used on load and after a missed delta). */
export interface TransfersSnapshot extends TransfersSummary {
  transfers: TransferInfo[];
}

/** `transfers:changed` payload: only rows that changed since the previous rev. */
export interface TransfersDelta extends TransfersSummary {
  upserts: TransferInfo[];
  removed: string[];
}

export interface TransferConfigure {
  uploadConcurrency?: number;
  maxParallel?: number;
}

/* ---------- Activity ---------- */
export type ActivityStatus = "success" | "failed";
export type ActivityKind =
  "transfer" | "container" | "folder" | "blob" | "connection";

export interface ActivityEntry {
  id: string;
  at: number;
  kind: ActivityKind;
  text: string;
  detail?: string;
  status: ActivityStatus;
  durationMs?: number;
  localPath?: string;
  transferDirection?: TransferDirection;
  fileDeleted?: boolean;
  accountId?: string;
  container?: string;
  /** Read back from activity.json at launch: last session's history, never "new". Not persisted. */
  restored?: boolean;
}

/* ---------- SAS + container / service admin (sidebar context menus) ---------- */

/** What a connection can do beyond listing. Computed in main from the secret; the secret stays there. */
export interface AccountCapabilities {
  /** Connection string carries an AccountKey (or is Azurite): can sign SAS + copy the key. */
  sharedKey: boolean;
  /** Why SAS creation is unavailable, for the disabled menu item's tooltip. */
  sasReason?: string;
  /** Full-account connection (service properties, account SAS). */
  accountScope: boolean;
}

export type PublicAccessLevel = "none" | "blob" | "container";

export interface StoredAccessPolicy {
  id: string;
  /** ISO 8601. */
  startsOn?: string;
  expiresOn?: string;
  /** Permission letters, e.g. `rl`. */
  permissions?: string;
}

export interface ContainerAccessInfo {
  publicAccess: PublicAccessLevel;
  policies: StoredAccessPolicy[];
}

export interface SetStoredPoliciesArgs {
  accountId: string;
  container: string;
  policies: StoredAccessPolicy[];
}

export interface SetPublicAccessArgs {
  accountId: string;
  container: string;
  level: PublicAccessLevel;
}

export interface ContainerPropertiesInfo {
  name: string;
  url: string;
  lastModified?: string;
  etag?: string;
  leaseState?: string;
  leaseStatus?: string;
  leaseDuration?: string;
  publicAccess: PublicAccessLevel;
  hasImmutabilityPolicy?: boolean;
  hasLegalHold?: boolean;
  defaultEncryptionScope?: string;
  denyEncryptionScopeOverride?: boolean;
  isImmutableStorageWithVersioningEnabled?: boolean;
  metadata: Record<string, string>;
}

export interface CorsRuleInfo {
  /** Comma-separated, as Azure stores them. */
  allowedOrigins: string;
  allowedMethods: string;
  allowedHeaders: string;
  exposedHeaders: string;
  maxAgeInSeconds: number;
}

export interface SoftDeleteInfo {
  enabled: boolean;
  /** 1–365 when enabled. */
  days?: number;
}
