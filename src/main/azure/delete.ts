import { basename } from "node:path";
import { decryptSecret } from "../accounts";
import { logActivity } from "../activity";
import {
  blobContainerClientFromSecret,
  dataLakeFileSystemClientFromSecret,
  isConnectionStringSecret,
  isDfsEndpoint,
} from "../azure-clients";
import { friendlyError } from "./errors";

/** Expand folder prefixes (trailing `/`) into the flat files beneath them, with sizes. */
export async function expandFiles(
  profileEndpoint: string,
  secret: string,
  container: string,
  names: string[],
): Promise<Array<{ name: string; size?: number }>> {
  const folders = names.filter((n) => n.endsWith("/"));
  const files: Array<{ name: string; size?: number }> = names
    .filter((n) => !n.endsWith("/"))
    .map((name) => ({ name }));
  if (folders.length === 0) return files;
  const out = [...files];
  const seen = new Set(out.map((f) => f.name));
  if (isDfsEndpoint(profileEndpoint)) {
    const fs = dataLakeFileSystemClientFromSecret(secret, container);
    for (const f of folders) {
      const trimmed = f.replace(/\/$/, "");
      for await (const p of fs.listPaths({ path: trimmed, recursive: true })) {
        if (!p.isDirectory && p.name && !seen.has(p.name)) {
          seen.add(p.name);
          out.push({ name: p.name, size: p.contentLength });
        }
      }
    }
  } else {
    const client = blobContainerClientFromSecret(secret, container);
    for (const f of folders) {
      for await (const b of client.listBlobsFlat({ prefix: f })) {
        if (!seen.has(b.name)) {
          seen.add(b.name);
          out.push({ name: b.name, size: b.properties?.contentLength });
        }
      }
    }
  }
  return out;
}
/** Flat file names a delete/dry-run selection expands to (folders → contents). */
export async function expandBlobNames(
  accountId: string,
  container: string,
  names: string[],
): Promise<string[]> {
  const { profile, secret } = await decryptSecret(accountId);
  return (await expandFiles(profile.endpoint, secret, container, names)).map(
    (f) => f.name,
  );
}
export async function deleteNames(
  accountId: string,
  container: string,
  names: string[],
): Promise<number> {
  if (names.length === 0) return 0;
  const started = Date.now();
  const { profile, secret } = await decryptSecret(accountId);
  try {
    let count: number;
    let removed: string[];
    if (isDfsEndpoint(profile.endpoint)) {
      const fs = dataLakeFileSystemClientFromSecret(secret, container);
      // Directories first (recursive), then files.
      for (const n of names.filter((x) => x.endsWith("/"))) {
        await fs.getDirectoryClient(n.replace(/\/$/, "")).delete(true);
      }
      removed = [];
      count = 0;
      for (const f of await expandFiles(
        profile.endpoint,
        secret,
        container,
        names,
      )) {
        await fs.getFileClient(f.name).delete();
        removed.push(f.name);
        count += 1;
      }
    } else {
      const client = blobContainerClientFromSecret(secret, container);
      const flat = (
        await expandFiles(profile.endpoint, secret, container, names)
      ).map((f) => f.name);
      await Promise.all(flat.map((n) => client.deleteBlob(n)));
      // Remove any folder markers left behind.
      await Promise.all(
        names
          .filter((n) => n.endsWith("/"))
          .map((n) => client.deleteBlob(n).catch(() => {})),
      );
      removed = [...flat, ...names.filter((n) => n.endsWith("/"))];
      count = flat.length;
    }
    const shown = removed.slice(0, 8).join(", ");
    logActivity({
      kind: "blob",
      text: `Deleted ${count} item${count === 1 ? "" : "s"} from '${container}'`,
      detail:
        removed.length > 0
          ? `${shown}${removed.length > 8 ? ` (+${removed.length - 8} more)` : ""}`
          : undefined,
      status: "success",
      durationMs: Date.now() - started,
    });
    return count;
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to delete";
    logActivity({
      kind: "blob",
      text: `Delete from '${container}' failed`,
      detail: message,
      status: "failed",
    });
    throw friendlyError(err, "Failed to delete");
  }
}
export async function undeleteBlobs(
  accountId: string,
  container: string,
  names: string[],
): Promise<number> {
  const files = names.filter((n) => !n.endsWith("/"));
  if (files.length === 0) throw new Error("Nothing selected to restore.");
  const started = Date.now();
  const { profile, secret } = await decryptSecret(accountId);
  if (isDfsEndpoint(profile.endpoint)) {
    throw new Error("Restore is not supported for ADLS Gen2 attachments yet.");
  }
  const client = blobContainerClientFromSecret(secret, container);
  try {
    await Promise.all(files.map((n) => client.getBlobClient(n).undelete()));
    logActivity({
      kind: "blob",
      text: `Restored ${files.length} item${files.length === 1 ? "" : "s"} in '${container}'`,
      status: "success",
      durationMs: Date.now() - started,
    });
    return files.length;
  } catch (err) {
    const message = err instanceof Error ? err.message : "Restore failed";
    logActivity({
      kind: "blob",
      text: `Restore in '${container}' failed`,
      detail: message,
      status: "failed",
    });
    throw friendlyError(err, "Failed to restore");
  }
}
export async function restoreVersion(
  accountId: string,
  container: string,
  name: string,
  versionId?: string,
  snapshot?: string,
): Promise<void> {
  const clean = name.trim();
  if (clean === "") throw new Error("No blob selected.");
  const started = Date.now();
  const { profile, secret } = await decryptSecret(accountId);
  if (isDfsEndpoint(profile.endpoint)) {
    throw new Error("Restore is not supported for ADLS Gen2 attachments yet.");
  }
  const client = blobContainerClientFromSecret(secret, container);
  try {
    const selector = versionId
      ? `versionId=${encodeURIComponent(versionId)}`
      : snapshot
        ? `snapshot=${encodeURIComponent(snapshot)}`
        : null;
    if (!selector) throw new Error("Select a version or snapshot to restore.");
    let srcUrl = `${client.getBlobClient(clean).url}?${selector}`;
    if (!isConnectionStringSecret(secret) && secret.includes("?")) {
      srcUrl += `&${secret.slice(secret.indexOf("?") + 1)}`;
    }
    await client.getBlockBlobClient(clean).syncCopyFromURL(srcUrl);
    logActivity({
      kind: "blob",
      text: `Restored '${clean}' from ${versionId ? "version" : "snapshot"} in '${container}'`,
      status: "success",
      durationMs: Date.now() - started,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Restore failed";
    logActivity({
      kind: "blob",
      text: `Restore '${clean}' failed`,
      detail: message,
      status: "failed",
    });
    throw friendlyError(err, `Failed to restore "${basename(clean)}"`);
  }
}
