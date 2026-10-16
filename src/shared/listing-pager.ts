/* Pages through a folder listing with Azure continuation tokens. The first
 * page shows right away; the rest stream in behind it until the folder is
 * done, the user stops it, or the auto-load cap is hit (then "Load more"
 * fetches another cap's worth). Framework-free so it can be unit tested. */
import type { ListBlobsResult, StorageBlobItem } from './types'

/** Stop auto-paging after this many rows; the user can keep going by hand. */
export const LISTING_AUTO_CAP = 100_000

export type ListingPhase =
  /** First page in flight; nothing to show yet. */
  | 'first'
  /** More pages streaming in. */
  | 'more'
  /** Every page loaded. */
  | 'done'
  /** Paused with more to load: auto-load cap reached. */
  | 'cap'
  /** Paused with more to load: user pressed Stop. */
  | 'stopped'
  /** A later page failed; what loaded so far stays. */
  | 'error'

export interface ListingSnapshot {
  container: string
  prefix: string
  items: StorageBlobItem[]
  phase: ListingPhase
  pages: number
  /** Message for phase 'error'. */
  error?: string
}

export type FetchPage = (continuationToken: string | undefined) => Promise<ListBlobsResult>

export interface ListingPagerOptions {
  cap?: number
  /** Called with every new snapshot (first page, each later page, phase changes). */
  onChange: (snap: ListingSnapshot) => void
  /** First-page failure: nothing listed, caller shows its error view. */
  onFirstError: (err: unknown) => void
}

/** True when the listing isn't the whole folder (yet). */
export function isPartial(phase: ListingPhase | undefined): boolean {
  return phase === 'first' || phase === 'more' || phase === 'cap' || phase === 'stopped' || phase === 'error'
}

/** Rows share a key (`name`, plus a trailing slash for folders); a folder can
 *  show up as both a prefix and a zero-byte marker blob, possibly in
 *  different pages, so later duplicates are dropped. */
function rowKey(item: StorageBlobItem): string {
  return item.isPrefix ? `${item.name}/` : item.name
}

export class ListingPager {
  private items: StorageBlobItem[] = []
  private seen = new Set<string>()
  private token: string | undefined
  private container = ''
  private prefix = ''
  private pages = 0
  private phase: ListingPhase = 'first'
  private error: string | undefined
  private running = false
  private disposed = false
  private stopRequested = false
  private limit: number
  private readonly cap: number

  constructor(
    private readonly fetchPage: FetchPage,
    private readonly opts: ListingPagerOptions
  ) {
    this.cap = Math.max(1, opts.cap ?? LISTING_AUTO_CAP)
    this.limit = this.cap
  }

  snapshot(): ListingSnapshot {
    return {
      container: this.container,
      prefix: this.prefix,
      items: this.items,
      phase: this.phase,
      pages: this.pages,
      error: this.error
    }
  }

  /** Load the first page, then keep paging until done/cap/stop. */
  start(): Promise<void> {
    return this.run()
  }

  /** Pause after the page in flight. Its rows still land. */
  stop(): void {
    if (this.phase === 'more') this.stopRequested = true
  }

  /** Resume a paused (cap/stopped/error) listing for another cap's worth. */
  loadMore(): Promise<void> {
    if (this.disposed || this.running) return Promise.resolve()
    if (this.phase !== 'cap' && this.phase !== 'stopped' && this.phase !== 'error') return Promise.resolve()
    this.limit = this.items.length + this.cap
    this.error = undefined
    this.setPhase('more')
    return this.run()
  }

  /** Forget this listing: in-flight pages are dropped, no more callbacks. */
  dispose(): void {
    this.disposed = true
  }

  private setPhase(phase: ListingPhase): void {
    this.phase = phase
    this.emit()
  }

  private emit(): void {
    if (!this.disposed) this.opts.onChange(this.snapshot())
  }

  private append(page: StorageBlobItem[]): void {
    // New array each page so React memo deps see the change.
    const next = this.items.slice()
    for (const item of page) {
      const k = rowKey(item)
      if (this.seen.has(k)) continue
      this.seen.add(k)
      next.push(item)
    }
    this.items = next
  }

  private async run(): Promise<void> {
    if (this.running) return
    this.running = true
    this.stopRequested = false
    try {
      for (;;) {
        const first = this.pages === 0
        let res: ListBlobsResult
        try {
          res = await this.fetchPage(this.token)
        } catch (err) {
          if (this.disposed) return
          if (first) {
            this.opts.onFirstError(err)
            return
          }
          this.error = err instanceof Error ? err.message : String(err)
          this.setPhase('error')
          return
        }
        if (this.disposed) return
        this.pages += 1
        this.container = res.container
        this.prefix = res.prefix
        this.token = res.continuationToken || undefined
        this.append(res.items)
        if (!this.token) this.phase = 'done'
        else if (this.stopRequested) this.phase = 'stopped'
        else if (this.items.length >= this.limit) this.phase = 'cap'
        else this.phase = 'more'
        this.emit()
        if (this.phase !== 'more') return
      }
    } finally {
      this.running = false
    }
  }
}
