import { useEffect, useMemo, useRef, useState } from 'react'
import type {
  AccountSummary,
  ListBlobsResult,
  StorageBlobItem,
  StorageContainer
} from '../../../shared/types'
import type { SelectionTarget } from '../App'
import { ConfirmDialog, PromptDialog } from './Dialogs'
import PreviewDialog from './Preview'
import { formatBytes } from '../../../shared/format'
import { parseStorageError, type ExplorerError } from './errors'
import ErrorCallout from './ErrorCallout'
import logoUrl from '../assets/logo.png'

type SortKey = 'name' | 'size' | 'modified'
type SortDir = 1 | -1

function sasWarning(expiry?: string | null): string | null {
  if (!expiry) return null
  const ms = Date.parse(expiry)
  if (Number.isNaN(ms)) return null
  if (ms <= Date.now()) return `SAS expired ${new Date(ms).toLocaleDateString()}`
  const days = Math.ceil((ms - Date.now()) / 86_400_000)
  return days <= 14 ? `SAS expires in ${days}d` : null
}

function keyOf(item: StorageBlobItem): string {
  return item.isPrefix ? `${item.name}/` : item.name
}

interface PreviewTab {
  key: string
  container: string
  name: string
  size?: number
}

interface CtxMenu {
  x: number
  y: number
  /** Selection keys the menu acts on (empty = background). */
  keys: string[]
}

export default function Explorer(props: {
  account: AccountSummary | null
  target: SelectionTarget | null
  onOpenContainer: (container: string) => void
  onContainerChange?: (container: string | null) => void
  onChanged: () => void
  onContainersChanged: (accountId: string) => void
  onNewConnection?: () => void
}): React.JSX.Element {
  const { account } = props
  const [containers, setContainers] = useState<StorageContainer[]>([])
  // Container-scoped attachments open straight into their container —
  // no intermediate container-directory level.
  const [container, setContainer] = useState<string | null>(() => account?.containerName ?? null)
  const [blobs, setBlobs] = useState<ListBlobsResult | null>(null)
  const [navPrefix, setNavPrefix] = useState('')
  const [backHist, setBackHist] = useState<string[]>([])
  const [fwdHist, setFwdHist] = useState<string[]>([])
  const [selection, setSelection] = useState<Set<string>>(new Set())
  const [filter, setFilter] = useState('')
  const [loadingList, setLoadingList] = useState(false)
  const [loadingContainers, setLoadingContainers] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<ExplorerError | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [sortKey, setSortKey] = useState<SortKey>('name')
  const [sortDir, setSortDir] = useState<SortDir>(1)
  const [copiedEndpoint, setCopiedEndpoint] = useState(false)
  const [colWidths, setColWidths] = useState<{ size: number; modified: number }>(() => {
    try {
      const raw = localStorage.getItem('blobfish.colWidths')
      if (raw) {
        const parsed = JSON.parse(raw) as { size?: number; modified?: number }
        const size = Math.min(320, Math.max(70, Number(parsed.size) || 110))
        const modified = Math.min(480, Math.max(130, Number(parsed.modified) || 230))
        return { size, modified }
      }
    } catch {
      // Fall through to defaults.
    }
    return { size: 110, modified: 230 }
  })

  useEffect(() => {
    try {
      localStorage.setItem('blobfish.colWidths', JSON.stringify(colWidths))
    } catch {
      // Storage full/blocked — widths just won't persist.
    }
  }, [colWidths])

  function startColResize(e: React.MouseEvent, key: 'size' | 'modified'): void {
    e.preventDefault()
    e.stopPropagation()
    const startX = e.clientX
    const startW = colWidths[key]
    const onMove = (ev: MouseEvent): void => {
      const dx = ev.clientX - startX
      const limits = key === 'size' ? { min: 70, max: 320 } : { min: 130, max: 480 }
      const next = Math.min(limits.max, Math.max(limits.min, startW + dx))
      setColWidths((prev) => ({ ...prev, [key]: next }))
    }
    const onUp = (): void => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  function resetColWidths(): void {
    setColWidths({ size: 110, modified: 230 })
  }

  const navPrefixRef = useRef(navPrefix)
  navPrefixRef.current = navPrefix
  const containerRef = useRef(container)
  containerRef.current = container
  // Monotonic request ids — stale listings (e.g. a slow 403 for container A
  // resolving after the user picked container B) never overwrite fresh state.
  // Container and blob listings track independently so one selection resolving
  // can't invalidate the other.
  const containerSeq = useRef(0)
  const blobSeq = useRef(0)
  const selectionRef = useRef(selection)
  selectionRef.current = selection
  const filterRef = useRef<HTMLInputElement>(null)

  // ⌘F / Ctrl+F focuses the single search box. Escape closes the context menu.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'f') {
        e.preventDefault()
        filterRef.current?.focus()
        filterRef.current?.select()
      } else if (e.key === 'Escape') {
        setCtx(null)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  function switchContainer(next: string | null): void {
    setContainer(next)
    containerRef.current = next
    setActiveTab(null)
    setCtx(null)
    props.onContainerChange?.(next)
  }

  interface ConfirmState {
    title: string
    body?: string
    items?: string[]
    requireText?: string
    confirmLabel: string
    run: () => Promise<void>
  }

  interface PromptState {
    title: string
    label: string
    initial?: string
    placeholder?: string
    hint?: string
    confirmLabel: string
    validate?: (v: string) => string | null
    submit: (v: string) => Promise<void>
  }

  const [confirm, setConfirm] = useState<ConfirmState | null>(null)
  const [prompt, setPrompt] = useState<PromptState | null>(null)
  // Tabbed previews (ASE-style): browse tab + one tab per open file.
  const [previewTabs, setPreviewTabs] = useState<PreviewTab[]>([])
  const [activeTab, setActiveTab] = useState<string | null>(null)
  const [ctx, setCtx] = useState<CtxMenu | null>(null)
  const lastSelectedRef = useRef<string | null>(null)

  const accountId = account?.id

  function flash(message: string): void {
    setNotice(message)
    window.setTimeout(() => setNotice((n) => (n === message ? null : n)), 3200)
  }

  function fail(err: unknown, context: 'containers' | 'blobs' | 'action' = 'action'): void {
    // Inline banner + activity dock carry the error — no extra toast needed.
    // Coalesce repeated auth failures (sidebar prefetch + container listing +
    // blob listing all 403 off VPN): first one wins until the selection
    // changes, so one outage reads as one error, not three.
    const next = parseStorageError(err, context)
    setError((prev) => {
      if (prev && prev.kind === 'auth' && next.kind === 'auth') return prev
      return next
    })
  }

  function resetNav(): void {
    setNavPrefix('')
    navPrefixRef.current = ''
    setBackHist([])
    setFwdHist([])
    setSelection(new Set())
  }

  const loadContainers = (id: string, highlight?: string | null) => {
    const seq = ++containerSeq.current
    setLoadingContainers(true)
    setError(null)
    window.api.storage
      .listContainers(id)
      .then((cs) => {
        if (seq !== containerSeq.current) return
        setContainers(cs)
        setError(null)
        setContainer((prev) => {
          let chosen: string | null = null
          if (highlight && cs.some((c) => c.name === highlight)) chosen = highlight
          else if (prev && cs.some((c) => c.name === prev)) chosen = prev
          else if (cs.length === 1) chosen = cs[0]?.name ?? null
          containerRef.current = chosen
          props.onContainerChange?.(chosen)
          return chosen
        })
        // Empty list is a valid state — rendered as an empty table, not an error.
      })
      .catch((err: unknown) => {
        if (seq !== containerSeq.current) return
        fail(err, 'containers')
      })
      .finally(() => {
        if (seq !== containerSeq.current) return
        setLoadingContainers(false)
      })
  }

  // Initial load per account.
  useEffect(() => {
    containerSeq.current += 1
    blobSeq.current += 1
    setContainers([])
    const initial = account?.containerName ?? null
    setContainer(initial)
    containerRef.current = initial
    props.onContainerChange?.(initial)
    setBlobs(null)
    setFilter('')
    setError(null)
    setPreviewTabs([])
    setActiveTab(null)
    setCtx(null)
    resetNav()
    if (!accountId) return
    loadContainers(accountId, account?.containerName ?? props.target?.container ?? undefined)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountId])

  // Sidebar picks (account or container rows, or post-wizard selection).
  useEffect(() => {
    if (props.target) {
      switchContainer(props.target.container)
      resetNav()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.target?.tick])

  // Refresh the listing when one of our queued uploads finishes.
  // Note: downloads never alter Azure containers, so only uploads reload blobs.
  const seenDone = useRef<Set<string>>(new Set())
  useEffect(() => {
    const off = window.api.transfers.onUpdate((snap) => {
      let reloadNeeded = false
      for (const t of snap.transfers) {
        if (t.status !== 'completed' || seenDone.current.has(t.id)) continue
        seenDone.current.add(t.id)
        if (t.direction === 'upload' && t.accountId === accountId && t.container === containerRef.current) {
          reloadNeeded = true
        }
      }
      if (reloadNeeded) reloadBlobs()
    })
    return off
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountId])

  // Blob listing.
  useEffect(() => {
    if (!accountId || !container) return
    const seq = ++blobSeq.current
    let cancelled = false
    setLoadingList(true)
    // A fresh selection clears a previous account's auth error; repeat
    // failures for the same selection coalesce in fail().
    setError(null)
    window.api.storage
      .listBlobs({ accountId, container, prefix: navPrefix || undefined })
      .then((res) => {
        if (!cancelled && seq === blobSeq.current) {
          setBlobs(res)
          setSelection(new Set())
        }
      })
      .catch((err: unknown) => {
        if (!cancelled && seq === blobSeq.current) {
          fail(err, 'blobs')
          setBlobs(null)
        }
      })
      .finally(() => {
        if (!cancelled && seq === blobSeq.current) setLoadingList(false)
      })
    return () => {
      cancelled = true
    }
  }, [accountId, container, navPrefix])

  function reloadBlobs(): void {
    const curContainer = containerRef.current
    if (!accountId || !curContainer) return
    const seq = ++blobSeq.current
    const curPrefix = navPrefixRef.current
    setLoadingList(true)
    setError(null)
    window.api.storage
      .listBlobs({ accountId, container: curContainer, prefix: curPrefix || undefined })
      .then((res) => {
        if (seq !== blobSeq.current) return
        setBlobs(res)
        setError(null)
        setSelection(new Set())
      })
      .catch((err: unknown) => {
        if (seq === blobSeq.current) fail(err, 'blobs')
      })
      .finally(() => {
        if (seq === blobSeq.current) setLoadingList(false)
      })
  }

  /* ---------- prefix history ---------- */

  function go(next: string): void {
    setBackHist((h) => [...h, navPrefix])
    setFwdHist([])
    setNavPrefix(next)
    navPrefixRef.current = next
    setSelection(new Set())
  }

  function goBack(): void {
    if (backHist.length === 0) return
    const prev = backHist[backHist.length - 1]!
    setBackHist((h) => h.slice(0, -1))
    setFwdHist((h) => [navPrefix, ...h])
    setNavPrefix(prev)
    navPrefixRef.current = prev
    setSelection(new Set())
  }

  function goForward(): void {
    if (fwdHist.length === 0) return
    const [next, ...rest] = fwdHist
    setFwdHist(rest)
    setBackHist((h) => [...h, navPrefix])
    setNavPrefix(next!)
    navPrefixRef.current = next!
    setSelection(new Set())
  }

  function goUp(): void {
    const segs = navPrefix.split('/').filter(Boolean)
    if (segs.length === 0) {
      // Scoped attachments are rooted at their container — nowhere above to go.
      if (scoped) return
      // At container root → up means back to the container directory.
      switchContainer(null)
      resetNav()
      return
    }
    go(segs.slice(0, -1).join('/'))
  }

  /* ---------- derived ---------- */

  const scoped = Boolean(account?.containerName)
  const warn = sasWarning(account?.sasExpiry)

  const visibleBlobs = useMemo(() => {
    const items = blobs?.items ?? []
    const q = filter.trim().toLowerCase()
    const filtered = q === '' ? items : items.filter((i) => i.leaf.toLowerCase().includes(q))
    const sorted = [...filtered]
    sorted.sort((a, b) => {
      if (a.isPrefix !== b.isPrefix) return a.isPrefix ? -1 : 1
      let cmp = 0
      if (sortKey === 'name') cmp = a.leaf.localeCompare(b.leaf)
      else if (sortKey === 'size') cmp = (a.size ?? -1) - (b.size ?? -1)
      else cmp = (a.lastModified ?? '').localeCompare(b.lastModified ?? '')
      return cmp * sortDir
    })
    return sorted
  }, [blobs, filter, sortKey, sortDir])

  const visibleContainers = useMemo(() => {
    const q = filter.trim().toLowerCase()
    const filtered =
      q === '' ? containers : containers.filter((c) => c.name.toLowerCase().includes(q))
    const sorted = [...filtered]
    sorted.sort((a, b) =>
      sortKey === 'modified'
        ? (a.lastModified ?? '').localeCompare(b.lastModified ?? '') * sortDir
        : a.name.localeCompare(b.name) * sortDir
    )
    return sorted
  }, [containers, filter, sortKey, sortDir])

  const crumbs = useMemo(
    () => (navPrefix === '' ? [] : navPrefix.split('/').filter(Boolean)),
    [navPrefix]
  )

  function toggleSort(key: SortKey): void {
    if (key === sortKey) setSortDir((d) => (d === 1 ? -1 : 1))
    else {
      setSortKey(key)
      setSortDir(1)
    }
  }

  function toggleOne(key: string): void {
    setSelection((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  function toggleAll(keys: string[]): void {
    setSelection((prev) => (prev.size === keys.length && keys.length > 0 ? new Set() : new Set(keys)))
  }

  /* ---------- tabbed previews ---------- */

  function openPreviewTab(name: string, size?: number, containerOverride?: string): void {
    const cont = (containerOverride ?? containerRef.current ?? '').trim()
    if (cont === '') return
    const key = `${cont}/${name}`
    setPreviewTabs((prev) => (prev.some((t) => t.key === key) ? prev : [...prev, { key, container: cont, name, size }]))
    setActiveTab(key)
    setCtx(null)
  }

  function closePreviewTab(key: string): void {
    setPreviewTabs((prev) => prev.filter((t) => t.key !== key))
    setActiveTab((cur) => (cur === key ? null : cur))
  }

  function dropTabsForNames(containerName: string, names: string[]): void {
    const gone = new Set(names)
    setPreviewTabs((prev) => prev.filter((t) => !(t.container === containerName && gone.has(t.name))))
    setActiveTab((cur) => {
      if (cur === null) return cur
      const tab = previewTabs.find((t) => t.key === cur)
      if (tab && tab.container === containerName && gone.has(tab.name)) return null
      return cur
    })
  }

  /* ---------- click-to-select + context menu ---------- */

  /** Single click selects; ⌘/Ctrl toggles; Shift extends a range. Double-click opens. */
  function selectRow(e: React.MouseEvent, key: string, orderedKeys: string[]): void {
    if (e.shiftKey && lastSelectedRef.current) {
      const anchor = orderedKeys.indexOf(lastSelectedRef.current)
      const at = orderedKeys.indexOf(key)
      if (anchor !== -1 && at !== -1) {
        const [lo, hi] = anchor < at ? [anchor, at] : [at, anchor]
        setSelection(new Set(orderedKeys.slice(lo, hi + 1)))
        return
      }
    }
    if (e.metaKey || e.ctrlKey) {
      toggleOne(key)
      lastSelectedRef.current = key
      return
    }
    setSelection(new Set([key]))
    lastSelectedRef.current = key
  }

  function openRow(item: StorageBlobItem): void {
    if (item.isPrefix) {
      go(blobs && blobs.prefix ? `${blobs.prefix}/${item.leaf}` : item.name)
    } else {
      openPreviewTab(item.name, item.size)
    }
  }

  function openCtx(e: React.MouseEvent, key: string | null, orderedKeys: string[]): void {
    e.preventDefault()
    e.stopPropagation()
    if (key === null) {
      setCtx({ x: e.clientX, y: e.clientY, keys: [] })
      return
    }
    const cur = selectionRef.current
    const keys = cur.has(key) && cur.size > 0 ? [...cur] : [key]
    if (!cur.has(key)) {
      lastSelectedRef.current = key
      const next = new Set([key])
      selectionRef.current = next
      setSelection(next)
    }
    setCtx({ x: e.clientX, y: e.clientY, keys })
  }

  function copyPaths(keys: string[]): void {
    const text = keys.map((k) => k.replace(/\/$/, '')).join('\n')
    void navigator.clipboard
      ?.writeText(text)
      .then(() => flash(keys.length === 1 ? 'Path copied' : `${keys.length} paths copied`))
      .catch(() => undefined)
    setCtx(null)
  }

  /* ---------- CRUD ---------- */

  async function run(label: string, fn: () => Promise<string | void>): Promise<void> {
    setBusy(label)
    setError(null)
    try {
      const msg = await fn()
      if (msg) flash(msg)
      reloadBlobs()
    } catch (err) {
      fail(err, 'action')
    } finally {
      setBusy(null)
    }
  }

  function onNewContainer(): void {
    if (!accountId) return
    setPrompt({
      title: 'New container',
      label: 'Container name',
      placeholder: 'mycontainer',
      hint: 'Lowercase letters, numbers and dashes · 3–63 chars.',
      confirmLabel: 'Create',
      validate: (v) =>
        /^[a-z0-9]([a-z0-9-]{1,61}[a-z0-9])?$/.test(v)
          ? null
          : 'Use 3–63 lowercase letters, numbers and dashes.',
      submit: async (v) => {
        setBusy('container')
        try {
          await window.api.storage.createContainer({ accountId, container: v })
          flash(`Container "${v}" created`)
          loadContainers(accountId, v)
          props.onContainersChanged(accountId)
        } catch (err) {
          fail(err, 'action')
          throw err
        } finally {
          setBusy(null)
        }
      }
    })
  }

  function onDeleteContainer(name: string): void {
    if (!accountId) return
    setConfirm({
      title: `Delete container "${name}"?`,
      body: 'Everything inside is permanently deleted. This cannot be undone.',
      requireText: name,
      confirmLabel: 'Delete',
      run: async () => {
        setBusy('container')
        try {
          await window.api.storage.deleteContainer({ accountId, container: name })
          flash(`Container "${name}" deleted`)
          if (container === name) {
            switchContainer(null)
            setBlobs(null)
            resetNav()
          }
          loadContainers(accountId)
          props.onContainersChanged(accountId)
        } catch (err) {
          fail(err, 'action')
          throw err
        } finally {
          setBusy(null)
        }
      }
    })
  }

  function onNewFolder(): void {
    if (!accountId || !container) return
    setPrompt({
      title: 'New folder',
      label: 'Folder name',
      placeholder: 'reports',
      hint: 'A single folder level — slashes are not allowed.',
      confirmLabel: 'Create',
      validate: (v) =>
        v === '' || v.includes('/') ? 'Use a single folder name without slashes.' : null,
      submit: async (v) => {
        await run('folder', async () => {
          await window.api.storage.createFolder({
            accountId,
            container,
            prefix: blobs?.prefix || undefined,
            folderName: v
          })
          return `Folder "${v}" created`
        })
      }
    })
  }

  function onUpload(): void {
    if (!accountId || !container) return
    setBusy('upload')
    setError(null)
    window.api.transfers
      .upload({ accountId, container, prefix: blobs?.prefix || undefined })
      .catch((err: unknown) => fail(err, 'action'))
      .finally(() => setBusy(null))
  }

  function onDownload(): void {
    if (!accountId || !container || selection.size === 0) return
    setBusy('download')
    setError(null)
    window.api.transfers
      .download({ accountId, container, names: [...selection] })
      .catch((err: unknown) => fail(err, 'action'))
      .finally(() => setBusy(null))
  }

  function onPreviewDownload(containerName: string, name: string): void {
    if (!accountId || !containerName) return
    setBusy('download')
    setError(null)
    window.api.transfers
      .download({ accountId, container: containerName, names: [name] })
      .catch((err: unknown) => fail(err, 'action'))
      .finally(() => setBusy(null))
  }

  function onDelete(): void {
    if (!accountId || !container || selection.size === 0) return
    const n = selection.size
    setConfirm({
      title: `Delete ${n} item${n === 1 ? '' : 's'}?`,
      body: 'Blobs are permanently deleted. Folders delete everything beneath them.',
      items: [...selection],
      confirmLabel: 'Delete',
      run: async () => {
        await run('delete', async () => {
          const count = await window.api.storage.deleteBlobs({
            accountId,
            container,
            names: [...selection]
          })
          dropTabsForNames(container, [...selection])
          return `Deleted ${count} item${count === 1 ? '' : 's'}`
        })
      }
    })
  }

  function onRename(): void {
    if (!accountId || !container) return
    const picked = [...selection].filter((k) => !k.endsWith('/'))
    if (picked.length !== 1) return
    const src = picked[0]!
    const currentLeaf = src.includes('/') ? src.slice(src.lastIndexOf('/') + 1) : src
    setPrompt({
      title: 'Rename file',
      label: 'New file name',
      initial: currentLeaf,
      confirmLabel: 'Rename',
      validate: (v) =>
        v === '' || v.includes('/') ? 'Use a file name without slashes.' : null,
      submit: async (v) => {
        if (v === currentLeaf) return
        await run('rename', async () => {
          // Main returns the full destination blob path.
          const destFull = await window.api.storage.renameBlob({
            accountId,
            container,
            source: src,
            destLeaf: v
          })
          setPreviewTabs((prev) =>
            prev.map((t) =>
              t.container === container && t.name === src
                ? { ...t, name: destFull, key: `${container}/${destFull}` }
                : t
            )
          )
          setActiveTab((cur) =>
            cur === `${container}/${src}` ? `${container}/${destFull}` : cur
          )
          return `Renamed to "${v}"`
        })
      }
    })
  }

  /* ---------- render ---------- */

  if (!account) {
    return (
      <section className="card empty-hero fade-in">
        <div className="hero-logo-frame">
          <img src={logoUrl} alt="Blobfish" className="hero-logo-img" />
        </div>
        <h2>Welcome to Blobfish</h2>
        <p className="hero-sub">Fast & elegant Azure Blob Storage explorer</p>
        <p className="muted small">
          Connect a storage account using a Connection String, SAS URL, or Account Key.
          All credentials remain securely encrypted in your OS Keychain.
        </p>
        {props.onNewConnection && (
          <button className="btn mint hero-cta" onClick={props.onNewConnection}>
            + Connect Storage Account
          </button>
        )}
      </section>
    )
  }

  const selectedFiles = [...selection].filter((k) => !k.endsWith('/'))
  const canRename = selectedFiles.length === 1 && selection.size === 1
  // Exactly one file selected → eligible for in-app preview.
  const previewFile =
    selection.size === 1 && selectedFiles.length === 1
      ? (visibleBlobs.find((b) => !b.isPrefix && keyOf(b) === selectedFiles[0]) ?? null)
      : null

  const displayAccount = account.containerName ?? account.accountName ?? account.name
  let endpointHost = account.endpoint
  try {
    endpointHost = new URL(account.endpoint).host
  } catch {
    // Keep the raw endpoint when it is not a valid URL.
  }

  function copyEndpoint(): void {
    const endpoint = account?.endpoint
    if (!endpoint) return
    void navigator.clipboard
      ?.writeText(endpoint)
      .then(() => {
        setCopiedEndpoint(true)
        window.setTimeout(() => setCopiedEndpoint(false), 1400)
      })
      .catch(() => undefined)
  }

  function retryCurrent(): void {
    if (!accountId) return
    if (!containerRef.current) loadContainers(accountId)
    else reloadBlobs()
  }

  const errorCallout = error ? (
    <ErrorCallout error={error} onRetry={retryCurrent} onDismiss={() => setError(null)} />
  ) : null

  const activePreview = activeTab !== null ? (previewTabs.find((t) => t.key === activeTab) ?? null) : null

  const tabStrip = container ? (
    <div className="tab-strip" role="tablist" aria-label="Open tabs">
      <button
        className={`tab${activePreview === null ? ' active' : ''}`}
        role="tab"
        aria-selected={activePreview === null}
        onClick={() => {
          setActiveTab(null)
          setCtx(null)
        }}
        title={container}
      >
        <span className="kind-ico container tab-ico" aria-hidden />
        <span className="tab-label">{container}</span>
      </button>
      {previewTabs.map((t) => {
        const leaf = t.name.includes('/') ? t.name.slice(t.name.lastIndexOf('/') + 1) : t.name
        const isActive = activeTab === t.key
        return (
          <button
            key={t.key}
            className={`tab preview-tab${isActive ? ' active' : ''}`}
            role="tab"
            aria-selected={isActive}
            onClick={() => {
              setActiveTab(t.key)
              setCtx(null)
            }}
            title={t.name}
          >
            <span className="file-ico file tab-ico" aria-hidden />
            <span className="tab-label">{leaf}</span>
            <span
              className="tab-close"
              role="button"
              aria-label={`Close preview ${leaf}`}
              onClick={(e) => {
                e.stopPropagation()
                closePreviewTab(t.key)
              }}
            >
              ✕
            </span>
          </button>
        )
      })}
    </div>
  ) : null

  const ctxMenu = ctx ? (
    <>
      <div className="ctx-overlay" onClick={() => setCtx(null)} onContextMenu={() => setCtx(null)} />
      <div
        className="ctx-menu glass strong"
        role="menu"
        style={{
          left: `${Math.min(ctx.x, window.innerWidth - 220)}px`,
          top: `${Math.min(ctx.y, window.innerHeight - 260)}px`
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {ctx.keys.length === 0 ? (
          <>
            <button role="menuitem" onClick={() => { setCtx(null); onUpload() }}>Upload files…</button>
            <button role="menuitem" onClick={() => { setCtx(null); onNewFolder() }}>New folder…</button>
            <button role="menuitem" onClick={() => { setCtx(null); toggleAll(visibleBlobs.map(keyOf)) }}>Select all</button>
            <div className="ctx-sep" aria-hidden />
            <button role="menuitem" onClick={() => { setCtx(null); retryCurrent() }}>Refresh</button>
          </>
        ) : (
          <>
            {ctx.keys.length === 1 && !ctx.keys[0]!.endsWith('/') && (
              <button
                role="menuitem"
                onClick={() => {
                  const item = visibleBlobs.find((b) => keyOf(b) === ctx.keys[0])
                  setCtx(null)
                  if (item && !item.isPrefix) openPreviewTab(item.name, item.size)
                }}
              >
                Preview
              </button>
            )}
            <button role="menuitem" onClick={() => { setCtx(null); onDownload() }}>
              Download{ctx.keys.length > 1 ? ` (${ctx.keys.length})` : ''}
            </button>
            <button role="menuitem" onClick={() => copyPaths(ctx.keys)}>Copy path</button>
            {ctx.keys.length === 1 && !ctx.keys[0]!.endsWith('/') && (
              <button role="menuitem" onClick={() => { setCtx(null); onRename() }}>Rename…</button>
            )}
            <div className="ctx-sep" aria-hidden />
            <button role="menuitem" className="danger" onClick={() => { setCtx(null); onDelete() }}>
              Delete{ctx.keys.length > 1 ? ` (${ctx.keys.length})` : ''}
            </button>
          </>
        )}
      </div>
    </>
  ) : null

  const toolbarFilter = (
    <label className="toolbar-filter" title="Search (⌘F)">
      <span aria-hidden>⌕</span>
      <input
        ref={filterRef}
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        placeholder="Search…"
        aria-label="Search current view"
      />
      {filter && (
        <button className="mini-btn" onClick={() => setFilter('')} aria-label="Clear search">
          ✕
        </button>
      )}
    </label>
  )

  const historyButtons = (
    <div className="nav-btns">
      <button className="nav-btn" onClick={goBack} disabled={backHist.length === 0} title="Back" aria-label="Back">←</button>
      <button className="nav-btn" onClick={goForward} disabled={fwdHist.length === 0} title="Forward" aria-label="Forward">→</button>
      <button className="nav-btn" onClick={goUp} disabled={navPrefix === '' && (scoped || !container)} title="Up one level" aria-label="Up">↑</button>
      <button
        className="nav-btn"
        onClick={retryCurrent}
        disabled={!accountId || loadingContainers || loadingList}
        title="Refresh"
        aria-label="Refresh"
      >
        ↻
      </button>
    </div>
  )

  const actionBar = (
    <div className="actionbar" role="toolbar" aria-label="Blob actions">
      <Action icon="↑" label="Upload" primary onClick={onUpload} disabled={!container || busy !== null} working={busy === 'upload'} workingLabel="Uploading…" />
      <Action icon="↓" label={`Download${selection.size > 0 ? ` (${selection.size})` : ''}`} onClick={onDownload} disabled={selection.size === 0 || busy !== null} />
      <Action icon="+" label="New folder" onClick={onNewFolder} disabled={!container || busy !== null} />
      <Action icon="☑" label="Select all" onClick={() => toggleAll(visibleBlobs.map(keyOf))} disabled={visibleBlobs.length === 0} />
      <span className="action-sep" aria-hidden />
      <Action icon="👁" label="Preview" onClick={() => previewFile && openPreviewTab(previewFile.name, previewFile.size)} disabled={!previewFile || busy !== null} />
      <Action icon="✎" label="Rename" onClick={onRename} disabled={!canRename || busy !== null} />
      <Action icon="✕" label={`Delete${selection.size > 0 ? ` (${selection.size})` : ''}`} danger onClick={onDelete} disabled={selection.size === 0 || busy !== null} />
    </div>
  )

  const addressStrip = (
    <nav className="address-strip" aria-label="Path">
      {scoped ? (
        <button
          className="crumb addr-acct"
          onClick={() => go('')}
          title={`${account.name}\n${account.endpoint}`}
        >
          {container ?? displayAccount}
        </button>
      ) : (
        <>
          <button
            className="crumb addr-acct"
            onClick={() => { switchContainer(null); resetNav() }}
            title={`${account.name}\n${account.endpoint}`}
          >
            {displayAccount}
          </button>
          {container && (
            <>
              <span className="sep">/</span>
              <button className="crumb root" onClick={() => go('')}>
                {container}
              </button>
            </>
          )}
        </>
      )}
      {crumbs.map((seg, i) => (
        <span key={i} className="crumb-seg">
          <span className="sep">/</span>
          <button className="crumb" onClick={() => go(crumbs.slice(0, i + 1).join('/'))}>
            {seg}
          </button>
        </span>
      ))}
      {navPrefix === '' && !container && (
        <span className="muted small address-hint">{containers.length > 0 ? `${containers.length} containers` : ''}</span>
      )}
    </nav>
  )

  // ----- account level: container directory -----
  if (!container) {
    const showEmpty = !loadingContainers && !error && visibleContainers.length === 0
    return (
      <div className="explorer explorer-panel fade-in">
        <header className="explorer-toolbar">
          <div className="toolbar-left">
            {historyButtons}
            <span className="toolbar-div" aria-hidden />
            <div className="toolbar-crumb">
              <span className="eyebrow">Storage account</span>
              <div className="toolbar-title-row">
                <strong className="toolbar-title" title={account.name}>{account.name}</strong>
                <button
                  className="endpoint-badge"
                  onClick={copyEndpoint}
                  title={`${account.endpoint} — click to copy`}
                >
                  <span className="endpoint-host">{endpointHost}</span>
                  <span className="endpoint-copy">{copiedEndpoint ? '✓' : '⧉'}</span>
                </button>
                {warn && <span className="pill warn">{warn}</span>}
              </div>
            </div>
          </div>
          <div className="toolbar-right">
            {toolbarFilter}
            {!scoped && (
              <button className="btn mint small toolbar-primary" disabled={busy !== null} onClick={onNewContainer}>
                + New container
              </button>
            )}
          </div>
        </header>

        <div className="explorer-body-scroll">
          {(container || crumbs.length > 0) && addressStrip}
          {errorCallout}
          {loadingContainers ? (
            <ul className="skeleton">
              {Array.from({ length: 8 }, (_, i) => (
                <li key={i} style={{ animationDelay: `${i * 40}ms` }} />
              ))}
            </ul>
          ) : showEmpty ? (
            <div className="empty-state">
              <div className="empty-state-icon" aria-hidden>▦</div>
              <p className="empty-state-title">
                {filter ? `No containers matching "${filter}"` : 'No containers yet'}
              </p>
              <p className="muted small empty-state-sub">
                {filter
                  ? 'Try a different filter, or clear it to see everything.'
                  : 'Containers organize your blobs. Create your first container to get started.'}
              </p>
              <div className="row empty-state-cta">
                {filter ? (
                  <button className="btn ghost small" onClick={() => setFilter('')}>
                    Clear filter
                  </button>
                ) : (
                  !scoped && (
                    <button className="btn mint small" onClick={onNewContainer}>
                      + New container
                    </button>
                  )
                )}
              </div>
            </div>
          ) : (
            <table className="blob-table dir-table table-in" style={{ tableLayout: 'fixed' }}>
              <thead>
                <tr>
                  <Th label="Name" k="name" sortKey={sortKey} dir={sortDir} onSort={toggleSort} wide />
                  <Th
                    label="Last Modified"
                    k="modified"
                    sortKey={sortKey}
                    dir={sortDir}
                    onSort={toggleSort}
                    width={colWidths.modified}
                    resizeKey="modified"
                    onResizeStart={startColResize}
                    onResetWidths={resetColWidths}
                  />
                  {!scoped && <th><span className="sr">Actions</span></th>}
                </tr>
              </thead>
              <tbody>
                {error && visibleContainers.length === 0 ? (
                  <tr>
                    <td colSpan={scoped ? 2 : 3} className="muted table-unavailable">
                      Container listing unavailable — fix the error above, then retry.
                    </td>
                  </tr>
                ) : (
                  visibleContainers.map((c, i) => (
                    <tr
                      key={c.name}
                      className="row-in clickable"
                      style={{ animationDelay: `${Math.min(i, 10) * 12}ms` }}
                      onClick={() => {
                        switchContainer(c.name)
                        resetNav()
                        props.onOpenContainer(c.name)
                      }}
                    >
                      <td className="name-col">
                        <span className="file-row">
                          <span className="file-ico container-lg" aria-hidden />
                          {c.name}
                        </span>
                      </td>
                      <td className="muted">
                        {c.lastModified ? new Date(c.lastModified).toLocaleString() : '—'}
                      </td>
                      {!scoped && (
                        <td className="row-act" onClick={(e) => e.stopPropagation()}>
                          <button
                            className="mini-btn danger-x"
                            title={`Delete container "${c.name}"`}
                            onClick={() => onDeleteContainer(c.name)}
                          >
                            ✕
                          </button>
                        </td>
                      )}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          )}
        </div>
        {confirm && (
        <ConfirmDialog
          title={confirm.title}
          body={confirm.body}
          items={confirm.items}
          requireText={confirm.requireText}
          confirmLabel={confirm.confirmLabel}
          onCancel={() => setConfirm(null)}
          onConfirm={confirm.run}
        />
      )}
      {prompt && (
        <PromptDialog
          title={prompt.title}
          label={prompt.label}
          initial={prompt.initial}
          placeholder={prompt.placeholder}
          hint={prompt.hint}
          confirmLabel={prompt.confirmLabel}
          validate={prompt.validate}
          onCancel={() => setPrompt(null)}
          onSubmit={prompt.submit}
        />
      )}
      {notice && <div className="toast glass strong toast-in">{notice}</div>}
      </div>
    )
  }

  // ----- container level: blob browser -----
  const showBlobEmpty = !loadingList && !error && visibleBlobs.length === 0
  return (
    <div className="explorer explorer-panel fade-in">
      <header className="explorer-toolbar">
        <div className="toolbar-left">
          {historyButtons}
          <span className="toolbar-div" aria-hidden />
          <div className="toolbar-crumb">
            <span className="eyebrow">Blob container</span>
            <div className="toolbar-title-row">
              <strong className="toolbar-title" title={container ?? ''}>{container}</strong>
              <span className="endpoint-badge static" title={account.endpoint}>
                <span className="endpoint-host">{endpointHost}</span>
              </span>
              {warn && <span className="pill warn">{warn}</span>}
            </div>
          </div>
        </div>
        <div className="toolbar-right">
          {toolbarFilter}
          {!scoped && (
            <button
              className="btn ghost small"
              disabled={busy !== null}
              onClick={() => container && onDeleteContainer(container)}
              title="Delete this container and everything in it"
            >
              Delete container
            </button>
          )}
        </div>
      </header>

      {tabStrip}

      {activePreview && accountId ? (
        <div className="explorer-body-scroll preview-tab-body">
          <PreviewDialog
            key={activePreview.key}
            accountId={accountId}
            container={activePreview.container}
            name={activePreview.name}
            size={activePreview.size}
            inline
            onClose={() => closePreviewTab(activePreview.key)}
            onDownload={() => onPreviewDownload(activePreview.container, activePreview.name)}
          />
        </div>
      ) : (
      <>
      {actionBar}

      <div className="explorer-body-scroll" onContextMenu={(e) => openCtx(e, null, [])}>
        {addressStrip}
        {errorCallout}
        {loadingList ? (
          <ul className="skeleton">
            {Array.from({ length: 8 }, (_, i) => (
              <li key={i} style={{ animationDelay: `${i * 40}ms` }} />
            ))}
          </ul>
        ) : showBlobEmpty ? (
          <div className="empty-state">
            <div className="empty-state-icon" aria-hidden>◍</div>
            <p className="empty-state-title">
              {filter ? `Nothing matches "${filter}"` : 'This folder is empty'}
            </p>
            <p className="muted small empty-state-sub">
              {filter ? 'Try a different filter, or clear it to see everything.' : 'Upload files or create a folder to get started.'}
            </p>
            <div className="row empty-state-cta">
              {filter ? (
                <button className="btn ghost small" onClick={() => setFilter('')}>
                  Clear filter
                </button>
              ) : (
                <>
                  <button className="btn mint small" onClick={onUpload}>
                    Upload files
                  </button>
                  <button className="btn ghost small" onClick={onNewFolder}>
                    New folder
                  </button>
                </>
              )}
            </div>
          </div>
        ) : (
          <table className="blob-table table-in" style={{ tableLayout: 'fixed' }}>
            <thead>
              <tr>
                <th className="check-col">
                  <input
                    type="checkbox"
                    aria-label="Select all"
                    checked={selection.size > 0 && selection.size === visibleBlobs.length}
                    onChange={() => toggleAll(visibleBlobs.map(keyOf))}
                  />
                </th>
                <Th label="Name" k="name" sortKey={sortKey} dir={sortDir} onSort={toggleSort} wide />
                <Th
                  label="Size"
                  k="size"
                  sortKey={sortKey}
                  dir={sortDir}
                  onSort={toggleSort}
                  width={colWidths.size}
                  resizeKey="size"
                  onResizeStart={startColResize}
                  onResetWidths={resetColWidths}
                />
                <Th
                  label="Last Modified"
                  k="modified"
                  sortKey={sortKey}
                  dir={sortDir}
                  onSort={toggleSort}
                  width={colWidths.modified}
                  resizeKey="modified"
                  onResizeStart={startColResize}
                  onResetWidths={resetColWidths}
                />
              </tr>
            </thead>
            <tbody>
              {!error && (blobs?.prefix ?? navPrefix) !== '' && (
                <tr className="row-in parent-row clickable" onClick={goUp} title="Up to parent folder">
                  <td className="check-col" />
                  <td className="name-col">
                    <span className="file-row parent-link">
                      <span className="file-ico folder up" aria-hidden>↩</span>
                      <strong>..</strong>
                      <span className="muted small">Up to parent</span>
                    </span>
                  </td>
                  <td className="num muted">—</td>
                  <td className="muted">—</td>
                </tr>
              )}
              {error && visibleBlobs.length === 0 ? (
                <tr>
                  <td colSpan={4} className="muted table-unavailable">
                    Blob listing unavailable — fix the error above, then retry.
                  </td>
                </tr>
              ) : (
                visibleBlobs.map((item, i) => {
                  const key = keyOf(item)
                  const orderedKeys = visibleBlobs.map(keyOf)
                  return (
                    <tr
                      key={key}
                      className={`row-in clickable${selection.has(key) ? ' selected' : ''}`}
                      style={{ animationDelay: `${Math.min(i, 10) * 12}ms` }}
                      onClick={(e) => selectRow(e, key, orderedKeys)}
                      onDoubleClick={() => openRow(item)}
                      onContextMenu={(e) => openCtx(e, key, orderedKeys)}
                      title={item.isPrefix ? 'Open folder' : 'Double-click to preview · right-click for actions'}
                    >
                      <td className="check-col" onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          aria-label={`Select ${item.leaf}`}
                          checked={selection.has(key)}
                          onChange={() => toggleOne(key)}
                          onClick={(e) => e.stopPropagation()}
                        />
                      </td>
                      <td className="name-col">
                        <span className="file-row" title={item.name}>
                          <span className={`file-ico ${item.isPrefix ? 'folder' : 'file'}`} aria-hidden />
                          {item.leaf}
                        </span>
                      </td>
                      <td className="num">{item.isPrefix ? '—' : formatBytes(item.size)}</td>
                      <td className="muted">
                        {item.lastModified ? new Date(item.lastModified).toLocaleString() : '—'}
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        )}
      </div>
      </>
      )}

      {ctxMenu}
      {confirm && (
        <ConfirmDialog
          title={confirm.title}
          body={confirm.body}
          items={confirm.items}
          requireText={confirm.requireText}
          confirmLabel={confirm.confirmLabel}
          onCancel={() => setConfirm(null)}
          onConfirm={confirm.run}
        />
      )}
      {prompt && (
        <PromptDialog
          title={prompt.title}
          label={prompt.label}
          initial={prompt.initial}
          placeholder={prompt.placeholder}
          hint={prompt.hint}
          confirmLabel={prompt.confirmLabel}
          validate={prompt.validate}
          onCancel={() => setPrompt(null)}
          onSubmit={prompt.submit}
        />
      )}
      {notice && <div className="toast glass strong toast-in">{notice}</div>}
    </div>
  )
}

function Action(props: {
  icon: string
  label: string
  onClick: () => void
  disabled?: boolean
  primary?: boolean
  danger?: boolean
  working?: boolean
  workingLabel?: string
}): React.JSX.Element {
  return (
    <button
      className={`action${props.primary ? ' primary' : ''}${props.danger ? ' danger' : ''}`}
      onClick={props.onClick}
      disabled={props.disabled}
    >
      <span className="action-icon" aria-hidden>
        {props.icon}
      </span>
      {props.working ? (props.workingLabel ?? props.label) : props.label}
    </button>
  )
}

function Th(props: {
  label: string
  k: 'name' | 'size' | 'modified'
  sortKey: string
  dir: 1 | -1
  onSort: (k: 'name' | 'size' | 'modified') => void
  wide?: boolean
  width?: number
  resizeKey?: 'size' | 'modified'
  onResizeStart?: (e: React.MouseEvent, key: 'size' | 'modified') => void
  onResetWidths?: () => void
}): React.JSX.Element {
  const active = props.sortKey === props.k
  return (
    <th
      className={`${props.wide ? 'wide' : ''}${props.resizeKey ? ' resizable' : ''}`}
      style={props.width ? { width: `${props.width}px`, minWidth: `${props.width}px`, maxWidth: `${props.width}px` } : undefined}
    >
      <button className={`th-btn${active ? ' active' : ''}`} onClick={() => props.onSort(props.k)}>
        {props.label}
        <span className="sort-arrow">{active ? (props.dir === 1 ? ' ↑' : ' ↓') : ''}</span>
      </button>
      {props.resizeKey && props.onResizeStart && (
        <span
          className="col-resizer"
          onMouseDown={(e) => props.onResizeStart!(e, props.resizeKey!)}
          onDoubleClick={(e) => {
            e.stopPropagation()
            props.onResetWidths?.()
          }}
          title="Drag to resize · double-click to reset"
          aria-hidden
        />
      )}
    </th>
  )
}
