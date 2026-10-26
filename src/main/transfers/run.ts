import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { decryptSecret } from "../accounts";
import { logActivity } from "../activity";
import {
  blobContainerClientFromSecret,
  dataLakeFileSystemClientFromSecret,
  friendlyError,
} from "../azure";
import {
  downloadConnections,
  downloadRangesToFile,
  downloadViaPartFile,
  type RangeReader,
} from "../ranged-download";
import { formatBytes, formatDuration } from "../../shared/format";
import {
  byId,
  connectionsFor,
  forget,
  markDirty,
  uploadConcurrency,
  describe,
  tick,
} from "./state";
import {
  LARGE_BLOCK_SIZE,
  LARGE_FILE_BYTES,
  RANGE_RETRY_REQUESTS,
  SINGLE_SHOT_BYTES,
  type ActiveTransfer,
} from "./types";

export async function run(
  t: ActiveTransfer,
  startNext: () => void,
): Promise<void> {
  t.status = "active";
  t.startedAt = Date.now();
  t.lastTickAt = Date.now();
  t.lastTickBytes = 0;
  t.controller = new AbortController();
  t.connections = connectionsFor(t.spec.direction, t.spec.totalBytes);
  markDirty(t.id);
  const wallStart = Date.now();
  try {
    if (t.spec.direction === "upload") {
      if (t.spec.dfs) await runDfsUpload(t);
      else await runBlobUpload(t);
    } else {
      if (t.spec.dfs) await runDfsDownload(t);
      else await runBlobDownload(t);
    }
    t.status = "completed";
    t.doneBytes = t.spec.totalBytes;
    t.finishedAt = Date.now();
    const size = formatBytes(t.spec.totalBytes);
    const conn = t.connections > 1 ? ` · ${t.connections} connections` : "";
    logActivity({
      kind: "transfer",
      text: `${describe(t)} complete`,
      detail: `${size} in ${formatDuration(t.finishedAt - wallStart)}${conn}`,
      status: "success",
      durationMs: t.finishedAt - wallStart,
      localPath: t.spec.localPath,
      transferDirection: t.spec.direction,
      accountId: t.spec.accountId,
      container: t.spec.container,
    });
    // Completed transfers live on in the activity feed (which carries
    // Open/Reveal/Delete) — the transfers list keeps in-flight and
    // retryable rows only, so nothing appears twice.
    forget(t);
  } catch (err) {
    if (
      t.controller?.signal.aborted ||
      (err instanceof Error && err.name === "AbortError")
    ) {
      t.status = "cancelled";
      t.finishedAt = Date.now();
      // The engine already removed the partial (.blobfish-part) file, so a retry starts clean
      // and a file that was at the destination before is untouched.
      logActivity({
        kind: "transfer",
        text: `${describe(t)} cancelled`,
        status: "failed",
      });
    } else {
      const friendly = friendlyError(
        err,
        `${t.spec.direction === "upload" ? "Upload" : "Download"} failed`,
      );
      t.status = "failed";
      t.error = friendly.message;
      t.finishedAt = Date.now();
      logActivity({
        kind: "transfer",
        text: `${describe(t)} failed`,
        detail: friendly.message,
        status: "failed",
        durationMs: Date.now() - wallStart,
      });
    }
  } finally {
    t.controller = undefined;
    markDirty(byId.has(t.id) ? t.id : undefined);
    void startNext();
  }
}

/* ---------------- engines ---------------- */

async function runBlobUpload(t: ActiveTransfer): Promise<void> {
  const { secret } = await decryptSecret(t.spec.accountId);
  const blob = blobContainerClientFromSecret(
    secret,
    t.spec.container,
  ).getBlockBlobClient(t.spec.name);
  await blob.uploadFile(t.spec.localPath, {
    blockSize:
      t.spec.totalBytes >= LARGE_FILE_BYTES ? LARGE_BLOCK_SIZE : undefined,
    concurrency: uploadConcurrency,
    maxSingleShotSize: SINGLE_SHOT_BYTES,
    onProgress: (e) => tick(t.id, e.loadedBytes),
    abortSignal: t.controller?.signal,
  });
}

async function runDfsUpload(t: ActiveTransfer): Promise<void> {
  const { secret } = await decryptSecret(t.spec.accountId);
  const fs = dataLakeFileSystemClientFromSecret(secret, t.spec.container);
  const file = fs.getFileClient(t.spec.name);
  await file.create().catch(() => {});
  await file.uploadFile(t.spec.localPath, {
    maxConcurrency: uploadConcurrency,
    singleUploadThreshold: SINGLE_SHOT_BYTES,
    onProgress: (e) => tick(t.id, e.loadedBytes),
    abortSignal: t.controller?.signal,
  });
}

/* Range requests stream through the SDK's retriable reader (resumes a dropped
 * socket from the last byte) and are pinned to the ETag seen up front, so a blob
 * overwritten mid-download fails with 412 instead of stitching two versions. */
async function rangedDownload(
  t: ActiveTransfer,
  read: RangeReader,
): Promise<void> {
  const size = t.spec.totalBytes;
  t.connections = downloadConnections(size, uploadConcurrency);
  markDirty(t.id);
  await mkdir(join(t.spec.localPath, ".."), { recursive: true }).catch(
    () => {},
  );
  await downloadViaPartFile(t.spec.localPath, (part) =>
    downloadRangesToFile(part, read, {
      size,
      concurrency: uploadConcurrency,
      signal: t.controller?.signal,
      onProgress: (loaded) => tick(t.id, loaded),
    }),
  );
}

async function runBlobDownload(t: ActiveTransfer): Promise<void> {
  const { secret } = await decryptSecret(t.spec.accountId);
  const blob = blobContainerClientFromSecret(
    secret,
    t.spec.container,
  ).getBlobClient(t.spec.name);
  let etag: string | undefined;
  let sized = false;
  try {
    const props = await blob.getProperties({
      abortSignal: t.controller?.signal,
    });
    if (props.contentLength !== undefined) {
      t.spec.totalBytes = props.contentLength;
      sized = true;
    }
    etag = props.etag;
  } catch (err) {
    if (t.controller?.signal.aborted) throw err;
    // Size unknown: fall through to the SDK's single-stream download below.
  }
  if (!sized) {
    t.connections = 1;
    await mkdir(join(t.spec.localPath, ".."), { recursive: true }).catch(
      () => {},
    );
    await downloadViaPartFile(t.spec.localPath, (part) =>
      blob
        .downloadToFile(part, 0, undefined, {
          maxRetryRequests: 10,
          onProgress: (e) => tick(t.id, e.loadedBytes),
          abortSignal: t.controller?.signal,
        })
        .then(() => undefined),
    );
    return;
  }
  await rangedDownload(t, async (offset, count, signal) => {
    const res = await blob.download(offset, count, {
      abortSignal: signal,
      maxRetryRequests: RANGE_RETRY_REQUESTS,
      conditions: etag ? { ifMatch: etag } : undefined,
    });
    return res.readableStreamBody as AsyncIterable<Uint8Array> | undefined;
  });
}

async function runDfsDownload(t: ActiveTransfer): Promise<void> {
  const { secret } = await decryptSecret(t.spec.accountId);
  const fs = dataLakeFileSystemClientFromSecret(secret, t.spec.container);
  const file = fs.getFileClient(t.spec.name);
  let etag: string | undefined;
  let sized = false;
  try {
    const props = await file.getProperties({
      abortSignal: t.controller?.signal,
    });
    if (props.contentLength !== undefined) {
      t.spec.totalBytes = props.contentLength;
      sized = true;
    }
    etag = props.etag;
  } catch (err) {
    if (t.controller?.signal.aborted) throw err;
  }
  if (!sized) {
    t.connections = 1;
    await mkdir(join(t.spec.localPath, ".."), { recursive: true }).catch(
      () => {},
    );
    await downloadViaPartFile(t.spec.localPath, (part) =>
      file
        .readToFile(part, 0, undefined, {
          onProgress: (e) => tick(t.id, e.loadedBytes),
          abortSignal: t.controller?.signal,
        })
        .then(() => undefined),
    );
    return;
  }
  await rangedDownload(t, async (offset, count, signal) => {
    const res = await file.read(offset, count, {
      abortSignal: signal,
      maxRetryRequests: RANGE_RETRY_REQUESTS,
      conditions: etag ? { ifMatch: etag } : undefined,
    });
    return res.readableStreamBody as AsyncIterable<Uint8Array> | undefined;
  });
}
