/**
 * Which rows of a fixed-height list to mount for a scroll position.
 * `offset` is how far the viewport top sits past the first row (px).
 * Returns a half-open [start, end) range including `overscan` rows each side.
 */
export function virtualWindow(
  count: number,
  offset: number,
  viewportHeight: number,
  rowHeight: number,
  overscan: number,
): { start: number; end: number } {
  if (count <= 0 || rowHeight <= 0)
    return { start: 0, end: Math.max(0, count) };
  const first = Math.floor(Math.max(0, offset) / rowHeight);
  const start = Math.min(Math.max(0, first - overscan), Math.max(0, count - 1));
  const visible = Math.ceil(Math.max(0, viewportHeight) / rowHeight);
  const end = Math.min(count, first + visible + overscan);
  return { start, end: Math.max(end, Math.min(count, start + 1)) };
}

/**
 * Row pitch (row height incl. gaps) from the tops of consecutive mounted rows.
 * Skips the first row: in a border-collapsed table the row right after the spacer
 * renders half a border shorter (47.5 vs 48), and sizing 10k spacer rows off it
 * leaves the list ~5,000px off, which is what fed the fast-scroll loop.
 */
export function rowPitch(tops: number[], fallback: number): number {
  const n = tops.length;
  if (n >= 3) return (tops[n - 1]! - tops[1]!) / (n - 2);
  if (n === 2) return tops[1]! - tops[0]!;
  return fallback;
}

/**
 * Caps how many times a layout effect may re-measure (and setState) synchronously
 * before the next frame. A layout that never settles (scroll anchoring, sub-pixel
 * rows) then finishes on the next animation frame instead of tripping React's
 * nested-update limit (minified error #185, the blank window on fast scroll).
 */
export function syncBudget(
  limit = 3,
  schedule: (cb: () => void) => unknown = requestAnimationFrame,
): () => boolean {
  let used = 0;
  return () => {
    if (used === 0) schedule(() => (used = 0));
    return used++ < limit;
  };
}
