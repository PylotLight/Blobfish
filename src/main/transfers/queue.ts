import { randomUUID } from "node:crypto";
import {
  byId,
  markDirty,
  nextSeq,
  transfers,
  maxParallel,
  connectionsFor,
} from "./state";
import { run } from "./run";
import type { ActiveTransfer } from "./types";

export function enqueue(spec: ActiveTransfer["spec"]): string {
  const id = randomUUID();
  const record: ActiveTransfer = {
    id,
    spec,
    status: "queued",
    seq: nextSeq(),
    connections: connectionsFor(spec.direction, spec.totalBytes),
    doneBytes: 0,
    enqueuedAt: Date.now(),
    lastTickAt: Date.now(),
    lastTickBytes: 0,
    speedBps: 0,
  };
  transfers.push(record);
  byId.set(id, record);
  // Coalesced: a folder download enqueues thousands of rows in one go, and a
  // full snapshot per row is O(n²) bytes over IPC.
  markDirty(id);
  void startNext();
  return id;
}

export function activeCount(): number {
  let n = 0;
  for (const t of byId.values()) if (t.status === "active") n += 1;
  return n;
}

export async function startNext(): Promise<void> {
  while (activeCount() < maxParallel) {
    const next = transfers.find((t) => t.status === "queued");
    if (!next) break;
    void run(next, startNext);
  }
}
