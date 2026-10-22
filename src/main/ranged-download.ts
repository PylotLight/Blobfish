import { open, rename, unlink } from "node:fs/promises";

/**
 * Parallel ranged download into a file handle.
 *
 * The SDK's `downloadToFile` / `readToFile` stream a blob over ONE connection, and
 * `downloadToBuffer` (the SDK's parallel path) holds the whole blob in memory. This
 * splits the blob into fixed blocks, has `concurrency` workers pull blocks off a shared
 * cursor and `pwrite` each streamed chunk straight to its offset, so memory stays at a
 * few socket buffers per connection whatever the size.
 */

/** Streams bytes [offset, offset + count) of the remote object. */
export type RangeReader = (
  offset: number,
  count: number,
  signal: AbortSignal,
) => Promise<AsyncIterable<Uint8Array> | undefined>;

export interface RangedDownloadOptions {
  size: number;
  /** Max simultaneous range requests (the "connections per file" setting). */
  concurrency: number;
  blockSize?: number;
  signal?: AbortSignal;
  /** Total bytes written so far, across every connection. */
  onProgress?: (loadedBytes: number) => void;
  /** Extra attempts per block for errors that aren't aborts (the SDK already resumes broken streams). */
  blockRetries?: number;
}

export const DOWNLOAD_BLOCK_SIZE = 8 * 1024 * 1024;

/** How many connections a download of `size` bytes actually uses. */
export function downloadConnections(
  size: number,
  concurrency: number,
  blockSize = DOWNLOAD_BLOCK_SIZE,
): number {
  if (size <= 0) return 1;
  return Math.max(
    1,
    Math.min(Math.floor(concurrency) || 1, Math.ceil(size / blockSize)),
  );
}

function isAbort(err: unknown, signal: AbortSignal): boolean {
  return signal.aborted || (err instanceof Error && err.name === "AbortError");
}

export async function downloadRangesToFile(
  path: string,
  read: RangeReader,
  opts: RangedDownloadOptions,
): Promise<void> {
  const blockSize = Math.max(64 * 1024, opts.blockSize ?? DOWNLOAD_BLOCK_SIZE);
  const size = Math.max(0, opts.size);
  const retries = opts.blockRetries ?? 2;
  // One controller for every block: the first hard failure stops the siblings too.
  const inner = new AbortController();
  const onOuterAbort = (): void => inner.abort(opts.signal?.reason);
  if (opts.signal?.aborted) inner.abort(opts.signal.reason);
  else opts.signal?.addEventListener("abort", onOuterAbort, { once: true });

  const fh = await open(path, "w");
  let loaded = 0;
  let cursor = 0;
  let firstError: unknown;
  const report = (): void => opts.onProgress?.(loaded);

  async function fetchBlock(offset: number, count: number): Promise<void> {
    for (let attempt = 0; ; attempt++) {
      let got = 0;
      try {
        const body = await read(offset, count, inner.signal);
        if (!body) throw new Error("Empty response body");
        for await (const chunk of body) {
          if (inner.signal.aborted)
            throw Object.assign(new Error("Aborted"), { name: "AbortError" });
          const n = Math.min(chunk.byteLength, count - got);
          if (n <= 0) break;
          await fh.write(chunk, 0, n, offset + got);
          got += n;
          loaded += n;
          report();
        }
        if (got !== count)
          throw new Error(
            `Short read: got ${got} of ${count} bytes at ${offset}`,
          );
        return;
      } catch (err) {
        // Roll this block's bytes back out of the total so progress never overshoots on a retry.
        loaded -= got;
        if (got) report();
        if (isAbort(err, inner.signal) || attempt >= retries) throw err;
      }
    }
  }

  async function worker(): Promise<void> {
    while (!inner.signal.aborted && cursor < size) {
      const offset = cursor;
      const count = Math.min(blockSize, size - offset);
      cursor += count;
      try {
        await fetchBlock(offset, count);
      } catch (err) {
        if (firstError === undefined) firstError = err;
        inner.abort(err);
        return;
      }
    }
  }

  try {
    const n = downloadConnections(size, opts.concurrency, blockSize);
    // Every worker settles (and stops writing) before the handle closes, so the
    // caller can unlink the partial file the moment this rejects.
    await Promise.all(Array.from({ length: size === 0 ? 0 : n }, worker));
  } finally {
    opts.signal?.removeEventListener("abort", onOuterAbort);
    await fh.close().catch(() => {});
  }
  if (opts.signal?.aborted) {
    throw Object.assign(new Error("The download was cancelled."), {
      name: "AbortError",
    });
  }
  if (firstError !== undefined) throw firstError;
}

/** Partial downloads land next to the target and are only renamed into place when complete. */
export function partPathFor(localPath: string): string {
  return `${localPath}.blobfish-part`;
}

/**
 * Run `write(partPath)` and move the result onto `localPath` only if it finished. A cancel,
 * failure or quit removes the partial file, and an existing file at `localPath` is never
 * truncated by a download that doesn't complete. A stale part left by a crash is replaced.
 */
export async function downloadViaPartFile(
  localPath: string,
  write: (partPath: string) => Promise<void>,
): Promise<void> {
  const part = partPathFor(localPath);
  await unlink(part).catch(() => {});
  try {
    await write(part);
    await rename(part, localPath);
  } catch (err) {
    await unlink(part).catch(() => {});
    throw err;
  }
}
