import { readdir, stat } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, sep } from "node:path";

/** One local file to upload and its blob path relative to the destination prefix. */
export interface UploadSource {
  fp: string;
  rel: string;
  size: number;
}

/** Hard cap on dropped roots; a drop is a handful of Finder items, not a list from a page. */
export const MAX_DROPPED_PATHS = 1000;

/**
 * Validate explicit local paths (drag and drop) before main touches them: strings,
 * absolute, deduped, and present on disk. Throws on the first bad one so a bogus
 * IPC payload never half-enqueues.
 */
export async function validateLocalPaths(paths: unknown): Promise<string[]> {
  if (!Array.isArray(paths) || paths.length === 0)
    throw new Error("Nothing to upload.");
  if (paths.length > MAX_DROPPED_PATHS)
    throw new Error(`Too many items dropped (max ${MAX_DROPPED_PATHS}).`);
  const out: string[] = [];
  const seen = new Set<string>();
  for (const p of paths) {
    if (typeof p !== "string" || p.trim() === "" || p.includes("\0"))
      throw new Error("Invalid file path.");
    if (!isAbsolute(p)) throw new Error(`Not an absolute path: ${p}`);
    const clean = p.replace(/[\\/]+$/, "") || p;
    if (seen.has(clean)) continue;
    const st = await stat(clean).catch(() => null);
    if (!st) throw new Error(`File not found: ${clean}`);
    if (!st.isFile() && !st.isDirectory())
      throw new Error(`Not a file or folder: ${clean}`);
    seen.add(clean);
    out.push(clean);
  }
  return out;
}

/**
 * Expand roots into files. A file uploads as its basename; a folder uploads
 * recursively and keeps its own name and layout (<folder>/<sub>/<file>), same as
 * "Upload folder". Symlinks inside folders are skipped (as before).
 */
export async function expandUploadRoots(
  roots: string[],
): Promise<UploadSource[]> {
  const files: UploadSource[] = [];
  for (const root of roots) {
    const st = await stat(root).catch(() => null);
    if (!st) continue;
    if (st.isFile()) {
      files.push({ fp: root, rel: basename(root), size: st.size });
      continue;
    }
    if (!st.isDirectory()) continue;
    const parent = dirname(root);
    const entries = await readdir(root, {
      recursive: true,
      withFileTypes: true,
    }).catch(() => []);
    for (const entry of entries) {
      if (!entry.isFile()) continue; // dirs are implicit in blob names
      const fp = join(entry.parentPath, entry.name);
      const size = (await stat(fp).catch(() => null))?.size ?? 0;
      files.push({ fp, rel: relative(parent, fp).split(sep).join("/"), size });
    }
  }
  return files;
}

/**
 * Destination prefix for an upload. The explorer's listing prefix already includes
 * the account's scoped prefix (listBlobs returns the effective path), so only
 * prepend it when the caller's prefix doesn't start with it.
 */
export function uploadBase(
  profilePrefix: string | undefined,
  prefix: string | undefined,
): string {
  const trim = (s: string | undefined): string =>
    (s ?? "").replace(/^\/+|\/+$/g, "");
  const scope = trim(profilePrefix);
  const nav = trim(prefix);
  if (scope === "") return nav;
  if (nav === scope || nav.startsWith(`${scope}/`)) return nav;
  return [scope, nav].filter(Boolean).join("/");
}
