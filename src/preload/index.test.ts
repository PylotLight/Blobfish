import { afterAll, describe, expect, mock, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

if (process.env.BLOBFISH_PRELOAD_CONTRACT_CHILD !== "1") {
  test("preload bridge contract in an isolated Bun test process", () => {
    const result = spawnSync(process.execPath, ["test", import.meta.path], {
      cwd: join(import.meta.dir, "../.."),
      encoding: "utf8",
      env: { ...process.env, BLOBFISH_PRELOAD_CONTRACT_CHILD: "1" },
    });
    expect(result.status).toBe(0);
    expect(`${result.stdout}${result.stderr}`).toContain("preload bridge");
    expect(`${result.stdout}${result.stderr}`).toContain("2 pass");
  });
} else {
  type Listener = (event: unknown, payload: unknown) => void;
  const invocations: unknown[][] = [];
  const listeners: Array<{ channel: string; handler: Listener }> = [];
  const removals: Array<{ channel: string; handler: unknown }> = [];
  let invokeReply: unknown;
  const ipcRenderer = {
    invoke: (channel: string, ...args: unknown[]) => {
      invocations.push([channel, ...args]);
      return Promise.resolve(invokeReply);
    },
    on: (channel: string, handler: unknown) => {
      listeners.push({ channel, handler: handler as Listener });
    },
    removeListener: (channel: string, handler: unknown) => {
      removals.push({ channel, handler });
    },
  };
  mock.module("electron", () => ({
    contextBridge: { exposeInMainWorld: () => undefined },
    ipcRenderer,
    webUtils: { getPathForFile: () => "" },
  }));

  const windowStub: { api?: unknown } = {};
  const globalWithWindow = globalThis as unknown as {
    window?: typeof windowStub;
  };
  const previousWindow = globalWithWindow.window;
  globalWithWindow.window = windowStub;
  await import("./index");
  const api = windowStub.api as {
    storage: {
      listBlobs(args: {
        accountId: string;
        container: string;
        prefix: string;
      }): Promise<{
        container: string;
        prefix: string;
        items: Array<{ name: string; size: number }>;
        continuationToken?: string;
      }>;
    };
    transfers: { onUpdate(callback: (value: unknown) => void): () => void };
  };

  afterAll(() => {
    if (previousWindow === undefined) delete globalWithWindow.window;
    else globalWithWindow.window = previousWindow;
  });

  describe("preload bridge", () => {
    test("decodes list-blobs wire JSON and forwards the requested location", async () => {
      invocations.length = 0;
      const args = {
        accountId: "account-1",
        container: "reports",
        prefix: "2026/",
      };
      invokeReply = {
        container: "reports",
        prefix: "2026/",
        itemsJson: '[{"name":"2026/summary.csv","size":12}]',
        continuationToken: "next-page",
      };

      await expect(api.storage.listBlobs(args)).resolves.toEqual({
        container: "reports",
        prefix: "2026/",
        items: [{ name: "2026/summary.csv", size: 12 }],
        continuationToken: "next-page",
      });
      expect(invocations).toEqual([["storage:list-blobs", args]]);
    });

    test("subscriptions deliver updates and unsubscribe only their own listener", () => {
      listeners.length = 0;
      removals.length = 0;
      const firstPayloads: unknown[] = [];
      const secondPayloads: unknown[] = [];
      const stopFirst = api.transfers.onUpdate((value) =>
        firstPayloads.push(value),
      );
      const stopSecond = api.transfers.onUpdate((value) =>
        secondPayloads.push(value),
      );
      const [first, second] = listeners;
      const initial = { rev: 1, upserts: [{ id: "transfer-1", doneBytes: 5 }] };
      first!.handler({}, initial);
      second!.handler({}, initial);
      expect(firstPayloads).toEqual([initial]);
      expect(secondPayloads).toEqual([initial]);

      stopFirst();
      expect(removals).toEqual([
        { channel: "transfers:changed", handler: first!.handler },
      ]);
      const next = { rev: 2, upserts: [{ id: "transfer-1", doneBytes: 10 }] };
      second!.handler({}, next);
      expect(firstPayloads).toEqual([initial]);
      expect(secondPayloads).toEqual([initial, next]);

      stopSecond();
      expect(removals[1]).toEqual({
        channel: "transfers:changed",
        handler: second!.handler,
      });
    });
  });
}
