/* Runs folder-listing pages on a worker thread (list-worker.ts) so SDK XML
 * parsing never blocks the main process. Falls back to listing in-process if
 * the worker can't start. */
import type { Worker } from "node:worker_threads";
import createListWorker from "./list-worker?nodeWorker";
import { listPage, type ListPageRequest } from "./list-page";

export type ListWorkerReply =
  | {
      id: number;
      ok: true;
      itemsJson: string;
      count: number;
      continuationToken?: string;
    }
  | {
      id: number;
      ok: false;
      message: string;
      name?: string;
      code?: string;
      statusCode?: number;
    };

export interface ListPageWire {
  itemsJson: string;
  count: number;
  continuationToken?: string;
}

type Pending = {
  resolve: (r: ListPageWire) => void;
  reject: (e: Error) => void;
};

let worker: Worker | null = null;
let workerBroken = false;
let nextId = 1;
const pending = new Map<number, Pending>();

function failAll(err: Error): void {
  for (const p of pending.values()) p.reject(err);
  pending.clear();
}

function getWorker(): Worker | null {
  if (worker) return worker;
  if (workerBroken) return null;
  try {
    const w = createListWorker({});
    w.unref(); // never hold the app open
    w.on("message", (reply: ListWorkerReply) => {
      const p = pending.get(reply.id);
      if (!p) return;
      pending.delete(reply.id);
      if (reply.ok) {
        p.resolve({
          itemsJson: reply.itemsJson,
          count: reply.count,
          continuationToken: reply.continuationToken,
        });
      } else {
        const err = new Error(reply.message) as Error & {
          code?: string;
          statusCode?: number;
        };
        if (reply.name) err.name = reply.name;
        err.code = reply.code;
        err.statusCode = reply.statusCode;
        p.reject(err);
      }
    });
    w.on("error", (err) => {
      console.error("[blobfish] list worker error", err);
      if (worker === w) worker = null;
      failAll(err instanceof Error ? err : new Error(String(err)));
    });
    w.on("exit", (code) => {
      if (worker === w) worker = null;
      if (pending.size > 0)
        failAll(new Error(`Listing worker exited (${code})`));
    });
    worker = w;
    return w;
  } catch (err) {
    console.error(
      "[blobfish] list worker unavailable, listing in-process",
      err,
    );
    workerBroken = true;
    return null;
  }
}

/** Spin the worker (and its SDK import) up ahead of the first listing. */
export function prewarmListWorker(): void {
  getWorker();
}

export async function runListPage(req: ListPageRequest): Promise<ListPageWire> {
  const w = getWorker();
  if (!w) {
    const res = await listPage(req);
    return {
      itemsJson: JSON.stringify(res.items),
      count: res.items.length,
      continuationToken: res.continuationToken,
    };
  }
  const id = nextId++;
  return new Promise<ListPageWire>((resolve, reject) => {
    pending.set(id, { resolve, reject });
    w.postMessage({ id, req });
  });
}
