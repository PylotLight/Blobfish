import { decryptSecret } from "../accounts";
import { logActivity } from "../activity";
import {
  blobContainerClientFromSecret,
  blobServiceFromSecret,
  dataLakeFileSystemClientFromSecret,
  dataLakeServiceFromSecret,
  isDfsEndpoint,
} from "../azure-clients";
import { MAX_LIST_PAGE } from "../list-page";
import { runListPage } from "../list-runner";
import type {
  BlobVersionInfo,
  ListBlobsWire,
  StorageContainer,
} from "../../shared/types";
import { friendlyError } from "./errors";

export async function listContainers(
  accountId: string,
): Promise<StorageContainer[]> {
  const { profile, secret } = await decryptSecret(accountId);
  // Container-scoped attachments cannot enumerate the account — return the
  // attached container as a singleton without probing it. A getProperties
  // probe 403s on list-only SAS tokens even though blob listing works fine,
  // which cried wolf in the activity dock; the blob listing itself is the
  // arbiter of access and its failures surface in the blob view.
  if (profile.kind !== "account" && profile.containerName) {
    // Still validates a container SAS against the attached container
    // (throws on mismatch) — it just performs no network call.
    if (isDfsEndpoint(profile.endpoint)) {
      dataLakeFileSystemClientFromSecret(secret, profile.containerName);
    } else {
      blobContainerClientFromSecret(secret, profile.containerName);
    }
    return [{ name: profile.containerName }];
  }
  // Forgiving: an "account" profile that actually holds a container SAS URL.
  if (profile.containerName && profile.authType === "sas") {
    return [{ name: profile.containerName }];
  }
  try {
    if (isDfsEndpoint(profile.endpoint)) {
      const svc = dataLakeServiceFromSecret(secret);
      const out: StorageContainer[] = [];
      for await (const fs of svc.listFileSystems()) {
        out.push({ name: fs.name });
      }
      return out.sort((a, b) => a.name.localeCompare(b.name));
    }
    const svc = blobServiceFromSecret(profile.endpoint, secret);
    const out: StorageContainer[] = [];
    for await (const c of svc.listContainers()) {
      out.push({
        name: c.name,
        lastModified: c.properties?.lastModified?.toISOString(),
      });
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  } catch (err) {
    const friendly = friendlyError(err, "Failed to list containers");
    logActivity({
      kind: "connection",
      text: `List containers in '${profile.name}' failed`,
      detail: friendly.message,
      status: "failed",
    });
    throw friendly;
  }
}
export async function listBlobs(
  accountId: string,
  containerArg?: string,
  prefixArg?: string,
  pageSize = MAX_LIST_PAGE,
  includeDeleted = false,
  continuationToken?: string,
): Promise<ListBlobsWire> {
  const { profile, secret } = await decryptSecret(accountId);
  const container = (containerArg ?? profile.containerName ?? "").trim();
  if (container === "") throw new Error("No container selected.");
  const base = (profile.prefix ?? "").replace(/^\/+|\/+$/g, "");
  const nav = (prefixArg ?? "").replace(/^\/+/, "");
  const effective = [base, nav]
    .filter(Boolean)
    .join("/")
    .replace(/^\/+|\/+$/g, "");

  try {
    // One page per call: the renderer pages through big folders with the
    // continuation token. Parsing happens on the listing worker thread.
    const page = await runListPage({
      dfs: isDfsEndpoint(profile.endpoint),
      secret,
      container,
      effective,
      includeDeleted,
      pageSize,
      continuationToken,
    });
    return { container, prefix: effective, ...page };
  } catch (err) {
    const friendly = friendlyError(
      err,
      `Failed to list blobs in "${container}"`,
    );
    logActivity({
      kind: "connection",
      text: `List blobs in '${container}' failed`,
      detail: friendly.message,
      status: "failed",
    });
    throw friendly;
  }
}
/* ---------------- versions & soft-deleted ---------------- */

export async function listBlobVersions(
  accountId: string,
  container: string,
  name: string,
): Promise<BlobVersionInfo[]> {
  const clean = name.trim();
  if (clean === "") throw new Error("No blob selected.");
  const { profile, secret } = await decryptSecret(accountId);
  if (isDfsEndpoint(profile.endpoint)) {
    throw new Error(
      "Version history is not supported for ADLS Gen2 attachments yet.",
    );
  }
  const client = blobContainerClientFromSecret(secret, container);
  try {
    const out: BlobVersionInfo[] = [];
    for await (const b of client.listBlobsFlat({
      prefix: clean,
      includeVersions: true,
      includeSnapshots: true,
    })) {
      // Prefix matches siblings (`report` vs `report-final`) — exact only.
      if (b.name !== clean) continue;
      out.push({
        name: clean,
        versionId: b.versionId,
        snapshot: b.snapshot || undefined,
        lastModified: b.properties?.lastModified?.toISOString(),
        size: b.properties?.contentLength,
        isCurrent:
          b.isCurrentVersion ?? (b.versionId === undefined && !b.snapshot),
      });
    }
    out.sort(
      (a, b) =>
        Number(b.isCurrent) - Number(a.isCurrent) ||
        (b.lastModified ?? "").localeCompare(a.lastModified ?? ""),
    );
    return out;
  } catch (err) {
    const friendly = friendlyError(
      err,
      `Failed to list versions of "${clean}"`,
    );
    logActivity({
      kind: "connection",
      text: `List versions of '${clean}' failed`,
      detail: friendly.message,
      status: "failed",
    });
    throw friendly;
  }
}
