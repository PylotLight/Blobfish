import type { AccountSummary } from "../../../../shared/types";
import type { useBlobListing } from "../useBlobListing";

export interface ConfirmState {
  title: string;
  body?: string;
  items?: string[];
  requireText?: string;
  confirmLabel: string;
  run: () => Promise<void>;
}

export interface PromptState {
  title: string;
  label: string;
  initial?: string;
  placeholder?: string;
  hint?: string;
  confirmLabel: string;
  validate?: (v: string) => string | null;
  submit: (v: string) => Promise<void>;
}

type MoveCopyState = { mode: "move" | "copy"; names: string[] };

export interface BlobActionContext {
  account: AccountSummary | null;
  accountId: string | undefined;
  container: string | null;
  blobs: ReturnType<typeof useBlobListing>["blobs"];
  selection: Set<string>;
  deletedKeys: Set<string>;
  navPrefix: string;
  moveCopy: MoveCopyState | null;
  props: { onContainersChanged: (accountId: string) => void };
  setBusy: (label: string | null) => void;
  setActionError: (value: null) => void;
  setPrompt: (value: PromptState) => void;
  setConfirm: (value: ConfirmState) => void;
  setMoveCopy: (value: MoveCopyState) => void;
  setBlobs: (value: null) => void;
  setCtx: (value: null) => void;
  setCopiedEndpoint: (value: boolean) => void;
  flash: (message: string) => void;
  fail: (error: unknown, context?: "containers" | "blobs" | "action") => void;
  reloadBlobs: () => void;
  loadContainers: (accountId: string, highlight?: string | null) => void;
  switchContainer: (value: string | null) => void;
  resetNav: () => void;
  dropTabsForNames: (container: string, names: string[]) => void;
  renamePreviewTab: (
    container: string,
    source: string,
    destination: string,
  ) => void;
  dropTabsForPaths: (container: string, names: string[]) => void;
}

/** Current-render actions; state, refs and effects remain owned by Explorer. */
export function useBlobActions({
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
}: BlobActionContext) {
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
          renamePreviewTab(container, src, destFull);
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
        dropTabsForPaths(container, sel);
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

  return {
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
  };
}
