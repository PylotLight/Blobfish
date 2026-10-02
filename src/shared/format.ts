/** Shared display formatting — renderer and main both use these. */

export function formatBytes(n?: number): string {
  if (n === undefined || Number.isNaN(n)) return '—'
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`
}

export function formatSpeed(bps?: number): string {
  if (!bps || bps <= 0) return '—'
  return `${formatBytes(bps)}/s`
}

export function formatDuration(ms?: number): string {
  if (ms === undefined) return '—'
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 60) return `${s} second${s === 1 ? '' : 's'}`
  const m = Math.floor(s / 60)
  const rest = s % 60
  return rest === 0 ? `${m}m` : `${m}m ${rest}s`
}

export function formatEta(sec?: number): string {
  if (sec === undefined || !Number.isFinite(sec)) return '—'
  const s = Math.max(0, Math.round(sec))
  if (s < 60) return `${s}s left`
  const m = Math.floor(s / 60)
  return `${m}m ${s % 60}s left`
}

export function formatPct(done: number, total: number): string {
  if (!total || total <= 0) return '—'
  return `${Math.min(100, Math.floor((done / total) * 100))}%`
}
