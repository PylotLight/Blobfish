import type { Dispatch, RefObject, SetStateAction } from "react";
import { Icon } from "../Icon";
import { Action } from "./BlobRow";
import type {
  AccountSummary,
  StorageBlobItem,
  StorageContainer,
} from "../../../../shared/types";
import type { useBlobActions } from "./useBlobActions";
import type { useExplorerNav } from "./useExplorerNav";
import type { PreviewTabs } from "./usePreviewTabs";

type Actions = ReturnType<typeof useBlobActions>;
type Navigation = ReturnType<typeof useExplorerNav>;
export interface ExplorerPresentationState
  extends
    Pick<
      Actions,
      | "onUpload"
      | "onDownload"
      | "onNewFolder"
      | "onRename"
      | "onRestore"
      | "onMoveOrCopy"
      | "onDelete"
    >,
    Pick<
      Navigation,
      | "goBack"
      | "goForward"
      | "goUp"
      | "retryCurrent"
      | "go"
      | "switchContainer"
      | "resetNav"
    > {
  account: AccountSummary;
  displayAccount: string;
  scoped: boolean;
  filterRef: RefObject<HTMLInputElement | null>;
  filter: string;
  setFilter: (value: string) => void;
  backHist: string[];
  fwdHist: string[];
  navPrefix: string;
  accountId: string | undefined;
  loadingContainers: boolean;
  loadingList: boolean;
  busy: string | null;
  container: string | null;
  previewFile: StorageBlobItem | null;
  openPreviewTab: PreviewTabs["openPreviewTab"];
  selection: Set<string>;
  hasDeletedSel: boolean;
  visibleBlobs: StorageBlobItem[];
  keyOf: (item: StorageBlobItem) => string;
  toggleAll: (keys: string[]) => void;
  showDeleted: boolean;
  setShowDeleted: Dispatch<SetStateAction<boolean>>;
  isDfs: boolean;
  canRename: boolean;
  crumbs: string[];
  containers: StorageContainer[];
}

export function ToolbarFilter({
  filterRef,
  filter,
  setFilter,
}: Pick<
  ExplorerPresentationState,
  "filterRef" | "filter" | "setFilter"
>): React.JSX.Element {
  return (
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
}

export function ToolbarHistory({
  goBack,
  backHist,
  goForward,
  fwdHist,
  goUp,
  navPrefix,
  scoped,
  container,
  retryCurrent,
  accountId,
  loadingContainers,
  loadingList,
}: Pick<
  ExplorerPresentationState,
  | "goBack"
  | "backHist"
  | "goForward"
  | "fwdHist"
  | "goUp"
  | "navPrefix"
  | "scoped"
  | "container"
  | "retryCurrent"
  | "accountId"
  | "loadingContainers"
  | "loadingList"
>): React.JSX.Element {
  return (
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
}

export function ToolbarActions({
  onUpload,
  container,
  busy,
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
  previewFile,
  openPreviewTab,
  canRename,
  onRename,
  onRestore,
  onMoveOrCopy,
  onDelete,
}: Pick<
  ExplorerPresentationState,
  | "onUpload"
  | "container"
  | "busy"
  | "selection"
  | "hasDeletedSel"
  | "onDownload"
  | "onNewFolder"
  | "visibleBlobs"
  | "keyOf"
  | "toggleAll"
  | "showDeleted"
  | "setShowDeleted"
  | "isDfs"
  | "previewFile"
  | "openPreviewTab"
  | "canRename"
  | "onRename"
  | "onRestore"
  | "onMoveOrCopy"
  | "onDelete"
>): React.JSX.Element {
  return (
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
}

export function ToolbarAddress({
  scoped,
  go,
  account,
  container,
  displayAccount,
  switchContainer,
  resetNav,
  crumbs,
  navPrefix,
  containers,
}: Pick<
  ExplorerPresentationState,
  | "scoped"
  | "go"
  | "account"
  | "container"
  | "displayAccount"
  | "switchContainer"
  | "resetNav"
  | "crumbs"
  | "navPrefix"
  | "containers"
>): React.JSX.Element {
  return (
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
}
