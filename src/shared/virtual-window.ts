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
  overscan: number
): { start: number; end: number } {
  if (count <= 0 || rowHeight <= 0) return { start: 0, end: Math.max(0, count) }
  const first = Math.floor(Math.max(0, offset) / rowHeight)
  const start = Math.min(Math.max(0, first - overscan), Math.max(0, count - 1))
  const visible = Math.ceil(Math.max(0, viewportHeight) / rowHeight)
  const end = Math.min(count, first + visible + overscan)
  return { start, end: Math.max(end, Math.min(count, start + 1)) }
}
