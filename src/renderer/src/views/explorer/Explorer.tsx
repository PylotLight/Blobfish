import { createPortal } from "react-dom";
import {
  ToolbarAddress,
  ToolbarFilter,
  ToolbarHistory,
  ToolbarActions,
} from "./Toolbar";
import ExplorerCtxMenu from "./CtxMenu";
import { BlobRow, Th, type RowHandlers } from "./BlobRow";
import { useVirtualRows } from "./useVirtualRows";
import {
  collator,
  formatWhen,
  keyOf,
  sasWarning,
  type CtxMenu,
  type SortKey,
  type SortDir,
} from "./helpers";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type {
  AccountSummary,
  StorageBlobItem,
  StorageContainer,
} from "../../../../shared/types";
import type { SelectionTarget } from "../../App";
import {
  ConfirmDialog,
  FolderPickerDialog,
  PromptDialog,
  VersionHistoryDialog,
} from "../Dialogs";
import PreviewDialog from "../Preview";
import { Icon } from "../Icon";
import { parseStorageError, type ExplorerError } from "../errors";
import ErrorCallout from "../ErrorCallout";
import ListingStatus from "../ListingStatus";
import { useBlobListing } from "../useBlobListing";
import { isPartial } from "../../../../shared/listing-pager";
import { dropTargetLabel } from "../../../../shared/file-drop";
import { useExplorerKeys } from "../useExplorerKeys";
import { usePreviewTabs } from "./usePreviewTabs";
import { useExplorerDnd } from "./useExplorerDnd";
import {
  useBlobActions,
  type ConfirmState,
  type PromptState,
} from "./useBlobActions";
import { useExplorerNav } from "./useExplorerNav";
import {
  onExplorerAction,
  publishExplorer,
  type ExplorerAction,
} from "../../palette-bus";
import logoUrl from "../../assets/logo.png";

export default function Explorer(props: {
  account: AccountSummary | null;
  target: SelectionTarget | null;
  onOpenContainer: (container: string) => void;
  onContainerChange?: (container: string | null) => void;
  onChanged: () => void;
  onContainersChanged: (accountId: string) => void;
  onNewConnection?: () => void;
}): React.JSX.Element {
  const { account } = props;
  const [containers, setContainers] = useState<StorageContainer[]>([]);
  // Container-scoped attachments open straight into their container —
  // no intermediate container-directory level.
  const [container, setContainer] = useState<string | null>(
    () => account?.containerName ?? null,
  );
  const listing = useBlobListing();
  const { blobs, setBlobs, loadingList } = listing;
  const [navPrefix, setNavPrefix] = useState("");
  const [backHist, setBackHist] = useState<string[]>([]);
  const [fwdHist, setFwdHist] = useState<string[]>([]);
  const [selection, setSelection] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState("");
  const [loadingContainers, setLoadingContainers] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  // Errors are tracked per view: a background container-listing 403 (SAS
  // without account-level list permission) must not cover a working blob
  // listing, and vice versa. Action errors (CRUD/uploads) show in both.
  const [containersError, setContainersError] = useState<ExplorerError | null>(
    null,
  );
  const [blobError, setBlobError] = useState<ExplorerError | null>(null);
  const [actionError, setActionError] = useState<ExplorerError | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [sortDir, setSortDir] = useState<SortDir>(1);
  const [copiedEndpoint, setCopiedEndpoint] = useState(false);
  const [colWidths, setColWidths] = useState<{
    size: number;
    modified: number;
  }>(() => {
    try {
      const raw = localStorage.getItem("blobfish.colWidths");
      if (raw) {
        const parsed = JSON.parse(raw) as { size?: number; modified?: number };
        const size = Math.min(320, Math.max(70, Number(parsed.size) || 110));
        const modified = Math.min(
          480,
          Math.max(130, Number(parsed.modified) || 230),
        );
        return { size, modified };
      }
    } catch {
      // Fall through to defaults.
    }
    return { size: 110, modified: 230 };
  });

  useEffect(() => {
    try {
      localStorage.setItem("blobfish.colWidths", JSON.stringify(colWidths));
    } catch {
      // Storage full/blocked — widths just won't persist.
    }
  }, [colWidths]);

  function startColResize(e: React.MouseEvent, key: "size" | "modified"): void {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startW = colWidths[key];
    const onMove = (ev: MouseEvent): void => {
      const dx = ev.clientX - startX;
      const limits =
        key === "size" ? { min: 70, max: 320 } : { min: 130, max: 480 };
      const next = Math.min(limits.max, Math.max(limits.min, startW + dx));
      setColWidths((prev) => ({ ...prev, [key]: next }));
    };
    const onUp = (): void => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  function resetColWidths(): void {
    setColWidths({ size: 110, modified: 230 });
  }

  const navPrefixRef = useRef(navPrefix);
  navPrefixRef.current = navPrefix;
  const containerRef = useRef(container);
  containerRef.current = container;
  // Monotonic request ids — stale listings (e.g. a slow 403 for container A
  // resolving after the user picked container B) never overwrite fresh state.
  // Container and blob listings track independently so one selection resolving
  // can't invalidate the other.
  const containerSeq = useRef(0);
  const selectionRef = useRef(selection);
  selectionRef.current = selection;
  const filterRef = useRef<HTMLInputElement>(null);
  const {
    previewTabs,
    activeTab,
    setActiveTab,
    resetPreviewTabs,
    openPreviewTab,
    closePreviewTab,
    dropTabsForNames,
    renamePreviewTab,
    dropTabsForPaths,
  } = usePreviewTabs(
    () => containerRef.current,
    () => setCtx(null),
  );

  // ⌘F / Ctrl+F focuses the single search box. Escape closes the context menu.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "f") {
        e.preventDefault();
        filterRef.current?.focus();
        filterRef.current?.select();
      } else if (e.key === "Escape") {
        setCtx(null);
        setOptsMenu(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const [confirm, setConfirm] = useState<ConfirmState | null>(null);
  const [prompt, setPrompt] = useState<PromptState | null>(null);
  const [moveCopy, setMoveCopy] = useState<{
    mode: "move" | "copy";
    names: string[];
  } | null>(null);
  const [historyFor, setHistoryFor] = useState<{
    container: string;
    name: string;
  } | null>(null);
  const [showDeleted, setShowDeleted] = useState(false);
  const showDeletedRef = useRef(showDeleted);
  showDeletedRef.current = showDeleted;
  // Tabbed previews (ASE-style): browse tab + one tab per open file.
  const [ctx, setCtx] = useState<CtxMenu | null>(null);
  const ctxRef = useRef<HTMLDivElement>(null);
  // Container options (⋯) in the toolbar: destructive stuff lives here, not as a button.
  const [optsMenu, setOptsMenu] = useState<{
    right: number;
    top: number;
  } | null>(null);
  // Keep the menu on-screen using its real size (it grows with the selection's actions).
  useLayoutEffect(() => {
    const el = ctxRef.current;
    if (!ctx || !el) return;
    const pad = 8;
    const { width, height } = el.getBoundingClientRect();
    el.style.left = `${Math.max(pad, Math.min(ctx.x, window.innerWidth - width - pad))}px`;
    el.style.top = `${Math.max(pad, Math.min(ctx.y, window.innerHeight - height - pad))}px`;
  }, [ctx]);
  const lastSelectedRef = useRef<string | null>(null);

  const accountId = account?.id;

  function flash(message: string): void {
    setNotice(message);
    window.setTimeout(() => setNotice((n) => (n === message ? null : n)), 3200);
  }

  function fail(
    err: unknown,
    context: "containers" | "blobs" | "action" = "action",
  ): void {
    // Inline banner + activity dock carry the error — no extra toast needed.
    // Each view owns its slot, so a stale container-listing 403 never covers
    // a working blob listing (container-scoped SAS without account-level
    // list permission) and vice versa.
    const next = parseStorageError(err, context);
    if (context === "containers") setContainersError(next);
    else if (context === "blobs") setBlobError(next);
    else setActionError(next);
  }

  function clearAllErrors(): void {
    setContainersError(null);
    setBlobError(null);
    setActionError(null);
  }

  const scoped = Boolean(account?.containerName);
  const {
    switchContainer,
    resetNav,
    loadContainers,
    reloadBlobs,
    go,
    goBack,
    goForward,
    goUp,
    retryCurrent,
  } = useExplorerNav({
    accountId,
    scoped,
    containerRef,
    navPrefixRef,
    containerSeq,
    showDeletedRef,
    navPrefix,
    backHist,
    fwdHist,
    listing,
    props,
    setContainer,
    setActiveTab,
    setCtx,
    setOptsMenu,
    setNavPrefix,
    setBackHist,
    setFwdHist,
    setSelection,
    setLoadingContainers,
    setContainersError,
    setContainers,
    setBlobError,
    setActionError,
    fail,
  });

  // Initial load per account.
  useEffect(() => {
    containerSeq.current += 1;
    setContainers([]);
    const initial = account?.containerName ?? null;
    setContainer(initial);
    containerRef.current = initial;
    props.onContainerChange?.(initial);
    setBlobs(null);
    setFilter("");
    clearAllErrors();
    resetPreviewTabs();
    setCtx(null);
    setMoveCopy(null);
    setHistoryFor(null);
    setShowDeleted(false);
    showDeletedRef.current = false;
    resetNav();
    if (!accountId) return;
    loadContainers(
      accountId,
      account?.containerName ?? props.target?.container ?? undefined,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountId]);

  // Sidebar picks (account or container rows, or post-wizard selection).
  useEffect(() => {
    if (props.target) {
      // Sidebar Refresh on what's already open: re-list in place, keep the folder.
      if (
        props.target.reload &&
        props.target.container === containerRef.current
      ) {
        retryCurrent();
        return;
      }
      switchContainer(props.target.container);
      resetNav();
      // ⌘K recent folders jump straight to a prefix.
      if (props.target.prefix) {
        setNavPrefix(props.target.prefix);
        navPrefixRef.current = props.target.prefix;
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.target?.tick]);

  // Refresh the listing when one of our queued uploads finishes. The
  // completion arrives via the activity feed (completed transfers are
  // filed there, not kept in the transfers list).
  // Note: downloads never alter Azure containers, so only uploads reload blobs.
  const seenActivity = useRef<Set<string>>(new Set());
  useEffect(() => {
    const off = window.api.activity.onUpdate((entries) => {
      let reloadNeeded = false;
      for (const e of entries) {
        if (
          e.status !== "success" ||
          e.transferDirection !== "upload" ||
          seenActivity.current.has(e.id)
        ) {
          continue;
        }
        seenActivity.current.add(e.id);
        if (e.accountId === accountId && e.container === containerRef.current) {
          reloadNeeded = true;
        }
      }
      if (reloadNeeded) reloadBlobs();
    });
    return off;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountId]);

  // Blob listing: first page right away, the rest streamed in behind it.
  useEffect(() => {
    if (!accountId || !container) return;
    // A fresh selection clears that view's previous auth error.
    setBlobError(null);
    listing.load(
      { accountId, container, prefix: navPrefix, includeDeleted: showDeleted },
      () => {
        setBlobError(null);
        setSelection(new Set());
      },
      (err) => {
        fail(err, "blobs");
        setBlobs(null);
      },
    );
    return listing.cancel;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountId, container, navPrefix, showDeleted]);

  /* ---------- prefix history ---------- */

  /* ---------- derived ---------- */

  const warn = sasWarning(account?.sasExpiry);
  const isDfs = (account?.endpoint.includes(".dfs.") ?? false) === true;

  const visibleBlobs = useMemo(() => {
    const items = blobs?.items ?? [];
    const q = filter.trim().toLowerCase();
    const filtered =
      q === "" ? items : items.filter((i) => i.leaf.toLowerCase().includes(q));
    const sorted = [...filtered];
    sorted.sort((a, b) => {
      if (a.isPrefix !== b.isPrefix) return a.isPrefix ? -1 : 1;
      let cmp = 0;
      if (sortKey === "name") cmp = collator.compare(a.leaf, b.leaf);
      else if (sortKey === "size") cmp = (a.size ?? -1) - (b.size ?? -1);
      else cmp = (a.lastModified ?? "").localeCompare(b.lastModified ?? "");
      return cmp * sortDir;
    });
    return sorted;
  }, [blobs, filter, sortKey, sortDir]);

  const deletedKeys = useMemo(
    () => new Set(visibleBlobs.filter((b) => b.deleted).map(keyOf)),
    [visibleBlobs],
  );

  const {
    copyPaths,
    onNewContainer,
    onDeleteContainer,
    onNewFolder,
    onUpload,
    onDownload,
    onPreviewDownload,
    onDelete,
    onRename,
    onMoveOrCopy,
    submitMoveCopy,
    onRestore,
    copyUrls,
    onUploadFolder,
    copyEndpoint,
  } = useBlobActions({
    account,
    accountId,
    container,
    blobs,
    selection,
    deletedKeys,
    navPrefix,
    moveCopy,
    props,
    setBusy,
    setActionError,
    setPrompt,
    setConfirm,
    setMoveCopy,
    setBlobs,
    setCtx,
    setCopiedEndpoint,
    flash,
    fail,
    reloadBlobs,
    loadContainers,
    switchContainer,
    resetNav,
    dropTabsForNames,
    renamePreviewTab,
    dropTabsForPaths,
  });

  // Row order for shift-range selection, built once per listing/sort/filter
  // (it used to be rebuilt inside every row: O(n²) per render).
  const orderedKeys = useMemo(() => visibleBlobs.map(keyOf), [visibleBlobs]);
  const orderedKeysRef = useRef(orderedKeys);
  orderedKeysRef.current = orderedKeys;

  /* ---------- virtualized blob rows ---------- */

  const {
    bodyScrollRef,
    topSpacerRef,
    rowHeight,
    virtual,
    onBodyScroll,
    windowStart,
    windowEnd,
  } = useVirtualRows(visibleBlobs.length);

  /* ---------- keyboard nav (Finder-style; logic in useExplorerKeys) ---------- */

  const [quickLook, setQuickLook] = useState<StorageBlobItem | null>(null);
  const leafLabels = useMemo(
    () => visibleBlobs.map((b) => b.leaf),
    [visibleBlobs],
  );
  const nav = useExplorerKeys({
    keys: orderedKeys,
    labels: leafLabels,
    selection,
    setSelection,
    anchorRef: lastSelectedRef,
    scrollRef: bodyScrollRef,
    rowHeight,
    modalOpen: Boolean(confirm || prompt || moveCopy || historyFor),
    onOpen: (i) => {
      setQuickLook(null);
      const item = visibleBlobs[i];
      if (item) openRow(item);
    },
    onUp: () => {
      setQuickLook(null);
      goUp();
    },
    onQuickLook: (i) => {
      const item = visibleBlobs[i];
      if (!item || item.isPrefix) return;
      if (item.deleted)
        return flash("That blob is deleted — restore it first.");
      setQuickLook((cur) => (cur?.name === item.name ? null : item));
    },
    onDelete: () => {
      if (busy === null) onDelete();
    },
  });
  // Quick Look follows the arrow keys, like Finder.
  useEffect(() => {
    const item = visibleBlobs[nav.activeIndex];
    if (
      quickLook &&
      item &&
      !item.isPrefix &&
      !item.deleted &&
      item.name !== quickLook.name
    )
      setQuickLook(item);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nav.activeIndex]);

  const visibleContainers = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const filtered =
      q === ""
        ? containers
        : containers.filter((c) => c.name.toLowerCase().includes(q));
    const sorted = [...filtered];
    sorted.sort((a, b) =>
      sortKey === "modified"
        ? (a.lastModified ?? "").localeCompare(b.lastModified ?? "") * sortDir
        : collator.compare(a.name, b.name) * sortDir,
    );
    return sorted;
  }, [containers, filter, sortKey, sortDir]);

  const crumbs = useMemo(
    () => (navPrefix === "" ? [] : navPrefix.split("/").filter(Boolean)),
    [navPrefix],
  );

  function toggleSort(key: SortKey): void {
    if (key === sortKey) setSortDir((d) => (d === 1 ? -1 : 1));
    else {
      setSortKey(key);
      setSortDir(1);
    }
  }

  function toggleOne(key: string): void {
    setSelection((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function toggleAll(keys: string[]): void {
    const clearing = selection.size === keys.length && keys.length > 0;
    // Be upfront when the folder isn't fully listed: only loaded rows get picked.
    if (!clearing && keys.length > 0 && isPartial(listing.phase)) {
      flash(
        `Selected the ${keys.length.toLocaleString()} loaded items. This folder has more that aren't listed yet.`,
      );
    }
    setSelection((prev) =>
      prev.size === keys.length && keys.length > 0 ? new Set() : new Set(keys),
    );
  }

  /* ---------- click-to-select + context menu ---------- */

  // Stable callbacks for memoized rows; they read the latest handlers.
  const rowActions = useRef({ selectRow, openRow, openCtx, toggleOne });
  rowActions.current = { selectRow, openRow, openCtx, toggleOne };
  const rowHandlers = useMemo<RowHandlers>(
    () => ({
      click: (e, key) =>
        rowActions.current.selectRow(e, key, orderedKeysRef.current),
      open: (item) => rowActions.current.openRow(item),
      context: (e, key) =>
        rowActions.current.openCtx(e, key, orderedKeysRef.current),
      toggle: (key) => rowActions.current.toggleOne(key),
    }),
    [],
  );

  /** Single click selects; ⌘/Ctrl toggles; Shift extends a range. Double-click opens. */
  function selectRow(
    e: React.MouseEvent,
    key: string,
    orderedKeys: string[],
  ): void {
    if (e.shiftKey && lastSelectedRef.current) {
      const anchor = orderedKeys.indexOf(lastSelectedRef.current);
      const at = orderedKeys.indexOf(key);
      if (anchor !== -1 && at !== -1) {
        const [lo, hi] = anchor < at ? [anchor, at] : [at, anchor];
        setSelection(new Set(orderedKeys.slice(lo, hi + 1)));
        return;
      }
    }
    if (e.metaKey || e.ctrlKey) {
      toggleOne(key);
      lastSelectedRef.current = key;
      return;
    }
    setSelection(new Set([key]));
    lastSelectedRef.current = key;
  }

  function openRow(item: StorageBlobItem): void {
    if (item.isPrefix) {
      go(blobs && blobs.prefix ? `${blobs.prefix}/${item.leaf}` : item.name);
    } else if (item.deleted) {
      flash("That blob is deleted — restore it first.");
    } else {
      openPreviewTab(item.name, item.size);
    }
  }

  function openCtx(
    e: React.MouseEvent,
    key: string | null,
    orderedKeys: string[],
  ): void {
    e.preventDefault();
    e.stopPropagation();
    if (key === null) {
      setCtx({ x: e.clientX, y: e.clientY, keys: [] });
      return;
    }
    const cur = selectionRef.current;
    const keys = cur.has(key) && cur.size > 0 ? [...cur] : [key];
    if (!cur.has(key)) {
      lastSelectedRef.current = key;
      const next = new Set([key]);
      selectionRef.current = next;
      setSelection(next);
    }
    setCtx({ x: e.clientX, y: e.clientY, keys });
  }

  const paletteAction = useRef<(action: ExplorerAction) => void>(
    () => undefined,
  );
  paletteAction.current = (action) => {
    if (
      busy !== null &&
      action !== "copy-url" &&
      action !== "copy-path" &&
      action !== "focus-filter"
    )
      return;
    if (action === "refresh") retryCurrent();
    else if (action === "upload-files") onUpload();
    else if (action === "upload-folder") onUploadFolder();
    else if (action === "new-folder") onNewFolder();
    else if (action === "new-container") onNewContainer();
    else if (action === "download") onDownload();
    else if (action === "copy-url") copyUrls();
    else if (action === "copy-path" && selection.size > 0)
      copyPaths([...selection]);
    else if (action === "toggle-deleted" && container)
      setShowDeleted((v) => !v);
    else if (action === "go-up") goUp();
    else if (action === "focus-filter") {
      filterRef.current?.focus();
      filterRef.current?.select();
    }
  };
  useEffect(
    () => onExplorerAction((action) => paletteAction.current(action)),
    [],
  );
  useEffect(() => {
    publishExplorer(
      accountId
        ? {
            accountId,
            container,
            prefix: navPrefix,
            selection: selection.size,
            containers: containers.map((c) => c.name),
            canManageContainers:
              account?.kind === "account" && !account.containerName,
            showDeleted,
          }
        : null,
    );
  }, [
    accountId,
    account,
    container,
    navPrefix,
    selection,
    containers,
    showDeleted,
  ]);
  useEffect(() => () => publishExplorer(null), []);

  /* ---------- drag and drop upload (Finder → current folder / folder row) ---------- */

  const { dropActive, dropFolder, dropHandlers } = useExplorerDnd({
    accountId,
    container,
    prefix: blobs?.prefix || undefined,
    activeTab,
    modalOpen: Boolean(confirm || prompt || moveCopy || historyFor),
    onBusy: setBusy,
    onClearError: () => setActionError(null),
    onError: (err) => fail(err, "action"),
    onFlash: flash,
  });

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
          Connect a storage account using a Connection String, SAS URL, or
          Account Key. All credentials remain securely encrypted in your OS
          Keychain.
        </p>
        {props.onNewConnection && (
          <button className="btn mint hero-cta" onClick={props.onNewConnection}>
            <Icon name="plus" size={15} /> Connect Storage Account
          </button>
        )}
      </section>
    );
  }

  const selectedFiles = [...selection].filter((k) => !k.endsWith("/"));
  const hasDeletedSel = [...selection].some((k) => deletedKeys.has(k));
  const canRename =
    selectedFiles.length === 1 && selection.size === 1 && !hasDeletedSel;
  // Exactly one live file selected → eligible for in-app preview.
  const previewFile =
    selection.size === 1 && selectedFiles.length === 1 && !hasDeletedSel
      ? (visibleBlobs.find(
          (b) => !b.isPrefix && keyOf(b) === selectedFiles[0],
        ) ?? null)
      : null;

  const displayAccount =
    account.containerName ?? account.accountName ?? account.name;
  let endpointHost = account.endpoint;
  try {
    endpointHost = new URL(account.endpoint).host;
  } catch {
    // Keep the raw endpoint when it is not a valid URL.
  }

  function dismissVisible(view: "containers" | "blobs"): void {
    setActionError(null);
    if (view === "containers") setContainersError(null);
    else setBlobError(null);
  }

  function errorCalloutFor(
    view: "containers" | "blobs",
  ): React.JSX.Element | null {
    const slot = view === "containers" ? containersError : blobError;
    const visible = actionError ?? slot;
    if (!visible) return null;
    return (
      <ErrorCallout
        error={visible}
        onRetry={retryCurrent}
        onDismiss={() => dismissVisible(view)}
      />
    );
  }

  const activePreview =
    activeTab !== null
      ? (previewTabs.find((t) => t.key === activeTab) ?? null)
      : null;

  const tabStrip = container ? (
    <div className="tab-strip" role="tablist" aria-label="Open tabs">
      <button
        className={`tab${activePreview === null ? " active" : ""}`}
        role="tab"
        aria-selected={activePreview === null}
        onClick={() => {
          setActiveTab(null);
          setCtx(null);
        }}
        title={container}
      >
        <span className="kind-ico container tab-ico" aria-hidden />
        <span className="tab-label">{container}</span>
      </button>
      {previewTabs.map((t) => {
        const leaf = t.name.includes("/")
          ? t.name.slice(t.name.lastIndexOf("/") + 1)
          : t.name;
        const isActive = activeTab === t.key;
        return (
          <button
            key={t.key}
            className={`tab preview-tab${isActive ? " active" : ""}`}
            role="tab"
            aria-selected={isActive}
            onClick={() => {
              setActiveTab(t.key);
              setCtx(null);
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
                e.stopPropagation();
                closePreviewTab(t.key);
              }}
            >
              <Icon name="close" size={12} />
            </span>
          </button>
        );
      })}
    </div>
  ) : null;

  const presentationProps = {
    account,
    displayAccount,
    endpointHost,
    warn,
    copiedEndpoint,
    copyEndpoint,
    scoped,
    filterRef,
    filter,
    setFilter,
    backHist,
    goBack,
    fwdHist,
    goForward,
    goUp,
    navPrefix,
    retryCurrent,
    accountId,
    loadingContainers,
    loadingList,
    busy,
    onNewContainer,
    container,
    setOptsMenu,
    optsMenu,
    setCtx,
    previewFile,
    openPreviewTab,
    selection,
    hasDeletedSel,
    onDownload,
    onNewFolder,
    visibleBlobs,
    keyOf,
    toggleAll,
    showDeleted,
    setShowDeleted,
    isDfs,
    canRename,
    onRename,
    onRestore,
    onMoveOrCopy,
    onDelete,
    crumbs,
    go,
    switchContainer,
    resetNav,
    containers,
    ctx,
    ctxRef,
    onUpload,
    copyPaths,
    deletedKeys,
    containerRef,
    setHistoryFor,
  };
  const ctxMenu = <ExplorerCtxMenu {...presentationProps} />;

  // ----- account level: container directory -----
  if (!container) {
    const viewError = actionError ?? containersError;
    const showEmpty =
      !loadingContainers && !viewError && visibleContainers.length === 0;
    return (
      <div className="explorer explorer-panel fade-in">
        <header className="explorer-toolbar">
          <div className="toolbar-left">
            <ToolbarHistory {...presentationProps} />
            <span className="toolbar-div" aria-hidden />
            <div className="toolbar-crumb">
              <span className="eyebrow">Storage account</span>
              <div className="toolbar-title-row">
                <strong className="toolbar-title" title={account.name}>
                  {account.name}
                </strong>
                <button
                  className="endpoint-badge"
                  onClick={copyEndpoint}
                  title={`${account.endpoint} — click to copy`}
                  aria-label={
                    copiedEndpoint
                      ? "Endpoint copied"
                      : `Copy endpoint ${account.endpoint}`
                  }
                >
                  <span className="endpoint-host">{endpointHost}</span>
                  <span className="endpoint-copy" aria-hidden>
                    <Icon name={copiedEndpoint ? "check" : "copy"} size={12} />
                  </span>
                </button>
                {warn && <span className="pill warn">{warn}</span>}
              </div>
            </div>
          </div>
          <div className="toolbar-right">
            <ToolbarFilter {...presentationProps} />
            {!scoped && (
              <button
                className="btn mint small toolbar-primary"
                disabled={busy !== null}
                onClick={onNewContainer}
                aria-label="New container"
                title="New container"
              >
                <Icon name="plus" size={14} />
                <span className="toolbar-btn-label"> New container</span>
              </button>
            )}
          </div>
        </header>

        <div className="explorer-body-scroll">
          {(container || crumbs.length > 0) && (
            <ToolbarAddress {...presentationProps} />
          )}
          {errorCalloutFor("containers")}
          {loadingContainers ? (
            <ul className="skeleton">
              {Array.from({ length: 8 }, (_, i) => (
                <li key={i} style={{ animationDelay: `${i * 40}ms` }} />
              ))}
            </ul>
          ) : showEmpty ? (
            <div className="empty-state">
              <div className="empty-state-icon" aria-hidden>
                <Icon name="grid" size={26} />
              </div>
              <p className="empty-state-title">
                {filter
                  ? `No containers matching "${filter}"`
                  : "No containers yet"}
              </p>
              <p className="muted small empty-state-sub">
                {filter
                  ? "Try a different filter, or clear it to see everything."
                  : "Containers organize your blobs. Create your first container to get started."}
              </p>
              <div className="row empty-state-cta">
                {filter ? (
                  <button
                    className="btn ghost small"
                    onClick={() => setFilter("")}
                  >
                    Clear filter
                  </button>
                ) : (
                  !scoped && (
                    <button className="btn mint small" onClick={onNewContainer}>
                      <Icon name="plus" size={14} /> New container
                    </button>
                  )
                )}
              </div>
            </div>
          ) : (
            <table
              className="blob-table dir-table table-in"
              style={{ tableLayout: "fixed" }}
            >
              <thead>
                <tr>
                  <Th
                    label="Name"
                    k="name"
                    sortKey={sortKey}
                    dir={sortDir}
                    onSort={toggleSort}
                    wide
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
                  {!scoped && (
                    <th>
                      <span className="sr">Actions</span>
                    </th>
                  )}
                </tr>
              </thead>
              <tbody>
                {viewError && visibleContainers.length === 0 ? (
                  <tr>
                    <td
                      colSpan={scoped ? 2 : 3}
                      className="muted table-unavailable"
                    >
                      Container listing unavailable — fix the error above, then
                      retry.
                    </td>
                  </tr>
                ) : (
                  visibleContainers.map((c, i) => (
                    <tr
                      key={c.name}
                      className="row-in clickable"
                      style={{ animationDelay: `${Math.min(i, 10) * 12}ms` }}
                      onClick={() => {
                        switchContainer(c.name);
                        resetNav();
                        props.onOpenContainer(c.name);
                      }}
                    >
                      <td className="name-col">
                        <span className="file-row">
                          <span className="file-ico container-lg" aria-hidden />
                          {c.name}
                        </span>
                      </td>
                      <td className="muted">{formatWhen(c.lastModified)}</td>
                      {!scoped && (
                        <td
                          className="row-act"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <button
                            className="mini-btn danger-x"
                            title={`Delete container "${c.name}"`}
                            aria-label={`Delete container ${c.name}`}
                            onClick={() => onDeleteContainer(c.name)}
                          >
                            <Icon name="trash" size={14} />
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
    );
  }

  // ----- container level: blob browser -----
  // Only blob/action errors surface here — a container-listing 403 (SAS
  // without account-level list) must not cover working blob data.
  const blobViewError = actionError ?? blobError;
  const showBlobEmpty =
    !loadingList && !blobViewError && visibleBlobs.length === 0;
  const dropHere = dropTargetLabel(container, dropFolder ?? blobs?.prefix);
  return (
    <div
      className="explorer explorer-panel drop-host fade-in"
      {...dropHandlers}
    >
      {dropActive && (
        <div
          className={`drop-overlay${dropFolder ? " on-folder" : ""}`}
          aria-hidden
        >
          <div className="drop-overlay-card">
            <span className="drop-overlay-icon">
              <Icon name="upload" size={22} />
            </span>
            <span className="drop-overlay-title">
              {dropFolder ? "Drop into folder" : "Drop to upload"}
            </span>
            <span className="drop-overlay-dest" title={dropHere}>
              {dropHere}
            </span>
          </div>
        </div>
      )}
      <header className="explorer-toolbar">
        <div className="toolbar-left">
          <ToolbarHistory {...presentationProps} />
          <span className="toolbar-div" aria-hidden />
          <div className="toolbar-crumb">
            <span className="eyebrow">Blob container</span>
            <div className="toolbar-title-row">
              <strong className="toolbar-title" title={container ?? ""}>
                {container}
              </strong>
              <span className="endpoint-badge static" title={account.endpoint}>
                <span className="endpoint-host">{endpointHost}</span>
              </span>
              {warn && <span className="pill warn">{warn}</span>}
            </div>
          </div>
        </div>
        <div className="toolbar-right">
          <ToolbarFilter {...presentationProps} />
          <button
            className="nav-btn"
            title="Container options"
            aria-label="Container options"
            aria-haspopup="menu"
            aria-expanded={optsMenu !== null}
            onClick={(e) => {
              const r = e.currentTarget.getBoundingClientRect();
              setOptsMenu(
                optsMenu
                  ? null
                  : { right: window.innerWidth - r.right, top: r.bottom + 6 },
              );
            }}
          >
            <Icon name="more" size={16} />
          </button>
          {optsMenu &&
            container &&
            createPortal(
              <>
                <div
                  className="ctx-overlay"
                  onClick={() => setOptsMenu(null)}
                  onContextMenu={() => setOptsMenu(null)}
                />
                <div
                  className="ctx-menu glass strong"
                  role="menu"
                  aria-label="Container options"
                  style={{
                    right: `${optsMenu.right}px`,
                    top: `${optsMenu.top}px`,
                  }}
                >
                  <button
                    role="menuitem"
                    onClick={() => {
                      setOptsMenu(null);
                      void navigator.clipboard
                        ?.writeText(
                          `${account.endpoint.split("?")[0]!.replace(/\/$/, "")}/${container}`,
                        )
                        .then(() => flash("Container URL copied"))
                        .catch(() => undefined);
                    }}
                  >
                    Copy container URL
                  </button>
                  <button
                    role="menuitem"
                    onClick={() => {
                      setOptsMenu(null);
                      retryCurrent();
                    }}
                  >
                    Refresh
                  </button>
                  {!scoped && (
                    <>
                      <div className="ctx-sep" aria-hidden />
                      <button
                        role="menuitem"
                        className="danger"
                        disabled={busy !== null}
                        onClick={() => {
                          setOptsMenu(null);
                          onDeleteContainer(container);
                        }}
                      >
                        Delete container…
                      </button>
                    </>
                  )}
                </div>
              </>,
              document.body,
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
            onDownload={() =>
              onPreviewDownload(activePreview.container, activePreview.name)
            }
          />
        </div>
      ) : (
        <>
          <ToolbarActions {...presentationProps} />
          <ListingStatus
            phase={listing.phase}
            loaded={blobs?.items.length ?? 0}
            error={listing.pagingError}
            filtering={filter.trim() !== ""}
            onStop={listing.stop}
            onLoadMore={listing.loadMore}
          />

          <div
            className="explorer-body-scroll"
            ref={bodyScrollRef}
            onScroll={virtual ? onBodyScroll : undefined}
            onContextMenu={(e) => openCtx(e, null, [])}
          >
            <ToolbarAddress {...presentationProps} />
            {errorCalloutFor("blobs")}
            {loadingList ? (
              <ul className="skeleton">
                {Array.from({ length: 8 }, (_, i) => (
                  <li key={i} style={{ animationDelay: `${i * 40}ms` }} />
                ))}
              </ul>
            ) : showBlobEmpty ? (
              <div className="empty-state">
                <div className="empty-state-icon" aria-hidden>
                  <Icon name="inbox" size={26} />
                </div>
                <p className="empty-state-title">
                  {filter
                    ? `Nothing matches "${filter}"`
                    : "This folder is empty"}
                </p>
                <p className="muted small empty-state-sub">
                  {filter
                    ? "Try a different filter, or clear it to see everything."
                    : "Upload files or create a folder to get started."}
                </p>
                <div className="row empty-state-cta">
                  {filter ? (
                    <button
                      className="btn ghost small"
                      onClick={() => setFilter("")}
                    >
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
              <table
                className="blob-table table-in"
                style={{ tableLayout: "fixed" }}
                {...nav.gridProps}
              >
                <thead>
                  <tr>
                    <th className="check-col">
                      <input
                        type="checkbox"
                        aria-label="Select all"
                        checked={
                          selection.size > 0 &&
                          selection.size === visibleBlobs.length
                        }
                        onChange={() => toggleAll(visibleBlobs.map(keyOf))}
                      />
                    </th>
                    <Th
                      label="Name"
                      k="name"
                      sortKey={sortKey}
                      dir={sortDir}
                      onSort={toggleSort}
                      wide
                    />
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
                  {!blobViewError && (blobs?.prefix ?? navPrefix) !== "" && (
                    <tr
                      className="row-in parent-row clickable"
                      onClick={goUp}
                      title="Up to parent folder"
                    >
                      <td className="check-col" />
                      <td className="name-col">
                        <span className="file-row parent-link">
                          <span className="file-ico folder up" aria-hidden>
                            <Icon name="parent" size={14} />
                          </span>
                          <strong>..</strong>
                          <span className="muted small">Up to parent</span>
                        </span>
                      </td>
                      <td className="num muted">—</td>
                      <td className="muted">—</td>
                    </tr>
                  )}
                  {blobViewError && visibleBlobs.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="muted table-unavailable">
                        Blob listing unavailable — fix the error above, then
                        retry.
                      </td>
                    </tr>
                  ) : (
                    <>
                      {virtual && (
                        <tr
                          ref={topSpacerRef}
                          className="virtual-spacer"
                          aria-hidden
                          style={{ height: windowStart * rowHeight }}
                        >
                          <td colSpan={4} />
                        </tr>
                      )}
                      {visibleBlobs
                        .slice(windowStart, windowEnd)
                        .map((item, n) => {
                          const key = orderedKeys[windowStart + n]!;
                          return (
                            <BlobRow
                              key={key}
                              item={item}
                              rowKey={key}
                              index={windowStart + n}
                              id={nav.rowId(windowStart + n)}
                              active={nav.activeIndex === windowStart + n}
                              selected={selection.has(key)}
                              animate={!virtual}
                              handlers={rowHandlers}
                              dropTarget={
                                dropActive && dropFolder === item.name
                              }
                            />
                          );
                        })}
                      {virtual && (
                        <tr
                          className="virtual-spacer"
                          aria-hidden
                          style={{
                            height:
                              (visibleBlobs.length - windowEnd) * rowHeight,
                          }}
                        >
                          <td colSpan={4} />
                        </tr>
                      )}
                    </>
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
      {moveCopy && accountId && (
        <FolderPickerDialog
          title={`${moveCopy.mode === "move" ? "Move" : "Copy"} ${moveCopy.names.length} item${moveCopy.names.length === 1 ? "" : "s"}`}
          accountId={accountId}
          container={container ?? ""}
          confirmLabel={moveCopy.mode === "move" ? "Move here" : "Copy here"}
          onCancel={() => setMoveCopy(null)}
          onSubmit={submitMoveCopy}
        />
      )}
      {quickLook && accountId && container && (
        <PreviewDialog
          key={quickLook.name}
          accountId={accountId}
          container={container}
          name={quickLook.name}
          size={quickLook.size}
          onClose={() => {
            setQuickLook(null);
            nav.focus();
          }}
          onDownload={() => onPreviewDownload(container, quickLook.name)}
        />
      )}
      {historyFor && accountId && (
        <VersionHistoryDialog
          accountId={accountId}
          container={historyFor.container}
          name={historyFor.name}
          onCancel={() => setHistoryFor(null)}
          onRestored={() => reloadBlobs()}
        />
      )}
      {notice && <div className="toast glass strong toast-in">{notice}</div>}
    </div>
  );
}
