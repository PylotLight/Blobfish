import type { TransferDirection, TransferStatus } from "../../shared/types";

/* Tuning: 8 parallel block connections saturates most links without
 * hammering the service; 8 MiB blocks keep a 2 GiB file to 256 parts
 * (well under the 50k block limit) while staying memory-light. */
export const DEFAULT_UPLOAD_CONCURRENCY = 8;
export const DEFAULT_MAX_PARALLEL = 2;
export const LARGE_FILE_BYTES = 1024 * 1024 * 1024;
export const LARGE_BLOCK_SIZE = 8 * 1024 * 1024;
/* Anything bigger than this is striped across `uploadConcurrency` block
 * connections. The SDK defaults (blob: 256 MiB, DataLake: 100 MiB) send
 * everything below that as ONE request on ONE connection, so a 200 MB file
 * never used the parallel path at all. */
export const SINGLE_SHOT_BYTES = 8 * 1024 * 1024;
export const EMIT_MS = 250;

export interface ActiveTransfer {
  id: string;
  spec: {
    direction: TransferDirection;
    accountId: string;
    accountName: string;
    container: string;
    /** Blob path. */
    name: string;
    localPath: string;
    totalBytes: number;
    dfs: boolean;
  };
  status: TransferStatus;
  seq: number;
  /** Connections this transfer is using / will use. */
  connections: number;
  doneBytes: number;
  error?: string;
  controller?: AbortController;
  enqueuedAt: number;
  startedAt?: number;
  finishedAt?: number;
  lastTickAt: number;
  /** doneBytes at lastTickAt: speed is measured over the whole window, not the last callback. */
  lastTickBytes: number;
  speedBps: number;
}

export const RANGE_RETRY_REQUESTS = 5;
