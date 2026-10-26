import type { StorageBlobItem } from "../../../../shared/types";

export type SortKey = "name" | "size" | "modified";
export type SortDir = 1 | -1;

export function sasWarning(expiry?: string | null): string | null {
  if (!expiry) return null;
  const ms = Date.parse(expiry);
  if (Number.isNaN(ms)) return null;
  if (ms <= Date.now())
    return `SAS expired ${new Date(ms).toLocaleDateString()}`;
  const days = Math.ceil((ms - Date.now()) / 86_400_000);
  return days <= 14 ? `SAS expires in ${days}d` : null;
}

/* Big folders (5,000 rows per listing page) used to mount every row: ~40k DOM
 * nodes, multi-second opens and ~500 ms per click. Past this many rows only the
 * visible window (plus overscan) is rendered between two spacer rows. */
export const VIRTUAL_MIN_ROWS = 200;
export const VIRTUAL_OVERSCAN = 12;
export const DEFAULT_ROW_HEIGHT = 46;

// One shared formatter/collator: `toLocaleString`/`localeCompare` rebuild the
// locale data on every call, which dominated sorting and row rendering.
const dateFormat = new Intl.DateTimeFormat(undefined, {
  year: "numeric",
  month: "numeric",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  second: "2-digit",
});
export const collator = new Intl.Collator();

export function formatWhen(iso: string | undefined): string {
  if (!iso) return "—";
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? "—" : dateFormat.format(ms);
}

export function keyOf(item: StorageBlobItem): string {
  return item.isPrefix ? `${item.name}/` : item.name;
}

/** True when a blob path was covered by a selection of files/folders. */
export function isSelectedPath(name: string, sel: string[]): boolean {
  return sel.some((s) => (s.endsWith("/") ? name.startsWith(s) : name === s));
}

export interface PreviewTab {
  key: string;
  container: string;
  name: string;
  size?: number;
}

export interface CtxMenu {
  x: number;
  y: number;
  /** Selection keys the menu acts on (empty = background). */
  keys: string[];
}
