/**
 * Pure keyboard-navigation logic for the Explorer file list (Finder-style).
 * No DOM, no React: the renderer hook (useExplorerKeys) maps KeyboardEvents
 * through `commandFor`, then applies the result with `applyMove` /
 * `typeaheadMatch` / `revealScrollTop`. Indices are positions in the visible
 * (filtered + sorted) row order; -1 means "no active row".
 */

export interface NavKey {
  key: string;
  shift: boolean;
  /** ⌘ on macOS, Ctrl elsewhere (either is accepted). */
  mod: boolean;
  alt: boolean;
}

export type MoveTarget =
  "next" | "prev" | "first" | "last" | "pageDown" | "pageUp";

export type NavCommand =
  | { type: "move"; to: MoveTarget; extend: boolean }
  | { type: "selectAll" }
  | { type: "open" }
  | { type: "up" }
  | { type: "quickLook" }
  | { type: "delete" }
  | { type: "typeahead"; char: string };

/**
 * Which list command a key press means, or null to let it through untouched
 * (so ⌘K, ⌘F, ⌘B, Tab, Escape etc. keep working).
 * `typing` is true while a type-ahead burst is in progress: Space then extends
 * the query ("my file") instead of opening Quick Look.
 */
export function commandFor(k: NavKey, typing = false): NavCommand | null {
  const { key, shift, mod, alt } = k;
  if (alt) return null;
  switch (key) {
    case "ArrowDown":
      if (mod) return shift ? null : { type: "open" };
      return { type: "move", to: "next", extend: shift };
    case "ArrowUp":
      if (mod) return shift ? null : { type: "up" };
      return { type: "move", to: "prev", extend: shift };
    case "Home":
      return mod ? null : { type: "move", to: "first", extend: shift };
    case "End":
      return mod ? null : { type: "move", to: "last", extend: shift };
    case "PageDown":
      return mod ? null : { type: "move", to: "pageDown", extend: shift };
    case "PageUp":
      return mod ? null : { type: "move", to: "pageUp", extend: shift };
    case "Enter":
      return mod || shift ? null : { type: "open" };
    case "Backspace":
      if (shift) return null;
      return mod ? { type: "delete" } : { type: "up" };
    case "Delete":
      return mod || shift ? null : { type: "delete" };
    case " ":
      if (mod) return null;
      return typing
        ? { type: "typeahead", char: " " }
        : shift
          ? null
          : { type: "quickLook" };
  }
  if (mod) {
    return key.toLowerCase() === "a" && !shift ? { type: "selectAll" } : null;
  }
  // One printable character (letters, digits, punctuation, any script).
  if ([...key].length === 1 && key !== " ")
    return { type: "typeahead", char: key };
  return null;
}

export interface MoveResult {
  active: number;
  anchor: number;
  /** Inclusive [lo, hi] index range that should be selected. */
  range: [number, number];
}

/**
 * Move the active row. Plain moves select just the new row and re-anchor
 * there; extended (Shift) moves keep the anchor and select anchor..active.
 * `hasSelection` false with an active row (tabbed in, nothing picked yet)
 * makes the first ↑/↓ select that row instead of skipping past it.
 * Returns null when there are no rows.
 */
export function applyMove(
  count: number,
  active: number,
  anchor: number,
  to: MoveTarget,
  extend: boolean,
  pageSize = 10,
  hasSelection = true,
): MoveResult | null {
  if (count <= 0) return null;
  const last = count - 1;
  const page = Math.max(1, Math.floor(pageSize));
  const cur = active >= 0 && active <= last ? active : -1;
  if (
    !hasSelection &&
    cur !== -1 &&
    !extend &&
    (to === "next" || to === "prev")
  ) {
    return { active: cur, anchor: cur, range: [cur, cur] };
  }
  let next: number;
  switch (to) {
    case "next":
      next = cur === -1 ? 0 : Math.min(last, cur + 1);
      break;
    case "prev":
      next = cur === -1 ? last : Math.max(0, cur - 1);
      break;
    case "first":
      next = 0;
      break;
    case "last":
      next = last;
      break;
    case "pageDown":
      next = cur === -1 ? Math.min(last, page - 1) : Math.min(last, cur + page);
      break;
    case "pageUp":
      next = cur === -1 ? 0 : Math.max(0, cur - page);
      break;
  }
  if (!extend) return { active: next, anchor: next, range: [next, next] };
  const a = anchor >= 0 && anchor <= last ? anchor : cur === -1 ? next : cur;
  return { active: next, anchor: a, range: a < next ? [a, next] : [next, a] };
}

/**
 * Type-ahead: index of the first label (case-insensitive prefix match) at or
 * after `from`, wrapping around; -1 when nothing matches.
 */
export function typeaheadMatch(
  labels: readonly string[],
  query: string,
  from: number,
): number {
  const n = labels.length;
  if (n === 0 || query === "") return -1;
  const q = query.toLocaleLowerCase();
  const start = ((Math.max(0, from) % n) + n) % n;
  for (let i = 0; i < n; i++) {
    const idx = (start + i) % n;
    if (labels[idx]!.toLocaleLowerCase().startsWith(q)) return idx;
  }
  return -1;
}

/**
 * Next type-ahead step: the query to match and where to start searching.
 * A single char, or one char repeated ("bbb"), cycles through the rows that
 * start with it (search from the row after the active one), like Finder;
 * a longer word refines in place from the active row.
 */
export function typeaheadQuery(
  buffer: string,
  active: number,
): { query: string; from: number } {
  const chars = [...buffer];
  const first = chars[0]!.toLocaleLowerCase();
  const repeated = chars.every((c) => c.toLocaleLowerCase() === first);
  if (repeated) return { query: chars[0]!, from: active + 1 };
  return { query: buffer, from: Math.max(0, active) };
}

/**
 * scrollTop that brings a row fully into view with the least movement.
 * `rowTop` is in scroll-content coordinates; `stickyTop` is the height of a
 * sticky header covering the top of the viewport (0 when none).
 */
export function revealScrollTop(
  scrollTop: number,
  viewHeight: number,
  rowTop: number,
  rowHeight: number,
  stickyTop = 0,
): number {
  const top = scrollTop + stickyTop;
  const bottom = scrollTop + viewHeight;
  if (rowTop < top) return Math.max(0, rowTop - stickyTop);
  if (rowTop + rowHeight > bottom)
    return Math.max(0, rowTop + rowHeight - viewHeight);
  return scrollTop;
}
