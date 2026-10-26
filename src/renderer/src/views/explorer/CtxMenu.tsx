import { createPortal } from "react-dom";
import type { RefObject } from "react";
import type { useBlobActions } from "./useBlobActions";
import type { PreviewTabs } from "./usePreviewTabs";
import type { StorageBlobItem } from "../../../../shared/types";
import type { CtxMenu as CtxMenuState } from "./helpers";

type Actions = ReturnType<typeof useBlobActions>;
export interface ExplorerPresentationState extends Pick<
  Actions,
  | "onUpload"
  | "onNewFolder"
  | "onDownload"
  | "copyPaths"
  | "onRestore"
  | "onRename"
  | "onMoveOrCopy"
  | "onDelete"
> {
  ctx: CtxMenuState | null;
  ctxRef: RefObject<HTMLDivElement | null>;
  setCtx: (value: null) => void;
  toggleAll: (keys: string[]) => void;
  visibleBlobs: StorageBlobItem[];
  keyOf: (item: StorageBlobItem) => string;
  retryCurrent: () => void;
  openPreviewTab: PreviewTabs["openPreviewTab"];
  deletedKeys: Set<string>;
  isDfs: boolean;
  containerRef: RefObject<string | null>;
  setHistoryFor: (value: { container: string; name: string }) => void;
}

export default function CtxMenu(
  props: ExplorerPresentationState,
): React.JSX.Element | null {
  const {
    ctx,
    ctxRef,
    setCtx,
    onUpload,
    onNewFolder,
    toggleAll,
    visibleBlobs,
    keyOf,
    retryCurrent,
    openPreviewTab,
    onDownload,
    copyPaths,
    deletedKeys,
    isDfs,
    containerRef,
    setHistoryFor,
    onRestore,
    onRename,
    onMoveOrCopy,
    onDelete,
  } = props;
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

  return ctxMenu;
}
