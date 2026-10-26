import type { Dispatch, SetStateAction } from "react";
import type {
  AccountCapabilities,
  AccountSummary,
} from "../../../shared/types";
import { nextTreeFocus } from "../../../shared/container-tree";
import type { createSidebarPeek } from "../../../shared/sidebar-peek";
import type { useSidebarTree } from "./useSidebarTree";
import {
  errMessage,
  type LeaseProbe,
  type SelectionTarget,
  type SidebarMenu,
} from "./types";

export interface SidebarActionContext {
  accounts: AccountSummary[];
  selectedId: string | null;
  caps: Record<string, AccountCapabilities>;
  setCaps: Dispatch<SetStateAction<Record<string, AccountCapabilities>>>;
  setSideNotice: Dispatch<SetStateAction<string | null>>;
  peek: Pick<ReturnType<typeof createSidebarPeek>, "dismiss">;
  setSelectedId: (id: string | null) => void;
  setTarget: Dispatch<SetStateAction<SelectionTarget | null>>;
  expanded: Record<string, boolean>;
  loadContainers: ReturnType<typeof useSidebarTree>["loadContainers"];
  dispatchTree: ReturnType<typeof useSidebarTree>["dispatchTree"];
  renameValue: string;
  setRenamingId: (id: string | null) => void;
  refreshAccounts: () => void;
  setSecretError: (value: string | null) => void;
  setMenu: (value: SidebarMenu) => void;
  setLease: Dispatch<SetStateAction<Record<string, LeaseProbe>>>;
}

/** Sidebar actions capture current render data; state and lifecycle stay in App. */
export function useSidebarActions({
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
}: SidebarActionContext) {
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

  return {
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
  };
}
