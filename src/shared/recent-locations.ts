/**
 * Recent folders for the ⌘K quick switcher: the container + prefix pairs the explorer visited,
 * most recent first. Kept apart from command-palette.ts so the eager renderer bundle only pulls
 * this (tiny) bit and the scorer stays in the palette's lazy chunk.
 */

export interface RecentLocation {
  accountId: string;
  container: string;
  /** Folder prefix inside the container, no leading/trailing slash; '' = container root. */
  prefix: string;
}

export const MAX_RECENT_LOCATIONS = 15;

export function locationKey(loc: RecentLocation): string {
  return `${loc.accountId}/${loc.container}/${loc.prefix}`;
}

function cleanPrefix(prefix: string): string {
  return prefix.replace(/^\/+|\/+$/g, "");
}

/** Most recent first; a location visited again moves to the top. Container roots are skipped. */
export function recordLocation(
  list: readonly RecentLocation[],
  loc: RecentLocation,
  limit = MAX_RECENT_LOCATIONS,
): RecentLocation[] {
  const next = { ...loc, prefix: cleanPrefix(loc.prefix) };
  if (!next.prefix) return [...list];
  const key = locationKey(next);
  return [next, ...list.filter((l) => locationKey(l) !== key)].slice(0, limit);
}

export function parseLocations(value: unknown): RecentLocation[] {
  if (!Array.isArray(value)) return [];
  const out: RecentLocation[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const { accountId, container, prefix } = item as Record<string, unknown>;
    if (
      typeof accountId !== "string" ||
      typeof container !== "string" ||
      typeof prefix !== "string"
    )
      continue;
    if (
      !accountId ||
      !container ||
      !cleanPrefix(prefix) ||
      prefix.length > 1024
    )
      continue;
    const loc = { accountId, container, prefix: cleanPrefix(prefix) };
    const key = locationKey(loc);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(loc);
    if (out.length >= MAX_RECENT_LOCATIONS) break;
  }
  return out;
}
