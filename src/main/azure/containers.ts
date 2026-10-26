import { decryptSecret } from "../accounts";
import { logActivity } from "../activity";
import {
  blobContainerClientFromSecret,
  blobServiceFromSecret,
  dataLakeFileSystemClientFromSecret,
  dataLakeServiceFromSecret,
  isConnectionStringSecret,
  isDfsEndpoint,
} from "../azure-clients";
import { joinKey } from "./common";
import { friendlyError } from "./errors";

/* ---------------- CRUD ---------------- */

export async function createContainer(
  accountId: string,
  name: string,
): Promise<void> {
  const clean = name.trim().toLowerCase();
  if (!/^[a-z0-9]([a-z0-9-]{1,61}[a-z0-9])?$/.test(clean)) {
    throw new Error(
      "Container names are 3–63 lowercase letters, numbers and dashes.",
    );
  }
  const started = Date.now();
  const { profile, secret } = await decryptSecret(accountId);
  try {
    if (isDfsEndpoint(profile.endpoint)) {
      await dataLakeServiceFromSecret(secret)
        .getFileSystemClient(clean)
        .create();
    } else {
      await blobServiceFromSecret(profile.endpoint, secret)
        .getContainerClient(clean)
        .create();
    }
    logActivity({
      kind: "container",
      text: `Created container '${clean}' in '${profile.name}'`,
      status: "success",
      durationMs: Date.now() - started,
    });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to create container";
    logActivity({
      kind: "container",
      text: `Create container '${clean}' failed`,
      detail: message,
      status: "failed",
    });
    throw friendlyError(err, `Failed to create container "${clean}"`);
  }
}

export async function deleteContainer(
  accountId: string,
  name: string,
): Promise<void> {
  const started = Date.now();
  const { profile, secret } = await decryptSecret(accountId);
  try {
    if (isDfsEndpoint(profile.endpoint)) {
      await dataLakeServiceFromSecret(secret)
        .getFileSystemClient(name)
        .delete();
    } else {
      await blobServiceFromSecret(profile.endpoint, secret)
        .getContainerClient(name)
        .delete();
    }
    logActivity({
      kind: "container",
      text: `Deleted container '${name}' from '${profile.name}'`,
      status: "success",
      durationMs: Date.now() - started,
    });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to delete container";
    logActivity({
      kind: "container",
      text: `Delete container '${name}' failed`,
      detail: message,
      status: "failed",
    });
    throw friendlyError(err, `Failed to delete container "${name}"`);
  }
}
/**
 * Azure has no server-side container rename, so this copies every blob to a
 * new container and deletes the source. Refuses to delete the source unless
 * every copy succeeded.
 */
export async function renameContainer(
  accountId: string,
  source: string,
  destRaw: string,
): Promise<string> {
  const dest = destRaw.trim().toLowerCase();
  if (!/^[a-z0-9]([a-z0-9-]{1,61}[a-z0-9])?$/.test(dest)) {
    throw new Error(
      "Container names are 3–63 lowercase letters, numbers and dashes.",
    );
  }
  if (dest === source) return source;
  const started = Date.now();
  const { profile, secret } = await decryptSecret(accountId);
  if (isDfsEndpoint(profile.endpoint)) {
    throw new Error(
      "Renaming ADLS Gen2 filesystems is not supported yet — create a new one and move files instead.",
    );
  }
  if (profile.kind !== "account" || profile.containerName) {
    throw new Error(
      "Renaming containers is only available on full storage-account connections.",
    );
  }
  const svc = blobServiceFromSecret(profile.endpoint, secret);
  const srcClient = svc.getContainerClient(source);
  const destClient = svc.getContainerClient(dest);
  try {
    await destClient.create();
  } catch (err) {
    throw friendlyError(err, `Failed to create container "${dest}"`);
  }
  try {
    const names: string[] = [];
    for await (const b of srcClient.listBlobsFlat()) {
      names.push(b.name);
    }
    let sas = "";
    if (!isConnectionStringSecret(secret) && secret.includes("?")) {
      sas = secret.slice(secret.indexOf("?"));
    }
    // Bounded parallelism keeps large containers moving without flooding.
    const queue = [...names];
    const workers = Array.from(
      { length: Math.min(8, Math.max(1, queue.length)) },
      async () => {
        while (queue.length > 0) {
          const n = queue.shift()!;
          const rawUrl = srcClient.getBlobClient(n).url;
          const srcUrl = rawUrl.includes("?") ? rawUrl : `${rawUrl}${sas}`;
          await destClient.getBlockBlobClient(n).syncCopyFromURL(srcUrl);
        }
      },
    );
    await Promise.all(workers);
    await srcClient.delete();
    logActivity({
      kind: "container",
      text: `Renamed container '${source}' → '${dest}' (${names.length} blob${names.length === 1 ? "" : "s"})`,
      status: "success",
      durationMs: Date.now() - started,
    });
    return dest;
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to rename container";
    logActivity({
      kind: "container",
      text: `Rename container '${source}' failed`,
      detail: message,
      status: "failed",
    });
    // Leave both containers in place so nothing is lost; surface the cause.
    throw friendlyError(err, `Failed to rename container "${source}"`);
  }
}
export async function createFolder(
  accountId: string,
  container: string,
  prefix: string | undefined,
  folderName: string,
): Promise<void> {
  const leaf = folderName.trim().replace(/^\/+|\/+$/g, "");
  if (leaf === "" || leaf.includes("/")) {
    throw new Error("Folder name cannot be empty or contain slashes.");
  }
  const full = joinKey(prefix, leaf);
  const started = Date.now();
  const { profile, secret } = await decryptSecret(accountId);
  try {
    if (isDfsEndpoint(profile.endpoint)) {
      const fs = dataLakeFileSystemClientFromSecret(secret, container);
      await fs.getDirectoryClient(full).create();
    } else {
      const client = blobContainerClientFromSecret(secret, container);
      // Zero-byte `folder/` marker — renders as a folder in hierarchy listings.
      await client.getBlockBlobClient(`${full}/`).uploadData(Buffer.alloc(0));
    }
    logActivity({
      kind: "folder",
      text: `Created folder '${full}' in '${container}'`,
      status: "success",
      durationMs: Date.now() - started,
    });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to create folder";
    logActivity({
      kind: "folder",
      text: `Create folder '${leaf}' failed`,
      detail: message,
      status: "failed",
    });
    throw friendlyError(err, `Failed to create folder "${leaf}"`);
  }
}
