/**
 * Tiny glue between the ⌘K palette and the views that own the actions, so App.tsx doesn't have
 * to thread every Explorer / TransfersPanel handler through props.
 *
 * - Explorer publishes a snapshot (where you are, what's selected) and listens for actions.
 * - TransfersPanel listens for panel actions.
 * - The palette (lazy chunk) reads the snapshot and fires actions.
 *
 * Eager and dependency-free on purpose; the scorer lives in the palette's lazy chunk.
 */
import { parseLocations, recordLocation, type RecentLocation } from '../../shared/recent-locations'

export type ExplorerAction =
  | 'refresh'
  | 'upload-files'
  | 'upload-folder'
  | 'new-folder'
  | 'new-container'
  | 'download'
  | 'copy-url'
  | 'copy-path'
  | 'focus-filter'
  | 'toggle-deleted'
  | 'go-up'

export type PanelAction = 'toggle-transfers' | 'show-activity'

export interface ExplorerSnapshot {
  accountId: string
  container: string | null
  prefix: string
  selection: number
  /** Container names Explorer has listed for this account (may be empty for scoped SAS). */
  containers: string[]
  canManageContainers: boolean
  showDeleted: boolean
}

const bus = new EventTarget()
let snapshot: ExplorerSnapshot | null = null
let lastLocation = ''

export function publishExplorer(next: ExplorerSnapshot | null): void {
  snapshot = next
  if (!next?.container || !next.prefix) return
  const key = `${next.accountId}/${next.container}/${next.prefix}`
  if (key === lastLocation) return
  lastLocation = key
  rememberLocation({ accountId: next.accountId, container: next.container, prefix: next.prefix })
}

export function getExplorerSnapshot(): ExplorerSnapshot | null {
  return snapshot
}

export function sendExplorerAction(action: ExplorerAction): void {
  bus.dispatchEvent(new CustomEvent('explorer', { detail: action }))
}

export function onExplorerAction(handler: (action: ExplorerAction) => void): () => void {
  const listener = (e: Event): void => handler((e as CustomEvent<ExplorerAction>).detail)
  bus.addEventListener('explorer', listener)
  return () => bus.removeEventListener('explorer', listener)
}

export function sendPanelAction(action: PanelAction): void {
  bus.dispatchEvent(new CustomEvent('panel', { detail: action }))
}

export function onPanelAction(handler: (action: PanelAction) => void): () => void {
  const listener = (e: Event): void => handler((e as CustomEvent<PanelAction>).detail)
  bus.addEventListener('panel', listener)
  return () => bus.removeEventListener('panel', listener)
}

// ---------------------------------------------------------------------------
// Recent folders (persisted, read by the palette's quick switcher)

const LOCATIONS_KEY = 'blobfish.palette.locations.v1'

export function loadLocations(): RecentLocation[] {
  try {
    return parseLocations(JSON.parse(localStorage.getItem(LOCATIONS_KEY) ?? '[]'))
  } catch {
    return []
  }
}

function rememberLocation(loc: RecentLocation): void {
  try {
    localStorage.setItem(LOCATIONS_KEY, JSON.stringify(recordLocation(loadLocations(), loc)))
  } catch {
    // Storage blocked — recents just won't persist.
  }
}
