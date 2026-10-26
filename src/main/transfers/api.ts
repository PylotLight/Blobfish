import { dialog } from "electron";
import { basename, join } from "node:path";
import {
  expandUploadRoots,
  uploadBase,
  validateLocalPaths,
} from "../upload-paths";
import { decryptSecret } from "../accounts";
import { logActivity } from "../activity";
import { getMainWindow } from "../window";
import {
  blobContainerClientFromSecret,
  dataLakeFileSystemClientFromSecret,
  isDfsEndpoint,
} from "../azure";
import type { TransfersSummary } from "../../shared/types";
import {
  byId,
  dirty,
  emitNow,
  forget,
  markDirty,
  snapshot,
  summary,
  transfers,
  setUploadConcurrency,
  setMaxParallel,
  nextRetrySeq,
  clearEmitTimer,
  connectionsFor,
  describe,
} from "./state";
import { enqueue, startNext } from "./queue";

export function configureTransfers(opts: {
  uploadConcurrency?: number;
  maxParallel?: number;
}): TransfersSummary {
  if (opts.uploadConcurrency !== undefined) {
    setUploadConcurrency(
      Math.min(16, Math.max(1, Math.floor(opts.uploadConcurrency))),
    );
  }
  if (opts.maxParallel !== undefined) {
    setMaxParallel(Math.min(4, Math.max(1, Math.floor(opts.maxParallel))));
  }
  startNext();
  // Queued rows show the connections they will use; only resend the ones that changed.
  for (const t of byId.values()) {
    if (t.status !== "queued") continue;
    const c = connectionsFor(t.spec.direction, t.spec.totalBytes);
    if (c !== t.connections) {
      t.connections = c;
      markDirty(t.id);
    }
  }
  return summary();
}

function uniqueDownloadPath(
  destDir: string,
  rel: string,
  used: Set<string>,
): string {
  const clean = rel.replace(/^\/+/, "") || "download";
  let candidate = join(destDir, clean);
  if (!used.has(candidate)) {
    used.add(candidate);
    return candidate;
  }
  const slash = clean.lastIndexOf("/");
  const dir = slash === -1 ? "" : clean.slice(0, slash + 1);
  const file = slash === -1 ? clean : clean.slice(slash + 1);
  const dot = file.lastIndexOf(".");
  const stem = dot > 0 ? file.slice(0, dot) : file;
  const ext = dot > 0 ? file.slice(dot) : "";
  let n = 2;
  while (used.has(candidate)) {
    candidate = join(destDir, `${dir}${stem} (${n})${ext}`);
    n += 1;
  }
  used.add(candidate);
  return candidate;
}

export async function enqueueUpload(
  accountId: string,
  container: string,
  prefix?: string,
  folder = false,
  paths?: string[],
): Promise<string[]> {
  // Explicit paths (drag and drop) skip the picker; main still validates them.
  let roots: string[];
  if (paths !== undefined) {
    roots = await validateLocalPaths(paths);
  } else {
    const win = getMainWindow();
    const picked = await dialog.showOpenDialog(win!, {
      title: folder ? "Upload folder to Blobfish" : "Upload to Blobfish",
      properties: folder
        ? ["openDirectory", "multiSelections"]
        : ["openFile", "multiSelections"],
    });
    if (picked.canceled || picked.filePaths.length === 0) return [];
    roots = picked.filePaths;
  }
  const { profile } = await decryptSecret(accountId);
  const base = uploadBase(profile.prefix, prefix);
  // Folders keep their own name and layout: <base>/<folder>/<sub>/<file>.
  const files = await expandUploadRoots(roots);
  const ids: string[] = [];
  for (const { fp, rel, size } of files) {
    const dest = base ? `${base}/${rel}` : rel;
    ids.push(
      enqueue({
        direction: "upload",
        accountId,
        accountName: profile.name,
        container,
        name: dest,
        localPath: fp,
        totalBytes: size,
        dfs: isDfsEndpoint(profile.endpoint),
      }),
    );
  }
  return ids;
}

export async function enqueueDownload(
  accountId: string,
  container: string,
  names: string[],
): Promise<string[]> {
  if (names.length === 0) throw new Error("Nothing selected to download.");
  const win = getMainWindow();
  const picked = await dialog.showOpenDialog(win!, {
    title: "Download destination",
    properties: ["openDirectory", "createDirectory"],
  });
  if (picked.canceled || picked.filePaths.length === 0) return [];
  const destDir = picked.filePaths[0]!;
  const { profile, secret } = await decryptSecret(accountId);
  const dfs = isDfsEndpoint(profile.endpoint);
  // Explicitly picked files download flat (basename only) — selecting files
  // must never recreate parent dirs or pull in unpicked siblings. Selected
  // folders expand to the files beneath them, preserved relative to the
  // selected folder.
  const targets: Array<{ name: string; size?: number; rel: string }> = [];
  const seenBlobs = new Set<string>();
  const pushFile = (
    name: string,
    size: number | undefined,
    rel: string,
  ): void => {
    if (!name || name.endsWith("/") || seenBlobs.has(name)) return;
    seenBlobs.add(name);
    pushFileRaw(name, size, rel);
  };
  const pushFileRaw = (
    name: string,
    size: number | undefined,
    rel: string,
  ): void => {
    targets.push({ name, size, rel: rel === "" ? basename(name) : rel });
  };
  for (const n of names.filter((x) => !x.endsWith("/"))) {
    pushFileRaw(n, undefined, basename(n));
    seenBlobs.add(n);
  }
  const folders = names.filter((n) => n.endsWith("/"));
  if (dfs) {
    const fs = dataLakeFileSystemClientFromSecret(secret, container);
    for (const f of folders) {
      const trimmed = f.replace(/\/$/, "");
      for await (const p of fs.listPaths({
        path: trimmed === "" ? undefined : trimmed,
        recursive: true,
      })) {
        if (p.isDirectory || !p.name) continue;
        const rel =
          trimmed === "" || p.name === trimmed
            ? basename(p.name)
            : p.name.startsWith(`${trimmed}/`)
              ? p.name.slice(trimmed.length + 1)
              : basename(p.name);
        pushFile(p.name, p.contentLength, rel);
      }
    }
  } else {
    const client = blobContainerClientFromSecret(secret, container);
    for (const f of folders) {
      for await (const b of client.listBlobsFlat({ prefix: f })) {
        if (b.name.endsWith("/")) continue; // folder marker, not a file
        const rel =
          b.name === f || !b.name.startsWith(f)
            ? basename(b.name)
            : b.name.slice(f.length);
        pushFile(b.name, b.properties?.contentLength, rel);
      }
    }
  }
  if (targets.length === 0)
    throw new Error("No files to download — the selected folder is empty.");
  const usedPaths = new Set<string>();
  const ids: string[] = [];
  for (const f of targets) {
    ids.push(
      enqueue({
        direction: "download",
        accountId,
        accountName: profile.name,
        container,
        name: f.name,
        localPath: uniqueDownloadPath(destDir, f.rel, usedPaths),
        totalBytes: f.size ?? 0,
        dfs,
      }),
    );
  }
  return ids;
}

export function cancelTransfer(id: string): TransfersSummary {
  const t = byId.get(id);
  if (!t) return summary();
  if (t.status === "active") {
    t.controller?.abort();
  } else if (t.status === "queued") {
    t.status = "cancelled";
    t.finishedAt = Date.now();
    dirty.add(t.id);
  }
  emitNow();
  return summary();
}

export function cancelAll(): TransfersSummary {
  for (const t of byId.values()) {
    if (t.status === "active") t.controller?.abort();
    else if (t.status === "queued") {
      t.status = "cancelled";
      t.finishedAt = Date.now();
      dirty.add(t.id);
    }
  }
  emitNow();
  return summary();
}

export function retryTransfer(id: string): TransfersSummary {
  const t = byId.get(id);
  if (!t || (t.status !== "failed" && t.status !== "cancelled"))
    return summary();
  t.status = "queued";
  t.seq = nextRetrySeq();
  dirty.add(t.id);
  t.error = undefined;
  t.doneBytes = 0;
  t.speedBps = 0;
  t.startedAt = undefined;
  t.finishedAt = undefined;
  // Retries jump the queue so a failed 2 GiB upload restarts immediately.
  const idx = transfers.indexOf(t);
  if (idx > 0) {
    transfers.splice(idx, 1);
    const firstActive = transfers.findIndex((x) => x.status === "active");
    transfers.splice(firstActive === -1 ? transfers.length : firstActive, 0, t);
  }
  emitNow();
  void startNext();
  return summary();
}

/** Drop finished rows from the panel (queued/active are untouched). */
export function clearFinished(): TransfersSummary {
  for (const t of [...byId.values()]) {
    if (
      t.status === "completed" ||
      t.status === "failed" ||
      t.status === "cancelled"
    )
      forget(t);
  }
  emitNow();
  return summary();
}

/* ---------------- quit (ordered shutdown) ---------------- */

/** What the quit prompt needs: transfers still moving bytes or waiting their turn. */
export function inFlightCounts(): { active: number; queued: number } {
  let active = 0;
  let queued = 0;
  for (const t of byId.values()) {
    if (t.status === "active") active += 1;
    else if (t.status === "queued") queued += 1;
  }
  return { active, queued };
}

/**
 * Cancel everything in flight and wait (bounded) for the engines to unwind, so partial
 * downloads are removed and each cancel lands in the activity log before it is persisted.
 * Queued rows are cancelled first so nothing new starts while the active ones abort.
 */
export async function stopTransfersForQuit(timeoutMs = 4_000): Promise<number> {
  const now = Date.now();
  let cancelled = 0;
  for (const t of byId.values()) {
    if (t.status !== "queued") continue;
    t.status = "cancelled";
    t.finishedAt = now;
    dirty.add(t.id);
    cancelled += 1;
    logActivity({
      kind: "transfer",
      text: `${describe(t)} cancelled`,
      detail: "Blobfish quit before it started",
      status: "failed",
    });
  }
  const unwinding = [...byId.values()].filter((t) => t.status === "active");
  for (const t of unwinding) t.controller?.abort();
  cancelled += unwinding.length;
  const deadline = Date.now() + timeoutMs;
  // run() clears `controller` in its finally, after the partial file is gone and the cancel is logged.
  while (unwinding.some((t) => t.controller) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  clearEmitTimer();
  return cancelled;
}

export { summary, snapshot };
