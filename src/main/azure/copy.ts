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
): Promise<{ jobs: CopyPlan[]; markers: string[] }> {
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
  for (const f of files) {
    if (seen.has(f.name)) continue;
    seen.add(f.name);
    const parent = folders
      .filter((fd) => f.name.startsWith(fd))
      .sort((a, b) => b.length - a.length)[0]!;
    const rel = f.name.slice(parent.length);
    addJob(f.name, destPrefix ? `${destPrefix}/${rel}` : rel);
  }
  if (jobs.length === 0)
    throw new Error("Selected blobs are already in that folder.");
  if (!overwrite) {
    const conflicts: string[] = [];
    await Promise.all(
      jobs.map(async (j) => {
        const found = await blobExists(client, j.dest);
        if (found.exists)
          conflicts.push(`${j.dest} (${formatBytes(found.size)})`);
      }),
    );
    if (conflicts.length > 0) {
      const shown = conflicts.slice(0, 5).join(", ");
      throw new Error(
        `Destination already exists (${conflicts.length}): ${shown}${conflicts.length > 5 ? "…" : ""} ` +
          "Tick “Replace existing” to overwrite, or pick a different folder.",
      );
    }
  }
  return { jobs, markers };
}

async function runBlobCopy(
  client: ContainerClient,
  secret: string,
  jobs: CopyPlan[],
): Promise<void> {
  // Bounded parallelism keeps large selections moving without flooding.
  const queue = [...jobs];
  const workers = Array.from(
    { length: Math.min(8, Math.max(1, queue.length)) },
    async () => {
      while (queue.length > 0) {
        const job = queue.shift()!;
        const srcUrl = withSas(client.getBlobClient(job.src).url, secret);
        await client.getBlockBlobClient(job.dest).syncCopyFromURL(srcUrl);
      }
    },
  );
  await Promise.all(workers);
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
    const { jobs } = await planBlobCopy(client, names, destPrefix, overwrite);
    await runBlobCopy(client, secret, jobs);
    logActivity({
      kind: "blob",
      text: `Copied ${jobs.length} item${jobs.length === 1 ? "" : "s"} to '${destPrefix || container}'`,
      status: "success",
      durationMs: Date.now() - started,
    });
    return jobs.length;
  } catch (err) {
    const message = err instanceof Error ? err.message : "Copy failed";
    logActivity({
      kind: "blob",
      text: `Copy to '${destPrefix || container}' failed`,
      detail: message,
      status: "failed",
    });
    throw friendlyError(err, "Failed to copy");
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
    const { jobs, markers } = await planBlobCopy(
      client,
      names,
      destPrefix,
      overwrite,
    );
    await runBlobCopy(client, secret, jobs);
    // Sources are deleted only after every copy succeeded.
    await Promise.all(
      [...new Set(jobs.map((j) => j.src))].map((n) => client.deleteBlob(n)),
    );
    await Promise.all(markers.map((m) => client.deleteBlob(m).catch(() => {})));
    logActivity({
      kind: "blob",
      text: `Moved ${jobs.length} item${jobs.length === 1 ? "" : "s"} to '${destPrefix || container}'`,
      status: "success",
      durationMs: Date.now() - started,
    });
    return jobs.length;
  } catch (err) {
    const message = err instanceof Error ? err.message : "Move failed";
    logActivity({
      kind: "blob",
      text: `Move to '${destPrefix || container}' failed`,
      detail: message,
      status: "failed",
    });
    throw friendlyError(err, "Failed to move");
  }
}
