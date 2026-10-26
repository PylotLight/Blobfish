import type { Dispatch } from "react";
import type { AccountSummary } from "../../../shared/types";
import {
  entryOf,
  visibleSlice,
  type TreeState,
  type TreeAction,
} from "../../../shared/container-tree";
import { hostOf } from "./types";
import { Icon } from "../views/Icon";

export interface SidebarTreeProps {
  account: AccountSummary;
  selectedId: string | null;
  expanded: Record<string, boolean>;
  tree: TreeState;
  isGroupOpen: (id: string) => boolean;
  target: { accountId: string; container: string | null } | null;
  renamingId: string | null;
  renameValue: string;
  loadContainers: (id: string, force?: boolean) => void;
  dispatchTree: Dispatch<TreeAction>;
  selectAccount: (
    id: string,
    container?: string | null,
    prefix?: string,
    reload?: boolean,
  ) => void;
  toggleExpand: (id: string, force?: boolean) => void;
  toggleGroup: (id: string, force?: boolean) => void;
  isContainerPinned: (endpoint: string, container: string) => boolean;
  toggleContainerPin: (a: AccountSummary, c: string) => void;
  openContainerMenu: (
    e: React.MouseEvent | React.KeyboardEvent,
    a: AccountSummary,
    c: string,
  ) => void;
  openAccountMenu: (
    e: React.MouseEvent | React.KeyboardEvent,
    a: AccountSummary,
  ) => void;
  openGroupMenu: (
    e: React.MouseEvent | React.KeyboardEvent,
    a: AccountSummary,
  ) => void;
  isMenuKey: (e: React.KeyboardEvent) => boolean;
  setCreateFor: (id: string | null) => void;
  setRenamingId: (id: string | null) => void;
  setRenameValue: (v: string) => void;
  commitRename: (id: string) => Promise<void>;
  refreshAccounts: () => void;
}

export function SidebarTree(props: SidebarTreeProps): React.JSX.Element {
  const {
    account: a,
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
  } = props;

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
            title={a.pinned ? "Unpin from Quick Access" : "Pin to Quick Access"}
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
              {hasCount && <span className="count">{entry.items.length}</span>}
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
