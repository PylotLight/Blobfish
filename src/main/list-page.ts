/* One page of a folder listing. Shared by the listing worker (list-worker.ts)
 * and the in-process fallback, so it must stay free of electron imports. */
import type { BlobItem, BlobPrefix } from "@azure/storage-blob";
import type { Path } from "@azure/storage-file-datalake";
import {
  blobContainerClientFromSecret,
  dataLakeFileSystemClientFromSecret,
} from "./azure-clients";
import type { StorageBlobItem } from "../shared/types";

/** Azure's own per-request ceiling for list operations. */
export const MAX_LIST_PAGE = 5000;

export interface ListPageRequest {
  dfs: boolean;
  secret: string;
  container: string;
  /** Effective folder (base prefix + navigation), no leading/trailing slash. */
  effective: string;
  includeDeleted: boolean;
  pageSize?: number;
  continuationToken?: string;
}

export interface ListPageResult {
  items: StorageBlobItem[];
  continuationToken?: string;
}

export function clampPageSize(n: number | undefined): number {
  if (!n || !Number.isFinite(n)) return MAX_LIST_PAGE;
  return Math.max(1, Math.min(MAX_LIST_PAGE, Math.floor(n)));
}

function leafOf(full: string, effective: string): string {
  return effective === "" ? full : full.slice(effective.length + 1) || full;
}

export function sortListing(items: StorageBlobItem[]): StorageBlobItem[] {
  return items.sort(
    (a, b) =>
      Number(b.isPrefix) - Number(a.isPrefix) || a.leaf.localeCompare(b.leaf),
  );
}

/** Map one listBlobsByHierarchy segment to rows. */
export function mapHierarchySegment(
  segment: { blobPrefixes?: BlobPrefix[]; blobItems?: BlobItem[] },
  effective: string,
): StorageBlobItem[] {
  const listingPrefix = effective === "" ? "" : `${effective}/`;
  const items: StorageBlobItem[] = [];
  for (const p of segment.blobPrefixes ?? []) {
    const full = p.name.replace(/\/$/, "");
    items.push({ name: full, leaf: leafOf(full, effective), isPrefix: true });
  }
  for (const b of segment.blobItems ?? []) {
    // Zero-byte `folder/` marker blobs (created by New Folder) surface as folders.
    if (b.name.endsWith("/") && (b.properties?.contentLength ?? 0) === 0) {
      const full = b.name.replace(/\/$/, "");
      items.push({ name: full, leaf: leafOf(full, effective), isPrefix: true });
      continue;
    }
    items.push({
      name: b.name,
      leaf: b.name.slice(listingPrefix.length) || b.name,
      isPrefix: false,
      size: b.properties?.contentLength,
      lastModified: b.properties?.lastModified?.toISOString(),
      contentType: b.properties?.contentType,
      deleted: b.deleted || undefined,
    });
  }
  return sortListing(items);
}

/** Map one ADLS listPaths(recursive=false) page to rows. */
export function mapDfsPaths(
  paths: Path[],
  effective: string,
): StorageBlobItem[] {
  const items: StorageBlobItem[] = [];
  const seen = new Set<string>();
  for (const p of paths) {
    const full = p.name ?? "";
    const rest = effective === "" ? full : full.slice(effective.length + 1);
    if (rest === "" || rest.includes("/")) {
      // Deeper nesting collapsed to the next segment as a prefix.
      const seg = rest.split("/")[0];
      const dirName = effective === "" ? seg! : `${effective}/${seg}`;
      if (seg && !seen.has(dirName)) {
        seen.add(dirName);
        items.push({ name: dirName, leaf: seg, isPrefix: true });
      }
      continue;
    }
    items.push({
      name: full,
      leaf: rest,
      isPrefix: Boolean(p.isDirectory),
      size: p.contentLength,
      lastModified: p.lastModified?.toISOString(),
    });
  }
  return sortListing(items);
}

export async function listPage(req: ListPageRequest): Promise<ListPageResult> {
  const maxPageSize = clampPageSize(req.pageSize);
  const continuationToken = req.continuationToken || undefined;
  if (req.dfs) {
    if (req.includeDeleted) {
      throw new Error(
        "Showing deleted blobs is not supported for ADLS Gen2 attachments yet.",
      );
    }
    const fs = dataLakeFileSystemClientFromSecret(req.secret, req.container);
    const iter = fs
      .listPaths({
        path: req.effective === "" ? undefined : req.effective,
        recursive: false,
      })
      .byPage({ maxPageSize, continuationToken });
    const { value: page } = await iter.next();
    if (!page) return { items: [] };
    return {
      items: mapDfsPaths(page.pathItems ?? [], req.effective),
      continuationToken: page.continuation || undefined,
    };
  }
  const client = blobContainerClientFromSecret(req.secret, req.container);
  const prefix = req.effective === "" ? undefined : `${req.effective}/`;
  const iter = client
    .listBlobsByHierarchy("/", { prefix, includeDeleted: req.includeDeleted })
    .byPage({ maxPageSize, continuationToken });
  const { value: page } = await iter.next();
  if (!page) return { items: [] };
  return {
    items: mapHierarchySegment(page.segment, req.effective),
    continuationToken: page.continuationToken || undefined,
  };
}
