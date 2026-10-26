import type { AccountSummary } from "../../../shared/types";
import { Icon } from "../views/Icon";
import type { SidebarTreeProps } from "./SidebarTree";
import { SidebarTree } from "./SidebarTree";

type Props = {
  pinned: AccountSummary[];
  visibleAccounts: AccountSummary[];
  visibleContainers: AccountSummary[];
  quickOpen: boolean;
  allOpen: boolean;
  attachedOpen: boolean;
  onQuickToggle: () => void;
  onAllToggle: () => void;
  onAttachedToggle: () => void;
  treeProps: Omit<SidebarTreeProps, "account">;
};
export function Sidebar(props: Props): React.JSX.Element {
  const {
    pinned,
    visibleAccounts,
    visibleContainers,
    quickOpen,
    allOpen,
    attachedOpen,
    onQuickToggle,
    onAllToggle,
    onAttachedToggle,
    treeProps,
  } = props;
  const accountRow = (a: AccountSummary) => (
    <SidebarTree key={a.id} account={a} {...treeProps} />
  );
  return (
    <>
      {pinned.length > 0 && (
        <section className="tree-section">
          <button
            className="section-toggle"
            data-tree-item
            onClick={() => onQuickToggle()}
          >
            <span className={`twisty${quickOpen ? " open" : ""}`} aria-hidden>
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
          onClick={() => onAllToggle()}
        >
          <span className={`twisty${allOpen ? " open" : ""}`} aria-hidden>
            <Icon name="chevronRight" size={13} />
          </span>
          Storage accounts
          <span className="count">{visibleAccounts.length}</span>
        </button>
        {allOpen &&
          (visibleAccounts.length === 0 && visibleContainers.length === 0 ? (
            <div className="empty-sidebar-card">
              <p className="empty-sidebar-title">No storage accounts</p>
              <p className="muted small empty-note">
                Connect with a connection string, SAS URL, or account key to get
                started.
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
            onClick={() => onAttachedToggle()}
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
    </>
  );
}
