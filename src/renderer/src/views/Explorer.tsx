import { createPortal } from "react-dom";
import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type {
  AccountSummary,
  StorageBlobItem,
  StorageContainer,
} from "../../../shared/types";
import type { SelectionTarget } from "../App";
import {
  ConfirmDialog,
  FolderPickerDialog,
  PromptDialog,
  VersionHistoryDialog,
} from "./Dialogs";
import PreviewDialog from "./Preview";
import { Icon, type IconName } from "./Icon";
import { formatBytes } from "../../../shared/format";
import {
  rowPitch,
  syncBudget,
  virtualWindow,
} from "../../../shared/virtual-window";
import { parseStorageError, type ExplorerError } from "./errors";
import ErrorCallout from "./ErrorCallout";
import ListingStatus from "./ListingStatus";
import { useBlobListing } from "./useBlobListing";
import { isPartial } from "../../../shared/listing-pager";
import { dropTargetLabel, isFileDrag } from "../../../shared/file-drop";
import { useExplorerKeys } from "./useExplorerKeys";
import {
  onExplorerAction,
  publishExplorer,
  type ExplorerAction,
} from "../palette-bus";
import logoUrl from "../assets/logo.png";

type SortKey = "name" | "size" | "modified";
type SortDir = 1 | -1;

function sasWarning(expiry?: string | null): string | null {
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
const VIRTUAL_MIN_ROWS = 200;
const VIRTUAL_OVERSCAN = 12;
const DEFAULT_ROW_HEIGHT = 46;

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
const collator = new Intl.Collator();

function formatWhen(iso: string | undefined): string {
  if (!iso) return "—";
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? "—" : dateFormat.format(ms);
}

function keyOf(item: StorageBlobItem): string {
  return item.isPrefix ? `${item.name}/` : item.name;
}

/** True when a blob path was covered by a selection of files/folders. */
function isSelectedPath(name: string, sel: string[]): boolean {
  return sel.some((s) => (s.endsWith("/") ? name.startsWith(s) : name === s));
}

interface PreviewTab {
  key: string;
  container: string;
  name: string;
  size?: number;
}

interface CtxMenu {
  x: number;
  y: number;
  /** Selection keys the menu acts on (empty = background). */
  keys: string[];
}

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

  function switchContainer(next: string | null): void {
    setContainer(next);
    containerRef.current = next;
    setActiveTab(null);
    setCtx(null);
    setOptsMenu(null);
    props.onContainerChange?.(next);
  }

  interface ConfirmState {
    title: string;
    body?: string;
    items?: string[];
    requireText?: string;
    confirmLabel: string;
    run: () => Promise<void>;
  }

  interface PromptState {
    title: string;
    label: string;
    initial?: string;
    placeholder?: string;
    hint?: string;
    confirmLabel: string;
    validate?: (v: string) => string | null;
    submit: (v: string) => Promise<void>;
  }

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
  const [previewTabs, setPreviewTabs] = useState<PreviewTab[]>([]);
  const [activeTab, setActiveTab] = useState<string | null>(null);
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
  // Finder drag and drop: enter/leave fire for every child, so count depth
  // instead of toggling (no flicker). dropFolder is the folder row under the cursor.
  const [dropActive, setDropActive] = useState(false);
  const [dropFolder, setDropFolder] = useState<string | null>(null);
  const dragDepth = useRef(0);

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

  function resetNav(): void {
    setNavPrefix("");
    navPrefixRef.current = "";
    setBackHist([]);
    setFwdHist([]);
    setSelection(new Set());
  }

  const loadContainers = (id: string, highlight?: string | null) => {
    const seq = ++containerSeq.current;
    setLoadingContainers(true);
    setContainersError(null);
    window.api.storage
      .listContainers(id)
      .then((cs) => {
        if (seq !== containerSeq.current) return;
        setContainers(cs);
        setContainersError(null);
        setContainer((prev) => {
          let chosen: string | null = null;
          if (highlight && cs.some((c) => c.name === highlight))
            chosen = highlight;
          else if (prev && cs.some((c) => c.name === prev)) chosen = prev;
          else if (cs.length === 1) chosen = cs[0]?.name ?? null;
          containerRef.current = chosen;
          props.onContainerChange?.(chosen);
          return chosen;
        });
        // Empty list is a valid state — rendered as an empty table, not an error.
      })
      .catch((err: unknown) => {
        if (seq !== containerSeq.current) return;
        fail(err, "containers");
      })
      .finally(() => {
        if (seq !== containerSeq.current) return;
        setLoadingContainers(false);
      });
  };

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
    setPreviewTabs([]);
    setActiveTab(null);
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

  function reloadBlobs(): void {
    const curContainer = containerRef.current;
    if (!accountId || !curContainer) return;
    setBlobError(null);
    listing.load(
      {
        accountId,
        container: curContainer,
        prefix: navPrefixRef.current,
        includeDeleted: showDeletedRef.current,
      },
      () => {
        setBlobError(null);
        setSelection(new Set());
      },
      (err) => fail(err, "blobs"),
    );
  }

  /* ---------- prefix history ---------- */

  function go(next: string): void {
    setBackHist((h) => [...h, navPrefix]);
    setFwdHist([]);
    setNavPrefix(next);
    navPrefixRef.current = next;
    setSelection(new Set());
  }

  function goBack(): void {
    if (backHist.length === 0) return;
    const prev = backHist[backHist.length - 1]!;
    setBackHist((h) => h.slice(0, -1));
    setFwdHist((h) => [navPrefix, ...h]);
    setNavPrefix(prev);
    navPrefixRef.current = prev;
    setSelection(new Set());
  }

  function goForward(): void {
    if (fwdHist.length === 0) return;
    const [next, ...rest] = fwdHist;
    setFwdHist(rest);
    setBackHist((h) => [...h, navPrefix]);
    setNavPrefix(next!);
    navPrefixRef.current = next!;
    setSelection(new Set());
  }

  function goUp(): void {
    const segs = navPrefix.split("/").filter(Boolean);
    if (segs.length === 0) {
      // Scoped attachments are rooted at their container — nowhere above to go.
      if (scoped) return;
      // At container root → up means back to the container directory.
      switchContainer(null);
      resetNav();
      return;
    }
    go(segs.slice(0, -1).join("/"));
  }

  /* ---------- derived ---------- */

  const scoped = Boolean(account?.containerName);
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

  // Row order for shift-range selection, built once per listing/sort/filter
  // (it used to be rebuilt inside every row: O(n²) per render).
  const orderedKeys = useMemo(() => visibleBlobs.map(keyOf), [visibleBlobs]);
  const orderedKeysRef = useRef(orderedKeys);
  orderedKeysRef.current = orderedKeys;

  /* ---------- virtualized blob rows ---------- */

  const bodyScrollRef = useRef<HTMLDivElement>(null);
  const topSpacerRef = useRef<HTMLTableRowElement>(null);
  const [rowHeight, setRowHeight] = useState(DEFAULT_ROW_HEIGHT);
  const [viewport, setViewport] = useState({ offset: 0, height: 900 });
  const virtual = visibleBlobs.length > VIRTUAL_MIN_ROWS;
  const scrollFrame = useRef(0);

  const measureViewport = useCallback((): void => {
    const el = bodyScrollRef.current;
    const spacer = topSpacerRef.current;
    if (!el || !spacer) return;
    // Distance scrolled past the first data row (spacer sits right above it).
    const dataTop =
      spacer.getBoundingClientRect().top -
      el.getBoundingClientRect().top +
      el.scrollTop;
    const offset = Math.max(0, el.scrollTop - dataTop);
    const height = el.clientHeight;
    setViewport((prev) =>
      prev.offset === offset && prev.height === height
        ? prev
        : { offset, height },
    );
  }, []);

  const onBodyScroll = useCallback((): void => {
    if (scrollFrame.current) return;
    scrollFrame.current = requestAnimationFrame(() => {
      scrollFrame.current = 0;
      measureViewport();
    });
  }, [measureViewport]);

  useEffect(() => () => cancelAnimationFrame(scrollFrame.current), []);

  useEffect(() => {
    const el = bodyScrollRef.current;
    if (!el || !virtual) return;
    const ro = new ResizeObserver(() => measureViewport());
    ro.observe(el);
    return () => ro.disconnect();
  }, [virtual, measureViewport]);

  // Rows are single-line (nowrap), so a few measured rows size them all; density
  // changes are picked up on the next render. This runs every commit and can
  // setState, so it's capped per frame: past the budget it hands off to rAF
  // (fast scroll on a 10k folder used to chain here into React #185).
  const takeSyncMeasure = useMemo(() => syncBudget(), []);
  useLayoutEffect(() => {
    if (!virtual) return;
    if (!takeSyncMeasure()) return onBodyScroll();
    measureViewport();
    const tops: number[] = [];
    for (
      let r = topSpacerRef.current?.nextElementSibling;
      r && tops.length < 8 && !r.classList.contains("virtual-spacer");
      r = r.nextElementSibling
    ) {
      tops.push(r.getBoundingClientRect().top);
    }
    const h = rowPitch(tops, 0);
    if (h > 0 && Math.abs(h - rowHeight) > 0.1) setRowHeight(h);
  });

  const { start: windowStart, end: windowEnd } = virtual
    ? virtualWindow(
        visibleBlobs.length,
        viewport.offset,
        viewport.height,
        rowHeight,
        VIRTUAL_OVERSCAN,
      )
    : { start: 0, end: visibleBlobs.length };

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

  /* ---------- tabbed previews ---------- */

  function openPreviewTab(
    name: string,
    size?: number,
    containerOverride?: string,
  ): void {
    const cont = (containerOverride ?? containerRef.current ?? "").trim();
    if (cont === "") return;
    const key = `${cont}/${name}`;
    setPreviewTabs((prev) =>
      prev.some((t) => t.key === key)
        ? prev
        : [...prev, { key, container: cont, name, size }],
    );
    setActiveTab(key);
    setCtx(null);
  }

  function closePreviewTab(key: string): void {
    setPreviewTabs((prev) => prev.filter((t) => t.key !== key));
    setActiveTab((cur) => (cur === key ? null : cur));
  }

  function dropTabsForNames(containerName: string, names: string[]): void {
    const gone = new Set(names);
    setPreviewTabs((prev) =>
      prev.filter((t) => !(t.container === containerName && gone.has(t.name))),
    );
    setActiveTab((cur) => {
      if (cur === null) return cur;
      const tab = previewTabs.find((t) => t.key === cur);
      if (tab && tab.container === containerName && gone.has(tab.name))
        return null;
      return cur;
    });
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

  function copyPaths(keys: string[]): void {
    const text = keys.map((k) => k.replace(/\/$/, "")).join("\n");
    void navigator.clipboard
      ?.writeText(text)
      .then(() =>
        flash(
          keys.length === 1 ? "Path copied" : `${keys.length} paths copied`,
        ),
      )
      .catch(() => undefined);
    setCtx(null);
  }

  /* ---------- CRUD ---------- */

  async function run(
    label: string,
    fn: () => Promise<string | void>,
  ): Promise<void> {
    setBusy(label);
    setActionError(null);
    try {
      const msg = await fn();
      if (msg) flash(msg);
      reloadBlobs();
    } catch (err) {
      fail(err, "action");
    } finally {
      setBusy(null);
    }
  }

  function onNewContainer(): void {
    if (!accountId) return;
    setPrompt({
      title: "New container",
      label: "Container name",
      placeholder: "mycontainer",
      hint: "Lowercase letters, numbers and dashes · 3–63 chars.",
      confirmLabel: "Create",
      validate: (v) =>
        /^[a-z0-9]([a-z0-9-]{1,61}[a-z0-9])?$/.test(v)
          ? null
          : "Use 3–63 lowercase letters, numbers and dashes.",
      submit: async (v) => {
        setBusy("container");
        try {
          await window.api.storage.createContainer({ accountId, container: v });
          flash(`Container "${v}" created`);
          loadContainers(accountId, v);
          props.onContainersChanged(accountId);
        } catch (err) {
          fail(err, "action");
          throw err;
        } finally {
          setBusy(null);
        }
      },
    });
  }

  function onDeleteContainer(name: string): void {
    if (!accountId) return;
    setConfirm({
      title: `Delete container "${name}"?`,
      body: "Everything inside is permanently deleted. This cannot be undone.",
      requireText: name,
      confirmLabel: "Delete",
      run: async () => {
        setBusy("container");
        try {
          await window.api.storage.deleteContainer({
            accountId,
            container: name,
          });
          flash(`Container "${name}" deleted`);
          if (container === name) {
            switchContainer(null);
            setBlobs(null);
            resetNav();
          }
          loadContainers(accountId);
          props.onContainersChanged(accountId);
        } catch (err) {
          fail(err, "action");
          throw err;
        } finally {
          setBusy(null);
        }
      },
    });
  }

  function onNewFolder(): void {
    if (!accountId || !container) return;
    setPrompt({
      title: "New folder",
      label: "Folder name",
      placeholder: "reports",
      hint: "A single folder level — slashes are not allowed.",
      confirmLabel: "Create",
      validate: (v) =>
        v === "" || v.includes("/")
          ? "Use a single folder name without slashes."
          : null,
      submit: async (v) => {
        await run("folder", async () => {
          await window.api.storage.createFolder({
            accountId,
            container,
            prefix: blobs?.prefix || undefined,
            folderName: v,
          });
          return `Folder "${v}" created`;
        });
      },
    });
  }

  function onUpload(): void {
    if (!accountId || !container) return;
    setBusy("upload");
    setActionError(null);
    window.api.transfers
      .upload({ accountId, container, prefix: blobs?.prefix || undefined })
      .catch((err: unknown) => fail(err, "action"))
      .finally(() => setBusy(null));
  }

  function onDownload(): void {
    if (!accountId || !container || selection.size === 0) return;
    if ([...selection].some((k) => deletedKeys.has(k))) {
      flash("Restore deleted blobs before downloading, or deselect them.");
      return;
    }
    setBusy("download");
    setActionError(null);
    window.api.transfers
      .download({ accountId, container, names: [...selection] })
      .catch((err: unknown) => fail(err, "action"))
      .finally(() => setBusy(null));
  }

  function onPreviewDownload(containerName: string, name: string): void {
    if (!accountId || !containerName) return;
    setBusy("download");
    setActionError(null);
    window.api.transfers
      .download({ accountId, container: containerName, names: [name] })
      .catch((err: unknown) => fail(err, "action"))
      .finally(() => setBusy(null));
  }

  function onDelete(): void {
    if (!accountId || !container || selection.size === 0) return;
    if ([...selection].some((k) => deletedKeys.has(k))) {
      flash(
        "Restore deleted blobs first — deleting them again removes them permanently.",
      );
      return;
    }
    // Expand folders first so the confirm shows the true blast radius —
    // what you see is exactly what will be deleted.
    const sel = [...selection];
    setBusy("delete");
    setActionError(null);
    window.api.storage
      .expandBlobs({ accountId, container, names: sel })
      .then((flat) => {
        const files = flat.filter((n) => !n.endsWith("/"));
        const targets = files.length > 0 ? files : sel;
        setConfirm({
          title: `Delete ${targets.length} item${targets.length === 1 ? "" : "s"}?`,
          body: "Blobs are permanently deleted. Folders delete everything beneath them.",
          items: targets,
          confirmLabel: "Delete",
          run: async () => {
            await run("delete", async () => {
              const count = await window.api.storage.deleteBlobs({
                accountId,
                container,
                names: sel,
              });
              dropTabsForNames(container, sel);
              return `Deleted ${count} item${count === 1 ? "" : "s"}`;
            });
          },
        });
      })
      .catch((err: unknown) => fail(err, "action"))
      .finally(() => setBusy(null));
  }

  function onRename(): void {
    if (!accountId || !container) return;
    const picked = [...selection].filter((k) => !k.endsWith("/"));
    if (picked.length !== 1 || deletedKeys.has(picked[0]!)) return;
    const src = picked[0]!;
    const currentLeaf = src.includes("/")
      ? src.slice(src.lastIndexOf("/") + 1)
      : src;
    setPrompt({
      title: "Rename file",
      label: "New file name",
      initial: currentLeaf,
      confirmLabel: "Rename",
      validate: (v) =>
        v === "" || v.includes("/") ? "Use a file name without slashes." : null,
      submit: async (v) => {
        if (v === currentLeaf) return;
        await run("rename", async () => {
          // Main returns the full destination blob path.
          const destFull = await window.api.storage.renameBlob({
            accountId,
            container,
            source: src,
            destLeaf: v,
          });
          setPreviewTabs((prev) =>
            prev.map((t) =>
              t.container === container && t.name === src
                ? { ...t, name: destFull, key: `${container}/${destFull}` }
                : t,
            ),
          );
          setActiveTab((cur) =>
            cur === `${container}/${src}` ? `${container}/${destFull}` : cur,
          );
          return `Renamed to "${v}"`;
        });
      },
    });
  }

  function onMoveOrCopy(mode: "move" | "copy"): void {
    if (!accountId || !container || selection.size === 0) return;
    setMoveCopy({ mode, names: [...selection] });
  }

  /** Runs the picked move/copy. Throws on failure so the picker stays open. */
  async function submitMoveCopy(
    dest: string,
    overwrite: boolean,
  ): Promise<void> {
    const job = moveCopy;
    if (!accountId || !container || !job) return;
    const { mode, names: sel } = job;
    const past = mode === "move" ? "Moved" : "Copied";
    setBusy(mode);
    setActionError(null);
    try {
      const count =
        mode === "move"
          ? await window.api.storage.moveBlobs({
              accountId,
              container,
              names: sel,
              destPrefix: dest || undefined,
              overwrite,
            })
          : await window.api.storage.copyBlobs({
              accountId,
              container,
              names: sel,
              destPrefix: dest || undefined,
              overwrite,
            });
      if (mode === "move") {
        // Close previews of blobs that no longer exist at their old path.
        const removed = new Set(
          previewTabs
            .filter(
              (t) => t.container === container && isSelectedPath(t.name, sel),
            )
            .map((t) => t.key),
        );
        if (removed.size > 0) {
          setPreviewTabs((prev) => prev.filter((t) => !removed.has(t.key)));
          setActiveTab((cur) => (cur && removed.has(cur) ? null : cur));
        }
      }
      flash(
        `${past} ${count} item${count === 1 ? "" : "s"}${dest ? ` to "${dest}"` : " to container root"}`,
      );
      reloadBlobs();
    } finally {
      setBusy(null);
    }
  }

  function onRestore(): void {
    if (!accountId || !container) return;
    const names = [...selection].filter(
      (k) => !k.endsWith("/") && deletedKeys.has(k),
    );
    if (names.length === 0) return;
    void run("restore", async () => {
      const count = await window.api.storage.undeleteBlobs({
        accountId,
        container,
        names,
      });
      return `Restored ${count} item${count === 1 ? "" : "s"}`;
    });
  }

  /* ---------- ⌘K palette hooks (palette-bus.ts) ---------- */

  function blobUrl(name: string): string {
    const base = (account?.endpoint ?? "").replace(/\/+$/, "");
    const path = [
      container ?? "",
      ...name.replace(/\/$/, "").split("/"),
    ].filter(Boolean);
    return `${base}/${path.map(encodeURIComponent).join("/")}${name.endsWith("/") ? "/" : ""}`;
  }

  function copyUrls(): void {
    if (!container) return;
    const keys =
      selection.size > 0 ? [...selection] : [navPrefix ? `${navPrefix}/` : ""];
    void navigator.clipboard
      ?.writeText(keys.map(blobUrl).join("\n"))
      .then(() =>
        flash(keys.length === 1 ? "URL copied" : `${keys.length} URLs copied`),
      )
      .catch(() => undefined);
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

  function onUploadFolder(): void {
    if (!accountId || !container) return;
    setBusy("upload");
    setActionError(null);
    window.api.transfers
      .upload({
        accountId,
        container,
        prefix: blobs?.prefix || undefined,
        folder: true,
      })
      .catch((err: unknown) => fail(err, "action"))
      .finally(() => setBusy(null));
  }

  /* ---------- drag and drop upload (Finder → current folder / folder row) ---------- */

  function canDropFiles(): boolean {
    if (!accountId || !container || activeTab !== null) return false;
    if (confirm || prompt || moveCopy || historyFor) return false;
    // Any other sheet (admin, SAS, settings…) also blocks drops.
    return document.querySelector(".modal-backdrop") === null;
  }

  function endDrag(): void {
    dragDepth.current = 0;
    setDropActive(false);
    setDropFolder(null);
  }

  function folderUnder(target: EventTarget | null): string | null {
    const el = target instanceof Element ? target : null;
    return (
      el?.closest("tr[data-drop-folder]")?.getAttribute("data-drop-folder") ??
      null
    );
  }

  const dropHandlers = {
    onDragEnter: (e: React.DragEvent): void => {
      if (!isFileDrag(e.dataTransfer.types)) return;
      e.preventDefault();
      if (!canDropFiles()) return;
      dragDepth.current += 1;
      if (!dropActive) setDropActive(true);
    },
    onDragOver: (e: React.DragEvent): void => {
      if (!isFileDrag(e.dataTransfer.types)) return;
      e.preventDefault();
      if (!canDropFiles()) {
        e.dataTransfer.dropEffect = "none";
        if (dropActive) endDrag();
        return;
      }
      e.dataTransfer.dropEffect = "copy";
      if (!dropActive) setDropActive(true);
      const folder = folderUnder(e.target);
      if (folder !== dropFolder) setDropFolder(folder);
    },
    onDragLeave: (e: React.DragEvent): void => {
      if (!isFileDrag(e.dataTransfer.types)) return;
      dragDepth.current = Math.max(0, dragDepth.current - 1);
      if (dragDepth.current === 0) endDrag();
    },
    onDrop: (e: React.DragEvent): void => {
      if (!isFileDrag(e.dataTransfer.types)) return;
      e.preventDefault();
      const folder = folderUnder(e.target);
      endDrag();
      if (!canDropFiles() || !accountId || !container) return;
      const paths = Array.from(e.dataTransfer.files)
        .map((f) => window.api.files.pathFor(f))
        .filter((p) => p !== "");
      if (paths.length === 0) {
        flash("Only files and folders from Finder can be uploaded.");
        return;
      }
      const prefix = folder ?? (blobs?.prefix || undefined);
      setBusy("upload");
      setActionError(null);
      window.api.transfers
        .upload({ accountId, container, prefix, paths })
        .then((ids) => {
          if (ids.length === 0)
            flash("Nothing to upload — the folder is empty.");
          else
            flash(
              `Uploading ${ids.length} file${ids.length === 1 ? "" : "s"} to ${dropTargetLabel(container, prefix)}`,
            );
        })
        .catch((err: unknown) => fail(err, "action"))
        .finally(() => setBusy(null));
    },
  };

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

  function copyEndpoint(): void {
    const endpoint = account?.endpoint;
    if (!endpoint) return;
    void navigator.clipboard
      ?.writeText(endpoint)
      .then(() => {
        setCopiedEndpoint(true);
        window.setTimeout(() => setCopiedEndpoint(false), 1400);
      })
      .catch(() => undefined);
  }

  function retryCurrent(): void {
    if (!accountId) return;
    setActionError(null);
    if (!containerRef.current) loadContainers(accountId);
    else reloadBlobs();
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

  // Portaled to <body> so no transformed/animated ancestor can re-anchor position:fixed.
  const ctxMenu = ctx
    ? createPortal(
        <>
          <div
            className="ctx-overlay"
            onClick={() => setCtx(null)}
            onContextMenu={() => setCtx(null)}
          />
          <div
            ref={ctxRef}
            className="ctx-menu glass strong"
            role="menu"
            style={{ left: `${ctx.x}px`, top: `${ctx.y}px` }}
            onClick={(e) => e.stopPropagation()}
          >
            {ctx.keys.length === 0 ? (
              <>
                <button
                  role="menuitem"
                  onClick={() => {
                    setCtx(null);
                    onUpload();
                  }}
                >
                  Upload files…
                </button>
                <button
                  role="menuitem"
                  onClick={() => {
                    setCtx(null);
                    onNewFolder();
                  }}
                >
                  New folder…
                </button>
                <button
                  role="menuitem"
                  onClick={() => {
                    setCtx(null);
                    toggleAll(visibleBlobs.map(keyOf));
                  }}
                >
                  Select all
                </button>
                <div className="ctx-sep" aria-hidden />
                <button
                  role="menuitem"
                  onClick={() => {
                    setCtx(null);
                    retryCurrent();
                  }}
                >
                  Refresh
                </button>
              </>
            ) : (
              <>
                {ctx.keys.length === 1 && !ctx.keys[0]!.endsWith("/") && (
                  <button
                    role="menuitem"
                    onClick={() => {
                      const item = visibleBlobs.find(
                        (b) => keyOf(b) === ctx.keys[0],
                      );
                      setCtx(null);
                      if (item && !item.isPrefix)
                        openPreviewTab(item.name, item.size);
                    }}
                  >
                    Preview
                  </button>
                )}
                <button
                  role="menuitem"
                  onClick={() => {
                    setCtx(null);
                    onDownload();
                  }}
                >
                  Download{ctx.keys.length > 1 ? ` (${ctx.keys.length})` : ""}
                </button>
                <button role="menuitem" onClick={() => copyPaths(ctx.keys)}>
                  Copy path
                </button>
                {ctx.keys.length === 1 &&
                  !ctx.keys[0]!.endsWith("/") &&
                  !deletedKeys.has(ctx.keys[0]!) &&
                  !isDfs && (
                    <button
                      role="menuitem"
                      onClick={() => {
                        const cur = containerRef.current;
                        const key = ctx.keys[0]!;
                        setCtx(null);
                        if (cur) setHistoryFor({ container: cur, name: key });
                      }}
                    >
                      Version history…
                    </button>
                  )}
                {ctx.keys.some((k) => deletedKeys.has(k)) && (
                  <button
                    role="menuitem"
                    onClick={() => {
                      setCtx(null);
                      onRestore();
                    }}
                  >
                    Restore
                  </button>
                )}
                {ctx.keys.length === 1 && !ctx.keys[0]!.endsWith("/") && (
                  <button
                    role="menuitem"
                    onClick={() => {
                      setCtx(null);
                      onRename();
                    }}
                  >
                    Rename…
                  </button>
                )}
                <button
                  role="menuitem"
                  onClick={() => {
                    setCtx(null);
                    onMoveOrCopy("move");
                  }}
                >
                  Move to…
                </button>
                <button
                  role="menuitem"
                  onClick={() => {
                    setCtx(null);
                    onMoveOrCopy("copy");
                  }}
                >
                  Copy to…
                </button>
                <div className="ctx-sep" aria-hidden />
                <button
                  role="menuitem"
                  className="danger"
                  onClick={() => {
                    setCtx(null);
                    onDelete();
                  }}
                >
                  Delete{ctx.keys.length > 1 ? ` (${ctx.keys.length})` : ""}
                </button>
              </>
            )}
          </div>
        </>,
        document.body,
      )
    : null;

  const toolbarFilter = (
    <label className="toolbar-filter" title="Search (⌘F)">
      <Icon name="search" size={14} />
      <input
        ref={filterRef}
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        placeholder="Search…"
        aria-label="Search current view"
      />
      {filter && (
        <button
          className="mini-btn"
          onClick={() => setFilter("")}
          aria-label="Clear search"
          title="Clear search"
        >
          <Icon name="close" size={13} />
        </button>
      )}
    </label>
  );

  const historyButtons = (
    <div className="nav-btns">
      <button
        className="nav-btn"
        onClick={goBack}
        disabled={backHist.length === 0}
        title="Back"
        aria-label="Back"
      >
        <Icon name="back" />
      </button>
      <button
        className="nav-btn"
        onClick={goForward}
        disabled={fwdHist.length === 0}
        title="Forward"
        aria-label="Forward"
      >
        <Icon name="forward" />
      </button>
      <button
        className="nav-btn"
        onClick={goUp}
        disabled={navPrefix === "" && (scoped || !container)}
        title="Up one level"
        aria-label="Up one level"
      >
        <Icon name="up" />
      </button>
      <button
        className="nav-btn"
        onClick={retryCurrent}
        disabled={!accountId || loadingContainers || loadingList}
        title="Refresh"
        aria-label="Refresh"
      >
        <Icon name="refresh" />
      </button>
    </div>
  );

  const actionBar = (
    <div className="actionbar" role="toolbar" aria-label="Blob actions">
      <Action
        icon="upload"
        label="Upload"
        keepLabel
        primary
        onClick={onUpload}
        disabled={!container || busy !== null}
        working={busy === "upload"}
        workingLabel="Uploading…"
      />
      <Action
        icon="download"
        label={`Download${selection.size > 0 ? ` (${selection.size})` : ""}`}
        keepLabel
        onClick={onDownload}
        disabled={selection.size === 0 || hasDeletedSel || busy !== null}
      />
      <Action
        icon="folderPlus"
        label="New folder"
        onClick={onNewFolder}
        disabled={!container || busy !== null}
      />
      <Action
        icon="selectAll"
        label="Select all"
        onClick={() => toggleAll(visibleBlobs.map(keyOf))}
        disabled={visibleBlobs.length === 0}
      />
      <Action
        icon="archive"
        label="Deleted"
        pressed={showDeleted}
        primary={showDeleted}
        onClick={() => setShowDeleted((v) => !v)}
        disabled={isDfs || !container || busy !== null}
      />
      <span className="action-sep" aria-hidden />
      <Action
        icon="eye"
        label="Preview"
        keepLabel
        onClick={() =>
          previewFile && openPreviewTab(previewFile.name, previewFile.size)
        }
        disabled={!previewFile || busy !== null}
      />
      <Action
        icon="pencil"
        label="Rename"
        onClick={onRename}
        disabled={!canRename || busy !== null}
      />
      <Action
        icon="restore"
        label={`Restore${selection.size > 0 && hasDeletedSel ? ` (${selection.size})` : ""}`}
        onClick={onRestore}
        disabled={!hasDeletedSel || busy !== null}
      />
      <Action
        icon="move"
        label="Move to…"
        onClick={() => onMoveOrCopy("move")}
        disabled={selection.size === 0 || hasDeletedSel || busy !== null}
      />
      <Action
        icon="copy"
        label="Copy to…"
        onClick={() => onMoveOrCopy("copy")}
        disabled={selection.size === 0 || hasDeletedSel || busy !== null}
      />
      <Action
        icon="trash"
        label={`Delete${selection.size > 0 ? ` (${selection.size})` : ""}`}
        keepLabel
        danger
        onClick={onDelete}
        disabled={selection.size === 0 || hasDeletedSel || busy !== null}
      />
    </div>
  );

  const addressStrip = (
    <nav className="address-strip" aria-label="Path">
      {scoped ? (
        <button
          className="crumb addr-acct"
          onClick={() => go("")}
          title={`${account.name}\n${account.endpoint}`}
        >
          {container ?? displayAccount}
        </button>
      ) : (
        <>
          <button
            className="crumb addr-acct"
            onClick={() => {
              switchContainer(null);
              resetNav();
            }}
            title={`${account.name}\n${account.endpoint}`}
          >
            {displayAccount}
          </button>
          {container && (
            <>
              <span className="sep">/</span>
              <button className="crumb root" onClick={() => go("")}>
                {container}
              </button>
            </>
          )}
        </>
      )}
      {crumbs.map((seg, i) => (
        <span key={i} className="crumb-seg">
          <span className="sep">/</span>
          <button
            className="crumb"
            onClick={() => go(crumbs.slice(0, i + 1).join("/"))}
          >
            {seg}
          </button>
        </span>
      ))}
      {navPrefix === "" && !container && (
        <span className="muted small address-hint">
          {containers.length > 0 ? `${containers.length} containers` : ""}
        </span>
      )}
    </nav>
  );

  // ----- account level: container directory -----
  if (!container) {
    const viewError = actionError ?? containersError;
    const showEmpty =
      !loadingContainers && !viewError && visibleContainers.length === 0;
    return (
      <div className="explorer explorer-panel fade-in">
        <header className="explorer-toolbar">
          <div className="toolbar-left">
            {historyButtons}
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
            {toolbarFilter}
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
          {(container || crumbs.length > 0) && addressStrip}
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
          {historyButtons}
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
          {toolbarFilter}
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
          {actionBar}
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
            {addressStrip}
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

interface RowHandlers {
  click: (e: React.MouseEvent, key: string) => void;
  open: (item: StorageBlobItem) => void;
  context: (e: React.MouseEvent, key: string) => void;
  toggle: (key: string) => void;
}

/** One blob/folder row. Memoized: a selection change re-renders only the rows it touches. */
const BlobRow = memo(function BlobRow(props: {
  item: StorageBlobItem;
  rowKey: string;
  index: number;
  id: string;
  active: boolean;
  selected: boolean;
  animate: boolean;
  handlers: RowHandlers;
  /** A file drag is hovering this folder row. */
  dropTarget?: boolean;
}): React.JSX.Element {
  const { item, rowKey: key, handlers } = props;
  return (
    <tr
      id={props.id}
      data-drop-folder={item.isPrefix && !item.deleted ? item.name : undefined}
      data-index={props.index}
      aria-rowindex={props.index + 2}
      aria-selected={props.selected}
      className={`row-in${props.animate ? "" : " no-anim"} clickable${props.selected ? " selected" : ""}${props.active ? " kb-active" : ""}${item.deleted ? " deleted" : ""}${props.dropTarget ? " drop-target" : ""}`}
      style={
        props.animate
          ? { animationDelay: `${Math.min(props.index, 10) * 12}ms` }
          : undefined
      }
      onClick={(e) => handlers.click(e, key)}
      onDoubleClick={() => handlers.open(item)}
      onContextMenu={(e) => handlers.context(e, key)}
      title={
        item.isPrefix
          ? "Open folder"
          : item.deleted
            ? "Deleted — restore to use"
            : "Double-click to preview · right-click for actions"
      }
    >
      <td className="check-col" onClick={(e) => e.stopPropagation()}>
        <input
          type="checkbox"
          aria-label={`Select ${item.leaf}`}
          checked={props.selected}
          onChange={() => handlers.toggle(key)}
          onClick={(e) => e.stopPropagation()}
        />
      </td>
      <td className="name-col">
        <span className="file-row" title={item.name}>
          <span
            className={`file-ico ${item.isPrefix ? "folder" : "file"}`}
            aria-hidden
          />
          {item.leaf}
          {item.deleted && <span className="pill warn row-badge">deleted</span>}
        </span>
      </td>
      <td className="num">{item.isPrefix ? "—" : formatBytes(item.size)}</td>
      <td className="muted">{formatWhen(item.lastModified)}</td>
    </tr>
  );
});

function Action(props: {
  icon: IconName;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  primary?: boolean;
  danger?: boolean;
  /** Toggle buttons (Deleted) report their state. */
  pressed?: boolean;
  /** Keep the text label when the toolbar is too narrow for every label. */
  keepLabel?: boolean;
  working?: boolean;
  workingLabel?: string;
}): React.JSX.Element {
  const label = props.working
    ? (props.workingLabel ?? props.label)
    : props.label;
  return (
    <button
      className={`action${props.primary ? " primary" : ""}${props.danger ? " danger" : ""}${props.keepLabel ? " keep-label" : ""}`}
      onClick={props.onClick}
      disabled={props.disabled}
      aria-label={label}
      aria-pressed={props.pressed}
      title={label}
    >
      <span className="action-icon" aria-hidden>
        <Icon name={props.icon} size={16} />
      </span>
      <span className="action-label">{label}</span>
    </button>
  );
}

function Th(props: {
  label: string;
  k: "name" | "size" | "modified";
  sortKey: string;
  dir: 1 | -1;
  onSort: (k: "name" | "size" | "modified") => void;
  wide?: boolean;
  width?: number;
  resizeKey?: "size" | "modified";
  onResizeStart?: (e: React.MouseEvent, key: "size" | "modified") => void;
  onResetWidths?: () => void;
}): React.JSX.Element {
  const active = props.sortKey === props.k;
  return (
    <th
      className={`${props.wide ? "wide" : ""}${props.resizeKey ? " resizable" : ""}`}
      style={
        props.width
          ? {
              width: `${props.width}px`,
              minWidth: `${props.width}px`,
              maxWidth: `${props.width}px`,
            }
          : undefined
      }
    >
      <button
        className={`th-btn${active ? " active" : ""}`}
        onClick={() => props.onSort(props.k)}
      >
        {props.label}
        <span className="sort-arrow" aria-hidden>
          {active ? (
            <Icon name={props.dir === 1 ? "up" : "down"} size={12} />
          ) : null}
        </span>
      </button>
      {props.resizeKey && props.onResizeStart && (
        <span
          className="col-resizer"
          onMouseDown={(e) => props.onResizeStart!(e, props.resizeKey!)}
          onDoubleClick={(e) => {
            e.stopPropagation();
            props.onResetWidths?.();
          }}
          title="Drag to resize · double-click to reset"
          aria-hidden
        />
      )}
    </th>
  );
}
