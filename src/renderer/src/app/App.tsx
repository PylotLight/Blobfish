import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { APP_NAME, APP_TAGLINE } from "../../../shared/config";
import type {
  AccountCapabilities,
  AccountSummary,
  SysInfo,
} from "../../../shared/types";
import logoUrl from "../assets/logo.png";
import Explorer from "../views/Explorer";
import HomeView from "../views/Home";
import ConnectWizard from "../views/ConnectWizard";
import TransfersPanel from "../views/TransfersPanel";
import { ConfirmDialog, PromptDialog } from "../views/Dialogs";
import {
  DEFAULT_PREFS,
  accentVars,
  loadPrefs,
  savePrefs,
  SettingsView,
  type Prefs,
} from "../views/Settings";
import { REVEAL_UPDATES_KEY } from "../views/UpdateSettings";
import { sendPanelAction } from "../palette-bus";
import {
  BrandEasterEgg,
  useBrandTripleClick,
} from "../views/easter-egg/BrandEasterEgg";
import { Icon } from "../views/Icon";
import { ContextMenu } from "../views/ContextMenu";
import { SasDialog, type SasScope } from "../views/SasDialog";
import {
  ContainerPropertiesDialog,
  CorsDialog,
  LeaseAcquiredDialog,
  PublicAccessDialog,
  SoftDeleteDialog,
  StoredPoliciesDialog,
} from "../views/AdminDialogs";
import { createSidebarPeek, type PeekZone } from "../../../shared/sidebar-peek";
import { hoverMayOpen } from "../../../shared/dock-view";
import { useSidebarTree } from "./useSidebarTree";
import { useSidebarActions } from "./useSidebarActions";
import { Sidebar } from "./Sidebar";
import { buildSidebarMenuItems } from "./menu-items";
import {
  CONTAINER_NAME_RE,
  type LeaseProbe,
  type SelectionTarget,
  type SidebarMenu,
} from "./types";

const CommandPalette = lazy(() => import("../views/CommandPalette"));

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

  const {
    expanded,
    setExpanded,
    tree,
    dispatchTree,
    containersCache,
    loadContainers,
    ensureContainers,
    isGroupOpen,
    toggleExpand,
    toggleGroup,
  } = useSidebarTree(accounts);
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

  const {
    selected,
    pinned,
    visibleAccounts,
    visibleContainers,
    flashSide,
    copyText,
    selectAccount,
    goHome,
    invalidateContainers,
    commitRename,
    isContainerPinned,
    toggleContainerPin,
    copySecret,
    exportSecret,
    openAccountMenu,
    openGroupMenu,
    openContainerMenu,
    isMenuKey,
    onTreeKeyDown,
  } = useSidebarActions({
    accounts,
    selectedId,
    caps,
    setCaps,
    setSideNotice,
    peek,
    setSelectedId,
    setTarget,
    expanded,
    loadContainers,
    dispatchTree,
    renameValue,
    setRenamingId,
    refreshAccounts,
    setSecretError,
    setMenu,
    setLease,
  });

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

  const { accountMenuItems, groupMenuItems, containerMenuItems } =
    buildSidebarMenuItems({
      caps,
      lease,
      target,
      selectedId,
      flashSide,
      setSecretError,
      copySecret,
      exportSecret,
      toggleExpand,
      toggleGroup,
      loadContainers,
      selectAccount,
      refreshAccounts,
      setRenamingId,
      setRenameValue,
      setDetachFor,
      setCreateFor,
      setOpenByNameFor,
      setAdminFor,
      isContainerPinned,
      copyText,
      setSasFor,
      setBreakLeaseFor,
      toggleContainerPin,
      setRenameContainerFor,
      setDeleteContainerFor,
    });

  const sidebarTreeProps = {
    accounts,
    selectedId,
    expanded,
    tree,
    isGroupOpen,
    target,
    renamingId,
    renameValue,
    loadContainers,
    dispatchTree,
    selectAccount,
    toggleExpand,
    toggleGroup,
    isContainerPinned,
    toggleContainerPin,
    openContainerMenu,
    openAccountMenu,
    openGroupMenu,
    isMenuKey,
    setCreateFor,
    setRenamingId,
    setRenameValue,
    commitRename,
    refreshAccounts,
  };
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
          <Sidebar
            pinned={pinned}
            visibleAccounts={visibleAccounts}
            visibleContainers={visibleContainers}
            quickOpen={quickOpen}
            allOpen={allOpen}
            attachedOpen={attachedOpen}
            onQuickToggle={() => setQuickOpen((v) => !v)}
            onAllToggle={() => setAllOpen((v) => !v)}
            onAttachedToggle={() => setAttachedOpen((v) => !v)}
            treeProps={sidebarTreeProps}
          />
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
