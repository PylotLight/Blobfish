import { useRef, useState } from "react";
import { dropTargetLabel, isFileDrag } from "../../../../shared/file-drop";

interface ExplorerDndOptions {
  accountId: string | undefined;
  container: string | null;
  prefix: string | undefined;
  activeTab: string | null;
  modalOpen: boolean;
  onBusy: (busy: string | null) => void;
  onClearError: () => void;
  onError: (error: unknown) => void;
  onFlash: (message: string) => void;
}

export function useExplorerDnd({
  accountId,
  container,
  prefix,
  activeTab,
  modalOpen,
  onBusy,
  onClearError,
  onError,
  onFlash,
}: ExplorerDndOptions): {
  dropActive: boolean;
  dropFolder: string | null;
  dropHandlers: {
    onDragEnter: (e: React.DragEvent) => void;
    onDragOver: (e: React.DragEvent) => void;
    onDragLeave: (e: React.DragEvent) => void;
    onDrop: (e: React.DragEvent) => void;
  };
} {
  const [dropActive, setDropActive] = useState(false);
  const [dropFolder, setDropFolder] = useState<string | null>(null);
  const dragDepth = useRef(0);

  function canDropFiles(): boolean {
    if (!accountId || !container || activeTab !== null) return false;
    if (modalOpen) return false;
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
      if (dragDepth.current === 0) dragDepth.current = 1;
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
        onFlash("Only files and folders from Finder can be uploaded.");
        return;
      }
      const targetPrefix = folder ?? prefix;
      onBusy("upload");
      onClearError();
      window.api.transfers
        .upload({ accountId, container, prefix: targetPrefix, paths })
        .then((ids) => {
          if (ids.length === 0)
            onFlash("Nothing to upload — the folder is empty.");
          else
            onFlash(
              `Uploading ${ids.length} file${ids.length === 1 ? "" : "s"} to ${dropTargetLabel(container, targetPrefix)}`,
            );
        })
        .catch(onError)
        .finally(() => onBusy(null));
    },
  };

  return { dropActive, dropFolder, dropHandlers };
}
