import { describe, expect, mock, test } from "bun:test";
import { existsSync } from "node:fs";

// Drives the real transfer queue with electron + azure stubbed out.
const sent: Array<{
  upserts: unknown[];
  removed: string[];
  active: number;
  queued: number;
}> = [];
const downloads: Array<{ offset: number; count: number }> = [];
const STREAM_SIZE = 64 * 1024 * 1024;
const CHUNK = Buffer.alloc(16 * 1024, 0x62);
const uploadOpts: Array<Record<string, unknown>> = [];
const N = 400;
let streaming = false;

mock.module("electron", () => ({
  dialog: {
    showOpenDialog: async (_w: unknown, o: { properties: string[] }) => ({
      canceled: false,
      filePaths: o.properties.includes("openDirectory")
        ? ["/tmp/blobfish-test-dl"]
        : [import.meta.path],
    }),
  },
}));
mock.module("./window", () => ({
  getMainWindow: () => ({
    webContents: {
      send: (_ch: string, d: (typeof sent)[number]) => sent.push(d),
    },
  }),
}));
mock.module("./activity", () => ({ logActivity: () => {} }));
mock.module("./accounts", () => ({
  decryptSecret: () => ({
    profile: { name: "acc", endpoint: "https://acc.blob.core.windows.net" },
    secret: {},
  }),
}));
mock.module("./azure", () => ({
  isDfsEndpoint: () => false,
  friendlyError: (e: unknown) => e,
  dataLakeFileSystemClientFromSecret: () => ({}),
  blobContainerClientFromSecret: () => ({
    async *listBlobsFlat() {
      for (let i = 0; i < N; i++)
        yield {
          name: `logs/part-${i}.json`,
          properties: { contentLength: 10 },
        };
    },
    getBlobClient: () => ({
      getProperties: async () => ({
        contentLength: streaming ? STREAM_SIZE : 10,
        etag: '"e1"',
      }),
      download: async (
        offset: number,
        count: number,
        o: { abortSignal: AbortSignal },
      ) => {
        downloads.push({ offset, count });
        return {
          readableStreamBody: (async function* () {
            if (!streaming) {
              await new Promise((r) => setTimeout(r, 1));
              yield Buffer.alloc(count, 0x61);
              return;
            }
            // Throttled per connection: 16 KiB a ms.
            for (let p = 0; p < count; p += CHUNK.length) {
              if (o.abortSignal.aborted)
                throw Object.assign(new Error("aborted"), {
                  name: "AbortError",
                });
              await new Promise((r) => setTimeout(r, 1));
              yield CHUNK.subarray(0, Math.min(CHUNK.length, count - p));
            }
          })(),
        };
      },
    }),
    getBlockBlobClient: () => ({
      uploadFile: async (_p: string, o: Record<string, unknown>) => {
        uploadOpts.push(o);
      },
    }),
  }),
}));

const settle = async (tr: typeof import("./transfers")): Promise<void> => {
  for (
    let i = 0;
    i < 2000 && tr.snapshot().active + tr.snapshot().queued > 0;
    i++
  ) {
    await new Promise((r) => setTimeout(r, 5));
  }
  await new Promise((r) => setTimeout(r, 300));
};

describe("transfer queue", () => {
  test("a big folder download coalesces snapshots instead of one per row", async () => {
    const tr = await import("./transfers");
    // Order-independent: earlier tests' rows already settled, count only this test's sends.
    sent.length = 0;
    const ids = await tr.enqueueDownload("a", "c", ["logs/"]);
    expect(ids.length).toBe(N);
    // Was N sends on enqueue alone (+2 per row as each started/finished): O(n²) bytes.
    expect(sent.length).toBe(0);
    await settle(tr);
    expect(tr.snapshot().transfers.length).toBe(0);
    expect(sent.length).toBeLessThan(40);
    expect(sent.at(-1)?.active).toBe(0);
    expect(sent.at(-1)?.queued).toBe(0);
    // Deltas: every row is sent when it appears and removed once, never the whole list per tick.
    const upserts = sent.reduce((n, d) => n + d.upserts.length, 0);
    const removedIds = new Set(sent.flatMap((d) => d.removed));
    expect(removedIds.size).toBe(N);
    expect(upserts).toBeLessThan(N * 4);
  });

  test("big downloads fetch ranges in parallel; speed is the tick window, not one callback", async () => {
    const tr = await import("./transfers");
    streaming = true;
    downloads.length = 0;
    const [id] = await tr.enqueueDownload("a", "c", ["big.bin"]);
    await new Promise((r) => setTimeout(r, 300));
    const row = tr.snapshot().transfers.find((t) => t.id === id);
    // 8 connections (the connections-per-file setting) each pulling an 8 MiB range.
    expect(row?.concurrency).toBe(8);
    expect(new Set(downloads.map((d) => d.offset)).size).toBe(8);
    expect(downloads.every((d) => d.count === 8 * 1024 * 1024)).toBe(true);
    // ~8 × 16 MiB/s (timer-bound, lots of slack); the old math reported ~1 MiB/s.
    expect(row?.speedBps ?? 0).toBeGreaterThan(30 * 1024 * 1024);
    // Quit mid-download: ordered shutdown waits for the engine, which removes the partial file.
    const cancelled = await tr.stopTransfersForQuit();
    streaming = false;
    expect(cancelled).toBe(1);
    expect(existsSync("/tmp/blobfish-test-dl/big.bin.blobfish-part")).toBe(
      false,
    );
    expect(existsSync("/tmp/blobfish-test-dl/big.bin")).toBe(false);
    tr.clearFinished();
  });

  test("a 5,000-file queue sends small deltas while it runs", async () => {
    const tr = await import("./transfers");
    tr.configureTransfers({ maxParallel: 1 });
    const names = Array.from(
      { length: 5000 },
      (_, i) =>
        `logs/2026/10/16/part-${String(i).padStart(6, "0")}-abcdef.json`,
    );
    sent.length = 0;
    await tr.enqueueDownload("a", "c", names);
    await new Promise((r) => setTimeout(r, 700));
    const sizes = sent.map((d) => JSON.stringify(d).length);
    // First emit introduces the rows; later ones only carry the rows that moved.
    expect(sizes[0]).toBeGreaterThan(1_000_000);
    expect(Math.max(...sizes.slice(1))).toBeLessThan(40_000);
    tr.cancelAll();
    await settle(tr);
    tr.clearFinished();
    tr.configureTransfers({ maxParallel: 2 });
    expect(tr.snapshot().transfers.length).toBe(0);
  });

  test("uploads stripe across block connections above the single-shot size", async () => {
    const tr = await import("./transfers");
    await tr.enqueueUpload("a", "c");
    await settle(tr);
    expect(uploadOpts.length).toBe(1);
    expect(uploadOpts[0]!.maxSingleShotSize).toBe(8 * 1024 * 1024);
    expect(uploadOpts[0]!.concurrency).toBe(8);
  });
});
