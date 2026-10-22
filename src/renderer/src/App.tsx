import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";
import { APP_NAME, APP_TAGLINE } from "../../shared/config";
import type {
  AccountCapabilities,
  AccountSummary,
  SysInfo,
} from "../../shared/types";
import {
  entryOf,
  needsLoad,
  nextTreeFocus,
  readyListings,
  treeReducer,
  visibleSlice,
} from "../../shared/container-tree";
import logoUrl from "./assets/logo.png";
import Explorer from "./views/Explorer";
import HomeView from "./views/Home";
import ConnectWizard from "./views/ConnectWizard";
import TransfersPanel from "./views/TransfersPanel";
import { ConfirmDialog, PromptDialog } from "./views/Dialogs";
import {
  DEFAULT_PREFS,
  accentVars,
  loadPrefs,
  savePrefs,
  SettingsView,
  type Prefs,
} from "./views/Settings";
import { REVEAL_UPDATES_KEY } from "./views/UpdateSettings";
import { sendPanelAction } from "./palette-bus";
import {
  BrandEasterEgg,
  useBrandTripleClick,
} from "./views/easter-egg/BrandEasterEgg";
import { Icon } from "./views/Icon";
import { ContextMenu, type MenuEntry } from "./views/ContextMenu";
import { SasDialog, type SasScope } from "./views/SasDialog";
import {
  ContainerPropertiesDialog,
  CorsDialog,
  LeaseAcquiredDialog,
  PublicAccessDialog,
  SoftDeleteDialog,
  StoredPoliciesDialog,
} from "./views/AdminDialogs";
import { stripIpcWrapper } from "./views/errors";
import { createSidebarPeek, type PeekZone } from "../../shared/sidebar-peek";
import { hoverMayOpen } from "../../shared/dock-view";

const CONTAINER_NAME_RE = /^[a-z0-9]([a-z0-9-]{1,61}[a-z0-9])?$/;

type SidebarMenu =
  | { kind: "account"; x: number; y: number; account: AccountSummary }
  | { kind: "group"; x: number; y: number; account: AccountSummary }
  | {
      kind: "container";
      x: number;
      y: number;
      account: AccountSummary;
      container: string;
    };

/** Lease state per `${accountId}/${container}`, read when its menu opens. */
type LeaseProbe = { state: string; error?: string };

function errMessage(err: unknown): string {
  return stripIpcWrapper(err instanceof Error ? err.message : String(err));
}

const CommandPalette = lazy(() => import("./views/CommandPalette"));

export interface SelectionTarget {
  accountId: string;
  container: string | null;
  /** Folder to open inside `container` (⌘K recent folders). */
  prefix?: string;
  /** Re-list even if it's already the open container (sidebar Refresh). */
  reload?: boolean;
  tick: number;
}

export default function App(): React.JSX.Element {
  const [accounts, setAccounts] = useState<AccountSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [target, setTarget] = useState<SelectionTarget | null>(null);
  const [showWizard, setShowWizard] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  // Update notifications: dot on the Settings button; a notification click opens About & updates.
  const [updateBadge, setUpdateBadge] = useState(false);
  useEffect(() => {
    void window.api.updates
      .get()
      .then((u) => setUpdateBadge(u.showBadge))
      .catch(() => undefined);
    const offChanged = window.api.updates.onChanged((u) =>
      setUpdateBadge(u.showBadge),
    );
    const offReveal = window.api.updates.onReveal(() => {
      sessionStorage.setItem(REVEAL_UPDATES_KEY, "1");
      setShowSettings(true);
    });
    return () => {
      offChanged();
      offReveal();
    };
  }, []);
  const [prefs, setPrefs] = useState<Prefs>(() => loadPrefs());
  const brandEgg = useBrandTripleClick();
  const [platform, setPlatform] = useState<SysInfo["platform"] | null>(null);
  const [encAvailable, setEncAvailable] = useState<boolean | null>(null);
  const [appVersion, setAppVersion] = useState<string | null>(null);
  const [sidebarWidth, setSidebarWidth] = useState<number>(() => {
    const saved = localStorage.getItem("blobfish.sidebarWidth");
    if (saved) {
      const parsed = parseInt(saved, 10);
      if (!Number.isNaN(parsed) && parsed >= 260 && parsed <= 600)
        return parsed;
    }
    return 340;
  });
  const [isDraggingSidebar, setIsDraggingSidebar] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(() => {
    try {
      return localStorage.getItem("blobfish.sidebarCollapsed") === "1";
    } catch {
      return false;
    }
  });

  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  // "Blob Containers" node per account; open by default so expanding an account lists its containers.
  const [groupOpen, setGroupOpen] = useState<Record<string, boolean>>({});
  const [tree, dispatchTree] = useReducer(treeReducer, {});
  const treeRef = useRef(tree);
  treeRef.current = tree;
  const treeSeq = useRef(0);
  const inflight = useRef<Record<string, number>>({});
  const containersCache = useMemo(() => readyListings(tree), [tree]);
  const [caps, setCaps] = useState<Record<string, AccountCapabilities>>({});
  const [menu, setMenu] = useState<SidebarMenu | null>(null);
  const [lease, setLease] = useState<Record<string, LeaseProbe>>({});
  const [sasFor, setSasFor] = useState<{
    account: AccountSummary;
    scope: SasScope;
  } | null>(null);
  const [adminFor, setAdminFor] = useState<
    | {
        kind: "policies" | "public" | "properties";
        accountId: string;
        container: string;
      }
    | { kind: "cors" | "softDelete"; account: AccountSummary }
    | { kind: "lease"; container: string; leaseId: string }
    | null
  >(null);
  const [openByNameFor, setOpenByNameFor] = useState<string | null>(null);
  const [breakLeaseFor, setBreakLeaseFor] = useState<{
    accountId: string;
    name: string;
  } | null>(null);
  const [sideNotice, setSideNotice] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [detachFor, setDetachFor] = useState<AccountSummary | null>(null);
  const [createFor, setCreateFor] = useState<string | null>(null);
  const [renameContainerFor, setRenameContainerFor] = useState<{
    accountId: string;
    name: string;
  } | null>(null);
  const [deleteContainerFor, setDeleteContainerFor] = useState<{
    accountId: string;
    name: string;
  } | null>(null);
  const [quickOpen, setQuickOpen] = useState(true);
  const [allOpen, setAllOpen] = useState(true);
  const [attachedOpen, setAttachedOpen] = useState(true);
  const [secretError, setSecretError] = useState<string | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);

  // Collapsed sidebar hover-peek: a floating popover off the toggle / left edge.
  const [peekOpen, setPeekOpen] = useState(false);
  const [peek] = useState(() => createSidebarPeek({ onChange: setPeekOpen }));
  const peekMountedAt = useRef(performance.now());
  const asideRef = useRef<HTMLElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const sidebarShown = !sidebarCollapsed || peekOpen;

  const refreshAccounts = useCallback(() => {
    window.api.accounts
      .list()
      .then((list) => {
        setAccounts(list);
        // Launch (and removals) land on the dashboard — never auto-pick.
        setSelectedId((prev) =>
          prev && list.some((a) => a.id === prev) ? prev : null,
        );
      })
      .catch(console.error);
  }, []);

  useEffect(() => {
    refreshAccounts();
    window.api.sys
      .info()
      .then((s) => setPlatform(s.platform))
      .catch(console.error);
    window.api.accounts
      .encryption()
      .then(setEncAvailable)
      .catch(() => setEncAvailable(false));
    window.api.app
      .version()
      .then(setAppVersion)
      .catch(() => setAppVersion(null));
  }, [refreshAccounts]);

  // Persist prefs + apply native vibrancy (macOS only; harmless elsewhere).
  // Persist prefs + apply native vibrancy (macOS only; harmless elsewhere).
  // Transfer tuning is debounced — slider drags would otherwise spam IPC.
  useEffect(() => {
    savePrefs(prefs);
    if (platform === "darwin") {
      window.api.glass
        .set(prefs.vibrancy ? "fullscreen-ui" : null)
        .catch(console.error);
    }
    const timer = window.setTimeout(() => {
      window.api.transfers
        .configure({
          uploadConcurrency: prefs.uploadConcurrency,
          maxParallel: prefs.maxParallel,
        })
        .catch(console.error);
    }, 250);
    return () => window.clearTimeout(timer);
  }, [prefs, platform]);

  // Drag-to-resize sidebar width
  useEffect(() => {
    try {
      localStorage.setItem(
        "blobfish.sidebarCollapsed",
        sidebarCollapsed ? "1" : "0",
      );
    } catch {
      // Storage blocked — collapse state just won't persist.
    }
  }, [sidebarCollapsed]);

  useEffect(() => {
    peek.setEnabled(sidebarCollapsed);
  }, [peek, sidebarCollapsed]);
  useEffect(() => () => peek.dispose(), [peek]);

  // Anything spawned from the peeked sidebar (its context menu, a dialog) keeps it open.
  const sidebarDialogOpen =
    showWizard ||
    sasFor !== null ||
    adminFor !== null ||
    openByNameFor !== null ||
    breakLeaseFor !== null ||
    detachFor !== null ||
    createFor !== null ||
    renameContainerFor !== null ||
    deleteContainerFor !== null;
  useEffect(() => {
    peek.hold("menu", menu !== null);
  }, [peek, menu]);
  useEffect(() => {
    peek.hold("dialog", sidebarDialogOpen);
  }, [peek, sidebarDialogOpen]);

  // Peek open: Escape or a click outside the popover closes it.
  useEffect(() => {
    if (!peekOpen) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      if (document.querySelector(".ctx-menu, .modal-backdrop")) return;
      const hadFocus = asideRef.current?.contains(document.activeElement);
      peek.dismiss();
      if (hadFocus) toggleRef.current?.focus();
    };
    const onDown = (e: PointerEvent): void => {
      const t = e.target as Element | null;
      if (!t?.closest) return;
      if (
        asideRef.current?.contains(t) ||
        t.closest(".sidebar-toggle, .ctx-menu, .modal-backdrop")
      )
        return;
      peek.dismiss();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onDown, true);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onDown, true);
    };
  }, [peek, peekOpen]);

  // Hover zones only arm on a real pointer move (Chromium sends a synthetic one at launch).
  function peekMove(zone: PeekZone) {
    return (e: React.PointerEvent): void =>
      peek.enter(
        zone,
        hoverMayOpen(
          performance.now() - peekMountedAt.current,
          e.movementX,
          e.movementY,
        ),
      );
  }

  // ⌘B / Ctrl+B toggles the sidebar; Esc re-opens nothing, it just closes menus.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "b") {
        e.preventDefault();
        setSidebarCollapsed((v) => !v);
      }
      // ⌘, opens Settings (sidebar footer gear).
      if (
        (e.metaKey || e.ctrlKey) &&
        !e.shiftKey &&
        !e.altKey &&
        e.key === ","
      ) {
        if (document.querySelector(".modal-backdrop")) return;
        e.preventDefault();
        setShowSettings(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // ⌘K / Ctrl+K toggles the command palette. Capture phase so inputs can't swallow it;
  // ignored while another modal (wizard, confirm, preview) owns the screen.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (
        !(e.metaKey || e.ctrlKey) ||
        e.shiftKey ||
        e.altKey ||
        e.key.toLowerCase() !== "k"
      )
        return;
      if (document.querySelector(".modal-backdrop:not(.palette-backdrop)"))
        return;
      e.preventDefault();
      e.stopPropagation();
      setPaletteOpen((v) => !v);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);

  // Drag-to-resize sidebar width. The live width is mirrored to a ref so
  // mouse-up persists the final value, not the stale closure at drag start.
  const sidebarWidthRef = useRef(sidebarWidth);
  sidebarWidthRef.current = sidebarWidth;
  useEffect(() => {
    if (!isDraggingSidebar || sidebarCollapsed) return;
    const handleMouseMove = (e: MouseEvent) => {
      const maxW = Math.min(640, Math.floor(window.innerWidth * 0.55));
      const newWidth = Math.max(260, Math.min(maxW, e.clientX));
      setSidebarWidth(newWidth);
    };
    const handleMouseUp = () => {
      setIsDraggingSidebar(false);
      try {
        localStorage.setItem(
          "blobfish.sidebarWidth",
          String(sidebarWidthRef.current),
        );
      } catch {
        // Storage blocked — width just won't persist.
      }
    };
    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
  }, [isDraggingSidebar, sidebarCollapsed]);

  function updatePrefs(next: Prefs): void {
    // Reset to defaults keeps one obvious escape hatch if a theme misbehaves.
    setPrefs({ ...DEFAULT_PREFS, ...next });
  }

  /** List an account's containers into the tree. `force` re-lists (Refresh); otherwise once per account. */
  const loadContainers = useCallback((accountId: string, force = false) => {
    if (!force && inflight.current[accountId] !== undefined) return;
    if (!force && !needsLoad(treeRef.current[accountId])) return;
    const seq = ++treeSeq.current;
    inflight.current[accountId] = seq;
    dispatchTree({ type: "start", accountId, seq });
    window.api.storage
      .listContainers(accountId)
      .then((items) => dispatchTree({ type: "success", accountId, seq, items }))
      .catch((err: unknown) =>
        // A failed listing (e.g. 403, SAS without account-level list) is a
        // failure, not an empty account: the node says so and offers Retry.
        dispatchTree({
          type: "failure",
          accountId,
          seq,
          error: errMessage(err),
        }),
      )
      .finally(() => {
        if (inflight.current[accountId] === seq)
          delete inflight.current[accountId];
      });
  }, []);
  const ensureContainers = useCallback(
    (accountId: string) => loadContainers(accountId, false),
    [loadContainers],
  );

  function isGroupOpen(accountId: string): boolean {
    return groupOpen[accountId] ?? true;
  }

  function toggleExpand(accountId: string, force?: boolean): void {
    const a = accounts.find((x) => x.id === accountId);
    // Container attachments open straight into their container — nothing to expand.
    if (a && a.kind !== "account") return;
    const next = force ?? !expanded[accountId];
    setExpanded((prev) => ({ ...prev, [accountId]: next }));
    if (next && isGroupOpen(accountId)) ensureContainers(accountId);
  }

  function toggleGroup(accountId: string, force?: boolean): void {
    const next = force ?? !isGroupOpen(accountId);
    setGroupOpen((prev) => ({ ...prev, [accountId]: next }));
    if (next) ensureContainers(accountId);
  }

  function ensureCaps(accountId: string): void {
    if (caps[accountId]) return;
    window.api.accounts
      .capabilities(accountId)
      .then((c) => setCaps((p) => ({ ...p, [accountId]: c })))
      .catch(console.error);
  }

  function flashSide(message: string): void {
    setSideNotice(message);
    window.setTimeout(
      () => setSideNotice((n) => (n === message ? null : n)),
      2600,
    );
  }

  function copyText(text: string, what: string): void {
    void navigator.clipboard
      ?.writeText(text)
      .then(() => flashSide(`${what} copied`))
      .catch(() => undefined);
  }

  function selectAccount(
    accountId: string,
    container: string | null = null,
    prefix?: string,
    reload?: boolean,
  ): void {
    const a = accounts.find((x) => x.id === accountId);
    const resolved =
      container ??
      (a && a.kind !== "account" ? (a.containerName ?? null) : null);
    peek.dismiss();
    setSelectedId(accountId);
    setTarget((t) => ({
      accountId,
      container: resolved,
      prefix,
      reload,
      tick: (t?.tick ?? 0) + 1,
    }));
  }

  function goHome(): void {
    peek.dismiss();
    setSelectedId(null);
    setTarget(null);
  }

  function invalidateContainers(accountId: string): void {
    if (expanded[accountId]) loadContainers(accountId, true);
    else dispatchTree({ type: "forget", accountId });
  }

  async function commitRename(id: string): Promise<void> {
    const value = renameValue.trim();
    setRenamingId(null);
    if (value === "") return;
    try {
      await window.api.accounts.update(id, { name: value });
      refreshAccounts();
    } catch (err) {
      console.error(err);
    }
  }

  const selected = accounts.find((a) => a.id === selectedId) ?? null;
  const pinned = accounts.filter((a) => a.pinned);
  const visible =
    pinned.length > 0 ? accounts.filter((a) => !a.pinned) : accounts;
  const visibleAccounts = visible.filter((a) => a.kind === "account");
  const visibleContainers = visible.filter((a) => a.kind !== "account");
  const pinnedContainerKeys = new Set(
    pinned
      .filter((a) => a.containerName)
      .map((a) => `${a.endpoint}::${(a.containerName ?? "").toLowerCase()}`),
  );

  function isContainerPinned(endpoint: string, container: string): boolean {
    return pinnedContainerKeys.has(`${endpoint}::${container.toLowerCase()}`);
  }

  function toggleContainerPin(source: AccountSummary, container: string): void {
    const match = accounts.find(
      (a) =>
        a.containerName &&
        a.endpoint === source.endpoint &&
        a.containerName.toLowerCase() === container.toLowerCase(),
    );
    if (match?.pinned) {
      window.api.accounts
        .pin(match.id, false)
        .then(() => refreshAccounts())
        .catch(console.error);
    } else if (match) {
      window.api.accounts
        .pin(match.id, true)
        .then(() => refreshAccounts())
        .catch(console.error);
    } else {
      window.api.accounts
        .pinContainer(source.id, container)
        .then(() => refreshAccounts())
        .catch(console.error);
    }
  }

  function copySecret(id: string): void {
    // Secret never enters renderer JS — main decrypts and writes clipboard directly.
    setSecretError(null);
    window.api.accounts
      .copySecret(id)
      .then(() => flashSide("Connection secret copied"))
      .catch((err: unknown) => {
        console.error(err);
        setSecretError(err instanceof Error ? err.message : String(err));
      });
  }

  function exportSecret(id: string): void {
    setSecretError(null);
    window.api.accounts.exportSecret(id).catch((err: unknown) => {
      console.error(err);
      setSecretError(err instanceof Error ? err.message : String(err));
    });
  }

  function menuAt(e: React.MouseEvent | React.KeyboardEvent): {
    x: number;
    y: number;
  } {
    if ("clientX" in e && (e.clientX || e.clientY))
      return { x: e.clientX, y: e.clientY };
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    return { x: r.left + 24, y: r.bottom - 4 };
  }

  function openAccountMenu(
    e: React.MouseEvent | React.KeyboardEvent,
    a: AccountSummary,
  ): void {
    e.preventDefault();
    e.stopPropagation();
    ensureCaps(a.id);
    setMenu({ kind: "account", ...menuAt(e), account: a });
  }

  function openGroupMenu(
    e: React.MouseEvent | React.KeyboardEvent,
    a: AccountSummary,
  ): void {
    e.preventDefault();
    e.stopPropagation();
    ensureCaps(a.id);
    setMenu({ kind: "group", ...menuAt(e), account: a });
  }

  function probeLease(accountId: string, container: string): void {
    const key = `${accountId}/${container}`;
    setLease((p) => ({ ...p, [key]: { state: "loading" } }));
    window.api.container
      .properties({ accountId, container })
      .then((props) =>
        setLease((p) => ({
          ...p,
          [key]: { state: props.leaseState ?? "available" },
        })),
      )
      .catch((err: unknown) =>
        setLease((p) => ({
          ...p,
          [key]: { state: "unknown", error: errMessage(err) },
        })),
      );
  }

  function openContainerMenu(
    e: React.MouseEvent | React.KeyboardEvent,
    a: AccountSummary,
    container: string,
  ): void {
    e.preventDefault();
    e.stopPropagation();
    ensureCaps(a.id);
    probeLease(a.id, container);
    setMenu({ kind: "container", ...menuAt(e), account: a, container });
  }

  /** ContextMenu key / Shift+F10 opens a row's menu, like a right-click. */
  function isMenuKey(e: React.KeyboardEvent): boolean {
    return e.key === "ContextMenu" || (e.shiftKey && e.key === "F10");
  }

  // Up/Down/Home/End walk the visible tree rows (sections, accounts, the
  // Blob Containers node, containers, Show more) in order.
  function onTreeKeyDown(e: React.KeyboardEvent<HTMLDivElement>): void {
    if (e.target instanceof HTMLInputElement) return;
    const items = Array.from(
      e.currentTarget.querySelectorAll<HTMLElement>("[data-tree-item]"),
    );
    const cur = items.indexOf(document.activeElement as HTMLElement);
    const next = nextTreeFocus(items.length, cur, e.key);
    if (next === null) return;
    e.preventDefault();
    items[next]?.focus();
  }

  function containerUrl(a: AccountSummary, container: string): string {
    const base = a.endpoint
      .split("?")[0]!
      .replace(/\/+$/, "")
      .replace(".dfs.", ".blob.");
    return `${base}/${container}`;
  }

  function sasItem(a: AccountSummary, scope: SasScope): MenuEntry {
    const c = caps[a.id];
    return {
      label: "Get Shared Access Signature…",
      icon: "link",
      disabledReason: !c
        ? "Checking connection…"
        : c.sharedKey
          ? undefined
          : c.sasReason,
      onSelect: () => setSasFor({ account: a, scope }),
    };
  }

  function accountMenuItems(a: AccountSummary): MenuEntry[] {
    const c = caps[a.id];
    const full = a.kind === "account" && !a.containerName;
    const scopedContainer = !full ? a.containerName : undefined;
    return [
      c?.sharedKey && {
        label: "Copy Account Key",
        icon: "key",
        title: "Copies the AccountKey from this connection string",
        onSelect: () =>
          void window.api.accounts
            .copyKey(a.id)
            .then(() => flashSide("Account key copied"))
            .catch((err: unknown) => setSecretError(errMessage(err))),
      },
      {
        label: "Copy connection secret",
        icon: "copy",
        title: "Copy the SAS URL / connection string to the clipboard",
        onSelect: () => copySecret(a.id),
      },
      {
        label: "Export secret to file…",
        icon: "fileDown",
        onSelect: () => exportSecret(a.id),
      },
      "sep",
      full
        ? sasItem(a, { kind: "account" })
        : scopedContainer
          ? sasItem(a, { kind: "container", container: scopedContainer })
          : null,
      full && {
        label: "Refresh",
        icon: "refresh",
        onSelect: () => {
          toggleExpand(a.id, true);
          loadContainers(a.id, true);
          if (selectedId === a.id)
            selectAccount(a.id, target?.container ?? null, undefined, true);
        },
      },
      "sep",
      {
        label: a.pinned ? "Unpin from Quick Access" : "Pin to Quick Access",
        icon: "star",
        onSelect: () =>
          void window.api.accounts
            .pin(a.id, !a.pinned)
            .then(() => refreshAccounts())
            .catch(console.error),
      },
      {
        label: "Rename Connection…",
        icon: "pencil",
        onSelect: () => {
          setRenamingId(a.id);
          setRenameValue(a.name);
        },
      },
      "sep",
      {
        label: "Detach…",
        icon: "close",
        danger: true,
        onSelect: () => setDetachFor(a),
      },
    ];
  }

  function groupMenuItems(a: AccountSummary): MenuEntry[] {
    const c = caps[a.id];
    const full = a.kind === "account" && !a.containerName;
    const serviceReason = !c
      ? "Checking connection…"
      : c.accountScope
        ? undefined
        : "Needs a full storage-account connection.";
    return [
      full && {
        label: "Create Blob Container…",
        icon: "plus",
        onSelect: () => setCreateFor(a.id),
      },
      {
        label: "Open Container by Name…",
        icon: "search",
        onSelect: () => setOpenByNameFor(a.id),
      },
      {
        label: "View All Containers",
        icon: "grid",
        title: "Open the container list in the explorer",
        onSelect: () => selectAccount(a.id, null),
      },
      "sep",
      {
        label: "Configure CORS Settings…",
        icon: "globe",
        disabledReason: serviceReason,
        onSelect: () => setAdminFor({ kind: "cors", account: a }),
      },
      {
        label: "Configure Soft Delete Policy…",
        icon: "restore",
        disabledReason: serviceReason,
        onSelect: () => setAdminFor({ kind: "softDelete", account: a }),
      },
      "sep",
      {
        label: "Refresh",
        icon: "refresh",
        onSelect: () => {
          toggleGroup(a.id, true);
          loadContainers(a.id, true);
        },
      },
    ];
  }

  function containerMenuItems(a: AccountSummary, name: string): MenuEntry[] {
    const canManage = a.kind === "account" && !a.containerName;
    const probe = lease[`${a.id}/${name}`];
    const leaseReason = (want: "acquire" | "break"): string | undefined => {
      if (!probe || probe.state === "loading") return "Checking lease state…";
      if (probe.state === "unknown")
        return `Couldn't read the lease state${probe.error ? `: ${probe.error}` : "."}`;
      if (want === "acquire")
        return probe.state === "leased"
          ? "Container is already leased."
          : probe.state === "breaking"
            ? "Lease is breaking."
            : undefined;
      return probe.state === "leased"
        ? undefined
        : "Container has no active lease.";
    };
    const isOpen = target?.accountId === a.id && target.container === name;
    const pinned = isContainerPinned(a.endpoint, name);
    return [
      {
        label: "Open",
        icon: "forward",
        onSelect: () => selectAccount(a.id, name),
      },
      isOpen && {
        label: "Refresh",
        icon: "refresh",
        onSelect: () => selectAccount(a.id, name, undefined, true),
      },
      "sep",
      {
        label: "Copy URL",
        icon: "link",
        onSelect: () => copyText(containerUrl(a, name), "Container URL"),
      },
      {
        label: "Copy Name",
        icon: "copy",
        onSelect: () => copyText(name, "Container name"),
      },
      "sep",
      sasItem(a, { kind: "container", container: name }),
      {
        label: "Manage Stored Access Policies…",
        icon: "shield",
        onSelect: () =>
          setAdminFor({ kind: "policies", accountId: a.id, container: name }),
      },
      {
        label: "Set Public Access Level…",
        icon: "globe",
        onSelect: () =>
          setAdminFor({ kind: "public", accountId: a.id, container: name }),
      },
      "sep",
      {
        label: "Acquire Lease",
        icon: "lock",
        disabledReason: leaseReason("acquire"),
        onSelect: () =>
          void window.api.container
            .acquireLease({ accountId: a.id, container: name })
            .then((leaseId) =>
              setAdminFor({ kind: "lease", container: name, leaseId }),
            )
            .catch((err: unknown) => flashSide(errMessage(err))),
      },
      {
        label: "Break Lease…",
        icon: "unlock",
        disabledReason: leaseReason("break"),
        onSelect: () => setBreakLeaseFor({ accountId: a.id, name }),
      },
      "sep",
      canManage && {
        label: pinned ? "Unpin from Quick Access" : "Pin to Quick Access",
        icon: "star",
        onSelect: () => toggleContainerPin(a, name),
      },
      canManage && {
        label: "Rename…",
        icon: "pencil",
        onSelect: () => setRenameContainerFor({ accountId: a.id, name }),
      },
      {
        label: "Properties…",
        icon: "info",
        onSelect: () =>
          setAdminFor({ kind: "properties", accountId: a.id, container: name }),
      },
      "sep",
      canManage && {
        label: "Delete…",
        icon: "trash",
        danger: true,
        onSelect: () => setDeleteContainerFor({ accountId: a.id, name }),
      },
    ];
  }

  function accountRow(a: AccountSummary): React.JSX.Element {
    const isActive = a.id === selectedId;
    const isOpen = expanded[a.id] ?? false;
    const entry = entryOf(tree, a.id);
    const groupIsOpen = isGroupOpen(a.id);
    const canManageContainers = a.kind === "account" && !a.containerName;
    const isScopedContainer = a.kind !== "account";
    const { shown, hidden } = visibleSlice(entry);
    const firstLoad = entry.status === "loading" && entry.items.length === 0;
    const hasCount =
      entry.status === "ready" ||
      (entry.status === "loading" && entry.items.length > 0);
    const leaves = (
      <>
        {firstLoad && (
          <li className="tree-loading" role="status">
            Loading containers…
          </li>
        )}
        {entry.status === "error" && (
          <li className="tree-loading tree-error" role="alert">
            <span title={entry.error}>
              Can't list containers{entry.error ? ` — ${entry.error}` : ""}
            </span>
            <button
              className="linklike small"
              data-tree-item
              onClick={() => loadContainers(a.id, true)}
            >
              Retry
            </button>
          </li>
        )}
        {entry.status === "ready" && entry.items.length === 0 && (
          <li className="tree-loading">No containers.</li>
        )}
        {shown.map((c) => {
          const pinnedC = isContainerPinned(a.endpoint, c.name);
          return (
            <li
              key={c.name}
              className="tree-leaf-row"
              onContextMenu={(e) => openContainerMenu(e, a, c.name)}
            >
              <button
                className={`tree-leaf${target?.accountId === a.id && target.container === c.name ? " active" : ""}`}
                onClick={() => selectAccount(a.id, c.name)}
                onKeyDown={(e) => {
                  if (isMenuKey(e)) openContainerMenu(e, a, c.name);
                  else if (e.key === "ArrowLeft") {
                    e.preventDefault();
                    e.currentTarget
                      .closest(".tree-group")
                      ?.querySelector<HTMLElement>(".group-toggle")
                      ?.focus();
                  }
                }}
                title={c.name}
                data-tree-item
              >
                <span className="kind-ico container" aria-hidden />
                <span className="leaf-name">{c.name}</span>
              </button>
              <span className="leaf-actions">
                {canManageContainers && (
                  <button
                    className={`mini-btn${pinnedC ? " on" : ""}`}
                    title={
                      pinnedC
                        ? `Unpin container "${c.name}" from Quick Access`
                        : `Pin container "${c.name}" to Quick Access`
                    }
                    aria-label={pinnedC ? `Unpin ${c.name}` : `Pin ${c.name}`}
                    aria-pressed={pinnedC}
                    tabIndex={-1}
                    onClick={() => toggleContainerPin(a, c.name)}
                  >
                    <Icon name="star" size={14} filled={pinnedC} />
                  </button>
                )}
                <button
                  className="mini-btn"
                  title={`Actions for container "${c.name}"`}
                  aria-label={`Actions for container ${c.name}`}
                  tabIndex={-1}
                  onClick={(e) => openContainerMenu(e, a, c.name)}
                >
                  <Icon name="more" size={14} />
                </button>
              </span>
            </li>
          );
        })}
        {hidden > 0 && (
          <li className="tree-more-row">
            <button
              className="tree-more"
              data-tree-item
              onClick={() => dispatchTree({ type: "more", accountId: a.id })}
            >
              Show {Math.min(hidden, 50)} more…
            </button>
            <button
              className="tree-more"
              data-tree-item
              title="Open the full container list in the explorer"
              onClick={() => selectAccount(a.id, null)}
            >
              View all {entry.items.length}
            </button>
          </li>
        )}
      </>
    );
    return (
      <li key={a.id} className="tree-account">
        <div
          className={`tree-row${isActive ? " active" : ""}`}
          onContextMenu={(e) => openAccountMenu(e, a)}
        >
          {isScopedContainer ? (
            <span className="twisty leaf-spacer" aria-hidden />
          ) : (
            <button
              className={`twisty${isOpen ? " open" : ""}`}
              onClick={() => toggleExpand(a.id)}
              aria-label={isOpen ? `Collapse ${a.name}` : `Expand ${a.name}`}
              aria-expanded={isOpen}
              tabIndex={-1}
            >
              <Icon name="chevronRight" size={14} />
            </button>
          )}
          <button
            className="tree-main"
            data-tree-item
            aria-expanded={isScopedContainer ? undefined : isOpen}
            onClick={() => {
              selectAccount(
                a.id,
                a.kind === "account" ? null : (a.containerName ?? null),
              );
              if (!isOpen && !isScopedContainer) toggleExpand(a.id);
            }}
            onKeyDown={(e) => {
              if (isMenuKey(e)) openAccountMenu(e, a);
              else if (!isScopedContainer && e.key === "ArrowRight") {
                e.preventDefault();
                if (!isOpen) toggleExpand(a.id, true);
                else
                  e.currentTarget
                    .closest(".tree-account")
                    ?.querySelector<HTMLElement>(".group-toggle")
                    ?.focus();
              } else if (!isScopedContainer && e.key === "ArrowLeft") {
                e.preventDefault();
                if (isOpen) toggleExpand(a.id, false);
              }
            }}
            title={`${a.name}\n${a.containerName ? `Container: ${a.containerName}\n` : ""}Endpoint: ${a.endpoint}`}
          >
            <span className={`kind-ico ${a.kind}`} aria-hidden />
            <span className="tree-text">
              {renamingId === a.id ? (
                <input
                  className="rename-input"
                  value={renameValue}
                  autoFocus
                  onChange={(e) => setRenameValue(e.target.value)}
                  onBlur={() => void commitRename(a.id)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void commitRename(a.id);
                    if (e.key === "Escape") setRenamingId(null);
                  }}
                  onClick={(e) => e.stopPropagation()}
                />
              ) : (
                <span className="account-name" title={a.name}>
                  {a.name}
                </span>
              )}
              <span
                className="account-sub"
                title={a.containerName ?? a.accountName ?? hostOf(a.endpoint)}
              >
                {a.containerName ?? a.accountName ?? hostOf(a.endpoint)}
              </span>
            </span>
          </button>
          <span className="tree-actions">
            <button
              className={`mini-btn${a.pinned ? " on" : ""}`}
              title={
                a.pinned ? "Unpin from Quick Access" : "Pin to Quick Access"
              }
              aria-label={
                a.pinned
                  ? `Unpin ${a.name} from Quick Access`
                  : `Pin ${a.name} to Quick Access`
              }
              aria-pressed={Boolean(a.pinned)}
              onClick={() =>
                window.api.accounts
                  .pin(a.id, !a.pinned)
                  .then(() => refreshAccounts())
                  .catch(console.error)
              }
            >
              <Icon name="star" size={14} filled={Boolean(a.pinned)} />
            </button>
            <button
              className="mini-btn"
              title="More actions"
              aria-label={`Actions for ${a.name}`}
              onClick={(e) => openAccountMenu(e, a)}
            >
              <Icon name="more" size={16} />
            </button>
          </span>
        </div>
        {isOpen && a.kind === "account" && (
          <ul className="tree-containers">
            <li className="tree-group">
              <div
                className="group-row"
                onContextMenu={(e) => openGroupMenu(e, a)}
              >
                <button
                  className="group-toggle"
                  data-tree-item
                  aria-expanded={groupIsOpen}
                  onClick={() => toggleGroup(a.id)}
                  onKeyDown={(e) => {
                    if (isMenuKey(e)) openGroupMenu(e, a);
                    else if (e.key === "ArrowRight") {
                      e.preventDefault();
                      if (!groupIsOpen) toggleGroup(a.id, true);
                      else
                        e.currentTarget
                          .closest(".tree-group")
                          ?.querySelector<HTMLElement>(".tree-leaf")
                          ?.focus();
                    } else if (e.key === "ArrowLeft") {
                      e.preventDefault();
                      if (groupIsOpen) toggleGroup(a.id, false);
                      else
                        e.currentTarget
                          .closest(".tree-account")
                          ?.querySelector<HTMLElement>(".tree-main")
                          ?.focus();
                    }
                  }}
                >
                  <span
                    className={`twisty${groupIsOpen ? " open" : ""}`}
                    aria-hidden
                  >
                    <Icon name="chevronRight" size={13} />
                  </span>
                  <span className="kind-ico service" aria-hidden />
                  <span className="group-label">Blob Containers</span>
                </button>
                {entry.status === "loading" && entry.items.length > 0 && (
                  <span className="group-spinner" aria-label="Refreshing" />
                )}
                {hasCount && (
                  <span className="count">{entry.items.length}</span>
                )}
                <span className="leaf-actions group-actions">
                  {canManageContainers && (
                    <button
                      className="mini-btn"
                      title="New container in this account"
                      aria-label="New container in this account"
                      tabIndex={-1}
                      onClick={() => setCreateFor(a.id)}
                    >
                      <Icon name="plus" size={14} />
                    </button>
                  )}
                  <button
                    className="mini-btn"
                    title="Blob Containers actions"
                    aria-label={`Blob Containers actions for ${a.name}`}
                    tabIndex={-1}
                    onClick={(e) => openGroupMenu(e, a)}
                  >
                    <Icon name="more" size={14} />
                  </button>
                </span>
              </div>
              {groupIsOpen && <ul className="tree-leaves">{leaves}</ul>}
            </li>
          </ul>
        )}
      </li>
    );
  }

  return (
    <div
      className={`shell${sidebarCollapsed ? " sidebar-collapsed" : ""}${sidebarCollapsed && peekOpen ? " sidebar-peek" : ""}`}
      data-platform={platform ?? "unknown"}
      data-theme={prefs.theme}
      data-vibrancy={
        platform === null
          ? undefined
          : platform === "darwin" && prefs.vibrancy
            ? "on"
            : "off"
      }
      data-accent={prefs.accent}
      data-density={prefs.density}
      data-motion={prefs.motion}
      style={accentVars(prefs) as React.CSSProperties}
    >
      {/* One toggle, same spot (titlebar row, next to the traffic lights) whether the
          sidebar is pinned open or collapsed. Hover peeks; click pins / collapses. */}
      <button
        ref={toggleRef}
        className={`sidebar-toggle${peekOpen ? " is-peeking" : ""}`}
        onClick={() => {
          peek.suppressUntilLeave();
          setSidebarCollapsed((v) => !v);
        }}
        onPointerMove={sidebarCollapsed ? peekMove("toggle") : undefined}
        onPointerLeave={() => peek.leave("toggle")}
        title={sidebarCollapsed ? "Show sidebar (⌘B)" : "Hide sidebar (⌘B)"}
        aria-label={sidebarCollapsed ? "Show sidebar" : "Hide sidebar"}
        aria-expanded={sidebarShown}
      >
        <Icon name="sidebar" size={16} />
      </button>
      {sidebarCollapsed && (
        <div
          className="sidebar-edge"
          aria-hidden
          onPointerMove={peekMove("edge")}
          onPointerLeave={() => peek.leave("edge")}
        />
      )}
      <aside
        ref={asideRef}
        className="sidebar"
        style={{ width: `${sidebarWidth}px` }}
        aria-hidden={!sidebarShown}
        inert={!sidebarShown}
        onPointerEnter={() => peek.enter("panel", true)}
        onPointerLeave={() => peek.leave("panel")}
        onFocus={(e) => {
          if (sidebarCollapsed && e.target.matches(":focus-visible"))
            peek.hold("focus", true);
        }}
        onBlur={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null))
            peek.hold("focus", false);
        }}
      >
        <div className="traffic-spacer" aria-hidden />
        <div className="brand">
          {/* Psst: triple-click the logo (views/easter-egg). */}
          <div className="brand-logo-frame" onClick={brandEgg.onClick}>
            <img
              src={logoUrl}
              alt="Blobfish"
              className="brand-logo-img"
              draggable={false}
            />
          </div>
          <div className="brand-details">
            <div className="brand-name-row">
              <h1 className="brand-title">{APP_NAME}</h1>
              <span className="brand-badge">Azure</span>
            </div>
            <p className="brand-tagline">{APP_TAGLINE}</p>
          </div>
        </div>

        <nav className="side-nav" aria-label="Sidebar">
          <button
            className={`side-nav-btn${selectedId === null && !showSettings ? " is-current" : ""}`}
            aria-current={
              selectedId === null && !showSettings ? "page" : undefined
            }
            onClick={() => {
              setShowSettings(false);
              goHome();
            }}
          >
            <Icon name="home" size={15} />
            <span>Home</span>
          </button>
          <button
            className="side-nav-btn side-nav-new"
            onClick={() => {
              peek.dismiss();
              setShowWizard(true);
            }}
          >
            <Icon name="plus" size={15} />
            <span>New connection</span>
          </button>
        </nav>
        {encAvailable === false && (
          <p className="error-text small">
            Keychain encryption unavailable — attach disabled.
          </p>
        )}
        {secretError && (
          <p className="error-text small">
            Secret action failed: {secretError}
          </p>
        )}

        <div className="tree-scroll" onKeyDown={onTreeKeyDown}>
          {pinned.length > 0 && (
            <section className="tree-section">
              <button
                className="section-toggle"
                data-tree-item
                onClick={() => setQuickOpen((v) => !v)}
              >
                <span
                  className={`twisty${quickOpen ? " open" : ""}`}
                  aria-hidden
                >
                  <Icon name="chevronRight" size={13} />
                </span>
                <span className="star" aria-hidden>
                  <Icon name="star" size={13} filled />
                </span>{" "}
                Quick Access
              </button>
              {quickOpen && <ul className="tree">{pinned.map(accountRow)}</ul>}
            </section>
          )}

          <section className="tree-section">
            <button
              className="section-toggle"
              data-tree-item
              onClick={() => setAllOpen((v) => !v)}
            >
              <span className={`twisty${allOpen ? " open" : ""}`} aria-hidden>
                <Icon name="chevronRight" size={13} />
              </span>
              Storage accounts
              <span className="count">{visibleAccounts.length}</span>
            </button>
            {allOpen &&
              (visibleAccounts.length === 0 &&
              visibleContainers.length === 0 ? (
                <div className="empty-sidebar-card">
                  <p className="empty-sidebar-title">No storage accounts</p>
                  <p className="muted small empty-note">
                    Connect with a connection string, SAS URL, or account key to
                    get started.
                  </p>
                </div>
              ) : (
                <ul className="tree">{visibleAccounts.map(accountRow)}</ul>
              ))}
          </section>

          {visibleContainers.length > 0 && (
            <section className="tree-section">
              <button
                className="section-toggle"
                data-tree-item
                onClick={() => setAttachedOpen((v) => !v)}
              >
                <span
                  className={`twisty${attachedOpen ? " open" : ""}`}
                  aria-hidden
                >
                  <Icon name="chevronRight" size={13} />
                </span>
                Attached containers
                <span className="count">{visibleContainers.length}</span>
              </button>
              {attachedOpen && (
                <ul className="tree">{visibleContainers.map(accountRow)}</ul>
              )}
            </section>
          )}
        </div>

        <div className="side-foot">
          <button
            className={`side-foot-btn${showSettings ? " is-current" : ""}`}
            aria-current={showSettings ? "page" : undefined}
            onClick={() => {
              peek.dismiss();
              setShowSettings(true);
            }}
            title={`Settings (⌘,)\n${accounts.length} ${accounts.length === 1 ? "connection" : "connections"} · OS Keychain encrypted${appVersion ? ` · v${appVersion}` : ""}`}
            aria-label={updateBadge ? "Settings, update available" : "Settings"}
          >
            <Icon name="settings" size={17} />
            {updateBadge && <span className="update-dot" aria-hidden />}
          </button>
          <button
            className="side-foot-btn side-foot-quit"
            onClick={() => window.api.app.quit()}
            title="Quit Blobfish"
            aria-label="Quit Blobfish"
          >
            <Icon name="power" size={17} />
          </button>
        </div>
      </aside>

      <div
        className={`sidebar-resizer${isDraggingSidebar ? " dragging" : ""}`}
        onMouseDown={(e) => {
          e.preventDefault();
          setIsDraggingSidebar(true);
        }}
        onDoubleClick={() => {
          setSidebarWidth((w) => (w > 360 ? 300 : 440));
        }}
        title="Drag to resize sidebar · Double-click to toggle width"
        aria-label="Resize sidebar"
      />

      <div className="content no-topbar">
        <main className="view">
          {showSettings ? (
            <SettingsView
              prefs={prefs}
              vibrancySupported={platform === "darwin"}
              connectionCount={accounts.length}
              onConnectionsChanged={refreshAccounts}
              onChange={updatePrefs}
              onBack={() => setShowSettings(false)}
            />
          ) : selected ? (
            <Explorer
              key={selected.id}
              account={selected}
              target={target?.accountId === selected?.id ? target : null}
              onOpenContainer={(c) => {
                if (selected) selectAccount(selected.id, c);
              }}
              onChanged={refreshAccounts}
              onContainersChanged={invalidateContainers}
              onNewConnection={() => setShowWizard(true)}
            />
          ) : (
            <HomeView
              accounts={accounts}
              onNewConnection={() => setShowWizard(true)}
              onSelect={(id) => selectAccount(id)}
            />
          )}
        </main>
        {!showSettings && (
          <TransfersPanel onOpenSettings={() => setShowSettings(true)} />
        )}
      </div>

      {paletteOpen && (
        <Suspense fallback={null}>
          <CommandPalette
            platform={platform ?? "darwin"}
            accounts={accounts}
            containersCache={containersCache}
            selectedId={selectedId}
            theme={prefs.theme}
            onClose={() => setPaletteOpen(false)}
            app={{
              newConnection: () => setShowWizard(true),
              goHome: () => {
                setShowSettings(false);
                goHome();
              },
              openSettings: () => setShowSettings(true),
              toggleSidebar: () => setSidebarCollapsed((v) => !v),
              setTheme: (theme) => updatePrefs({ ...prefs, theme }),
              open: (accountId, container, prefix) => {
                setShowSettings(false);
                selectAccount(accountId, container, prefix);
              },
              copySecret,
              panel: (action) => {
                // The dock only exists outside Settings; let it mount first.
                setShowSettings(false);
                window.setTimeout(() => sendPanelAction(action), 0);
              },
            }}
          />
        </Suspense>
      )}

      {showWizard && (
        <ConnectWizard
          onClose={() => setShowWizard(false)}
          onAdded={(a) => {
            refreshAccounts();
            selectAccount(a.id, a.containerName ?? null);
            if (a.kind === "account") {
              setExpanded((p) => ({ ...p, [a.id]: true }));
              ensureContainers(a.id);
            }
          }}
        />
      )}

      {detachFor && (
        <ConfirmDialog
          title={`Detach "${detachFor.name}"?`}
          body="The encrypted secret is deleted from this machine. You can re-attach any time with the same connection string or SAS."
          confirmLabel="Detach"
          onCancel={() => setDetachFor(null)}
          onConfirm={async () => {
            const id = detachFor.id;
            await window.api.accounts.remove(id);
            dispatchTree({ type: "forget", accountId: id });
            refreshAccounts();
          }}
        />
      )}

      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          label={
            menu.kind === "container"
              ? `Actions for container ${menu.container}`
              : menu.kind === "group"
                ? `Blob Containers actions for ${menu.account.name}`
                : `Actions for ${menu.account.name}`
          }
          items={
            menu.kind === "account"
              ? accountMenuItems(menu.account)
              : menu.kind === "group"
                ? groupMenuItems(menu.account)
                : containerMenuItems(menu.account, menu.container)
          }
          onClose={() => setMenu(null)}
        />
      )}

      {sasFor && (
        <SasDialog
          accountId={sasFor.account.id}
          accountName={sasFor.account.name}
          scope={sasFor.scope}
          onClose={() => setSasFor(null)}
        />
      )}

      {adminFor?.kind === "policies" && (
        <StoredPoliciesDialog
          accountId={adminFor.accountId}
          container={adminFor.container}
          onClose={() => setAdminFor(null)}
        />
      )}
      {adminFor?.kind === "public" && (
        <PublicAccessDialog
          accountId={adminFor.accountId}
          container={adminFor.container}
          onClose={() => setAdminFor(null)}
          onSaved={() => flashSide("Public access level saved")}
        />
      )}
      {adminFor?.kind === "properties" && (
        <ContainerPropertiesDialog
          accountId={adminFor.accountId}
          container={adminFor.container}
          onClose={() => setAdminFor(null)}
        />
      )}
      {adminFor?.kind === "lease" && (
        <LeaseAcquiredDialog
          container={adminFor.container}
          leaseId={adminFor.leaseId}
          onClose={() => setAdminFor(null)}
        />
      )}
      {adminFor?.kind === "cors" && (
        <CorsDialog
          accountId={adminFor.account.id}
          accountName={adminFor.account.name}
          onClose={() => setAdminFor(null)}
        />
      )}
      {adminFor?.kind === "softDelete" && (
        <SoftDeleteDialog
          accountId={adminFor.account.id}
          accountName={adminFor.account.name}
          onClose={() => setAdminFor(null)}
        />
      )}

      {breakLeaseFor && (
        <ConfirmDialog
          title={`Break the lease on "${breakLeaseFor.name}"?`}
          body="Breaks it immediately. Whoever holds the lease loses it, and the container can be deleted again."
          confirmLabel="Break lease"
          onCancel={() => setBreakLeaseFor(null)}
          onConfirm={async () => {
            await window.api.container.breakLease({
              accountId: breakLeaseFor.accountId,
              container: breakLeaseFor.name,
            });
            flashSide(`Lease on ${breakLeaseFor.name} broken`);
          }}
        />
      )}

      {openByNameFor && (
        <PromptDialog
          title="Open container by name"
          label="Container name"
          placeholder="mycontainer"
          confirmLabel="Open"
          validate={(v) =>
            CONTAINER_NAME_RE.test(v)
              ? null
              : "Use 3–63 lowercase letters, numbers and dashes."
          }
          onCancel={() => setOpenByNameFor(null)}
          onSubmit={async (v) => {
            selectAccount(openByNameFor, v.trim());
          }}
        />
      )}

      {sideNotice && (
        <div className="toast glass strong toast-in" role="status">
          {sideNotice}
        </div>
      )}

      {createFor && (
        <PromptDialog
          title="New container"
          label="Container name"
          placeholder="mycontainer"
          hint="Lowercase letters, numbers and dashes · 3–63 chars."
          confirmLabel="Create"
          validate={(v) =>
            CONTAINER_NAME_RE.test(v)
              ? null
              : "Use 3–63 lowercase letters, numbers and dashes."
          }
          onCancel={() => setCreateFor(null)}
          onSubmit={async (v) => {
            const id = createFor;
            await window.api.storage.createContainer({
              accountId: id,
              container: v,
            });
            setExpanded((p) => ({ ...p, [id]: true }));
            invalidateContainers(id);
          }}
        />
      )}

      {renameContainerFor && (
        <PromptDialog
          title={`Rename container "${renameContainerFor.name}"`}
          label="New container name"
          initial={renameContainerFor.name}
          placeholder="mycontainer"
          hint="Copies everything to the new container, then deletes the old one."
          confirmLabel="Rename"
          validate={(v) =>
            CONTAINER_NAME_RE.test(v)
              ? null
              : "Use 3–63 lowercase letters, numbers and dashes."
          }
          onCancel={() => setRenameContainerFor(null)}
          onSubmit={async (v) => {
            const { accountId, name } = renameContainerFor;
            const dest = await window.api.storage.renameContainer({
              accountId,
              source: name,
              dest: v,
            });
            invalidateContainers(accountId);
            if (target?.accountId === accountId && target.container === name) {
              selectAccount(accountId, dest);
            }
          }}
        />
      )}

      {deleteContainerFor && (
        <ConfirmDialog
          title={`Delete container "${deleteContainerFor.name}"?`}
          body="Everything inside is permanently deleted. This cannot be undone."
          requireText={deleteContainerFor.name}
          confirmLabel="Delete"
          onCancel={() => setDeleteContainerFor(null)}
          onConfirm={async () => {
            const { accountId, name } = deleteContainerFor;
            await window.api.storage.deleteContainer({
              accountId,
              container: name,
            });
            invalidateContainers(accountId);
            if (target?.accountId === accountId && target.container === name) {
              selectAccount(accountId, null);
            }
          }}
        />
      )}
      {brandEgg.open && (
        <BrandEasterEgg
          logoUrl={logoUrl}
          reducedMotion={prefs.motion === "reduced"}
          onClose={brandEgg.close}
        />
      )}
    </div>
  );
}

function hostOf(endpoint: string): string {
  try {
    return new URL(endpoint).host;
  } catch {
    return endpoint;
  }
}
