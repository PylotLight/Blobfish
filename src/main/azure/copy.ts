import type { ContainerClient } from "@azure/storage-blob";
import { basename } from "node:path";
import { decryptSecret } from "../accounts";
import { logActivity } from "../activity";
import { blobContainerClientFromSecret, isDfsEndpoint } from "../azure-clients";
import { formatBytes } from "../../shared/format";
import { withSas } from "./common";
import { friendlyError } from "./errors";

/* ---------------- copy / move ---------------- */

function cleanDestPrefix(raw: string | undefined): string {
  const parts = (raw ?? "")
    .split("/")
    .map((s) => s.trim())
    .filter(Boolean);
  for (const p of parts) {
    if (p === "..") throw new Error('Destination folder names cannot be "..".');
    if (p.includes("\\"))
      throw new Error("Destination folder cannot contain backslashes.");
  }
  return parts.join("/");
}

interface CopyPlan {
  src: string;
  dest: string;
}

interface BlobCopyPlan {
  jobs: CopyPlan[];
  markers: string[];
  markerTargets: string[];
}

/** Blob-only expansion of selected folders → files plus leftover folder markers. */
async function expandBlobFolder(
  client: ContainerClient,
  folders: string[],
): Promise<{
  files: Array<{ name: string; size?: number }>;
  markers: string[];
}> {
  const files: Array<{ name: string; size?: number }> = [];
  const markers: string[] = [];
  const seen = new Set<string>();
  for (const f of folders) {
    for await (const b of client.listBlobsFlat({ prefix: f })) {
      if (seen.has(b.name)) continue;
      seen.add(b.name);
      if (b.name.endsWith("/")) markers.push(b.name);
      else files.push({ name: b.name, size: b.properties?.contentLength });
    }
  }
  return { files, markers };
}

/** List-based existence check. getProperties needs read permission, which
 *  list/write-only SAS tokens lack; a prefix listing only needs list. Names
 *  return in lexicographic order, so we can stop at the first non-match. */
async function blobExists(
  client: ContainerClient,
  name: string,
): Promise<{ exists: boolean; size?: number }> {
  for await (const b of client.listBlobsFlat({ prefix: name })) {
    if (b.name === name)
      return { exists: true, size: b.properties?.contentLength };
    if (b.name > name && !b.name.startsWith(name)) break;
  }
  return { exists: false };
}

/** Run bounded mutations/lookups and wait for in-flight work before failing. */
async function runBounded<T>(
  items: T[],
  action: (item: T) => Promise<void>,
): Promise<void> {
  const queue = [...items];
  let failure: unknown;
  let failed = false;
  const workers = Array.from(
    { length: Math.min(8, Math.max(1, queue.length)) },
    async () => {
      while (!failed && queue.length > 0) {
        const item = queue.shift()!;
        try {
          await action(item);
        } catch (err) {
          if (!failed) {
            failed = true;
            failure = err;
          }
          return;
        }
      }
    },
  );
  await Promise.all(workers);
  if (failed) throw failure;
}

/** Run every operation with bounded concurrency while retaining all outcomes. */
async function settleBounded<T>(
  items: T[],
  action: (item: T) => Promise<void>,
): Promise<PromiseSettledResult<void>[]> {
  const results = new Array<PromiseSettledResult<void>>(items.length);
  let next = 0;
  const workers = Array.from(
    { length: Math.min(8, Math.max(1, items.length)) },
    async () => {
      while (next < items.length) {
        const index = next++;
        try {
          await action(items[index]!);
          results[index] = { status: "fulfilled", value: undefined };
        } catch (reason) {
          results[index] = { status: "rejected", reason };
        }
      }
    },
  );
  await Promise.all(workers);
  return results;
}

function copyError(err: unknown, mode: "copy" | "move"): Error {
  const message = err instanceof Error ? err.message : String(err);
  if (/401|403|authenticat|signature|authorization/i.test(message)) {
    return new Error(
      `Azure rejected the ${mode} credentials. For a SAS, verify it is valid, unexpired, and scoped to these blobs; copying requires read (r) and write (w), while moving also requires delete (d). ${message}`,
    );
  }
  return friendlyError(err, `Failed to ${mode}`);
}

/**
 * Plan sources → destinations. Explicit files land by basename; files under
 * selected folders keep their path relative to the selected folder. Refuses
 * self-moves and preflights destination collisions so nothing is silently
 * overwritten.
 */
async function planBlobCopy(
  client: ContainerClient,
  names: string[],
  destPrefix: string,
  overwrite: boolean,
): Promise<BlobCopyPlan> {
  if (names.length === 0) throw new Error("Nothing selected.");
  const folders = names.filter((n) => n.endsWith("/"));
  for (const f of folders) {
    const fp = f.replace(/\/$/, "");
    if (destPrefix === fp || destPrefix.startsWith(`${fp}/`)) {
      throw new Error(
        `Cannot copy/move "${fp}" into itself or its own subfolder.`,
      );
    }
  }
  const jobs: CopyPlan[] = [];
  const seen = new Set<string>();
  const destSeen = new Map<string, string>();
  const addJob = (src: string, dest: string): void => {
    if (dest === src) return; // no-op
    const clash = destSeen.get(dest);
    if (clash !== undefined && clash !== src) {
      throw new Error(
        `Two selected items map to the same destination ("${dest}"). Move/copy them separately.`,
      );
    }
    destSeen.set(dest, src);
    jobs.push({ src, dest });
  };
  for (const n of names.filter((x) => !x.endsWith("/"))) {
    if (seen.has(n)) continue;
    seen.add(n);
    addJob(n, destPrefix ? `${destPrefix}/${basename(n)}` : basename(n));
  }
  const { files, markers } = await expandBlobFolder(client, folders);
  const markerTargets = new Set<string>();
  for (const f of files) {
    if (seen.has(f.name)) continue;
    seen.add(f.name);
    const parent = folders
      .filter((fd) => f.name.startsWith(fd))
      .sort((a, b) => b.length - a.length)[0]!;
    const rel = f.name.slice(parent.length);
    addJob(f.name, destPrefix ? `${destPrefix}/${rel}` : rel);
  }
  for (const marker of markers) {
    const parent = folders
      .filter((folder) => marker.startsWith(folder))
      .sort((a, b) => b.length - a.length)[0];
    if (!parent) continue;
    const rel = marker.slice(parent.length);
    // The selected folder itself is the source root, not a nested folder to
    // recreate. Empty nested folders, however, are part of the copied tree.
    if (rel) markerTargets.add(destPrefix ? `${destPrefix}/${rel}` : rel);
  }
  if (jobs.length === 0 && markerTargets.size === 0)
    throw new Error("Selected blobs are already in that folder.");
  if (!overwrite) {
    const conflicts: string[] = [];
    await runBounded(jobs, async (job) => {
      const found = await blobExists(client, job.dest);
      if (found.exists)
        conflicts.push(`${job.dest} (${formatBytes(found.size)})`);
    });
    if (conflicts.length > 0) {
      const shown = conflicts.slice(0, 5).join(", ");
      throw new Error(
        `Destination already exists (${conflicts.length}): ${shown}${conflicts.length > 5 ? "…" : ""} ` +
          "Tick “Replace existing” to overwrite, or pick a different folder.",
      );
    }
  }
  return { jobs, markers, markerTargets: [...markerTargets] };
}

async function runBlobCopy(
  client: ContainerClient,
  secret: string,
  jobs: CopyPlan[],
): Promise<void> {
  // Copy Blob From URL is asynchronous and handles blobs larger than the
  // 256-MiB synchronous-copy limit. Wait for every active copy before returning
  // so a retry cannot overlap with workers left running in the background.
  await runBounded(jobs, async (job) => {
    const srcUrl = withSas(client.getBlobClient(job.src).url, secret);
    const poller = await client
      .getBlockBlobClient(job.dest)
      .beginCopyFromURL(srcUrl);
    await poller.pollUntilDone();
  });
}

async function createFolderMarkers(
  client: ContainerClient,
  names: string[],
): Promise<void> {
  // Existing markers are already valid directories; don't overwrite their
  // metadata just to recreate the same folder.
  await runBounded(names, async (name) => {
    if ((await blobExists(client, name)).exists) return;
    await client.getBlockBlobClient(name).uploadData(Buffer.alloc(0));
  });
}

export async function copyBlobs(
  accountId: string,
  container: string,
  names: string[],
  destPrefixRaw?: string,
  overwrite = false,
): Promise<number> {
  const destPrefix = cleanDestPrefix(destPrefixRaw);
  const started = Date.now();
  const { profile, secret } = await decryptSecret(accountId);
  if (isDfsEndpoint(profile.endpoint)) {
    throw new Error("Copy is not supported for ADLS Gen2 attachments yet.");
  }
  const client = blobContainerClientFromSecret(secret, container);
  try {
    const { jobs, markerTargets } = await planBlobCopy(
      client,
      names,
      destPrefix,
      overwrite,
    );
    await runBlobCopy(client, secret, jobs);
    await createFolderMarkers(client, markerTargets);
    const count = jobs.length + markerTargets.length;
    logActivity({
      kind: "blob",
      text: `Copied ${count} item${count === 1 ? "" : "s"} to '${destPrefix || container}'`,
      status: "success",
      durationMs: Date.now() - started,
    });
    return count;
  } catch (err) {
    const message = err instanceof Error ? err.message : "Copy failed";
    logActivity({
      kind: "blob",
      text: `Copy to '${destPrefix || container}' failed`,
      detail: message,
      status: "failed",
    });
    throw copyError(err, "copy");
  }
}

export async function moveBlobs(
  accountId: string,
  container: string,
  names: string[],
  destPrefixRaw?: string,
  overwrite = false,
): Promise<number> {
  const destPrefix = cleanDestPrefix(destPrefixRaw);
  const started = Date.now();
  const { profile, secret } = await decryptSecret(accountId);
  if (isDfsEndpoint(profile.endpoint)) {
    throw new Error("Move is not supported for ADLS Gen2 attachments yet.");
  }
  const client = blobContainerClientFromSecret(secret, container);
  try {
    const { jobs, markers, markerTargets } = await planBlobCopy(
      client,
      names,
      destPrefix,
      overwrite,
    );
    await runBlobCopy(client, secret, jobs);
    await createFolderMarkers(client, markerTargets);
    // Sources are deleted only after every copy succeeded.
    const deleted = await settleBounded(
      [...new Set(jobs.map((j) => j.src))],
      async (name) => {
        await client.deleteBlob(name);
      },
    );
    const deleteFailures = deleted.filter(
      (result): result is PromiseRejectedResult => result.status === "rejected",
    );
    if (deleteFailures.length > 0) {
      throw new Error(
        `The destination copy completed, but ${deleteFailures.length} source blob${deleteFailures.length === 1 ? "" : "s"} could not be deleted. The move is partial; check both locations before retrying. ${deleteFailures[0]!.reason instanceof Error ? deleteFailures[0]!.reason.message : String(deleteFailures[0]!.reason)}`,
      );
    }
    await runBounded(markers, async (marker) => {
      await client.deleteBlob(marker).catch(() => {});
    });
    const count = jobs.length + markerTargets.length;
    logActivity({
      kind: "blob",
      text: `Moved ${count} item${count === 1 ? "" : "s"} to '${destPrefix || container}'`,
      status: "success",
      durationMs: Date.now() - started,
    });
    return count;
  } catch (err) {
    const message = err instanceof Error ? err.message : "Move failed";
    logActivity({
      kind: "blob",
      text: `Move to '${destPrefix || container}' failed`,
      detail: message,
      status: "failed",
    });
    throw copyError(err, "move");
  }
}
