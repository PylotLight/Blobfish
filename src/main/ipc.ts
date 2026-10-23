import {
  app,
  clipboard,
  dialog,
  ipcMain,
  Notification,
  shell,
  type IpcMainInvokeEvent,
} from "electron";
import * as os from "node:os";
import { readFileSync, statSync, writeFileSync } from "node:fs";
import {
  getGlassState,
  getMainWindow,
  setGlassVibrancy,
  showWindow,
} from "./window";
import type {
  AccountCapabilities,
  AccountCreateInput,
  AccountSummary,
  AccountUpdateInput,
  ActivityEntry,
  BackupRestoreResult,
  BackupSaveResult,
  BlobVersionInfo,
  ContainerAccessInfo,
  ContainerActionArgs,
  ContainerPropertiesInfo,
  CopyBlobsArgs,
  CorsRuleInfo,
  CreateFolderArgs,
  DeleteBlobsArgs,
  DownloadArgs,
  GlassState,
  ListBlobsArgs,
  ListBlobsWire,
  ListVersionsArgs,
  MoveBlobsArgs,
  PreviewArgs,
  PreviewResult,
  RenameBlobArgs,
  RenameContainerArgs,
  RestoreVersionArgs,
  SetPublicAccessArgs,
  SetStoredPoliciesArgs,
  SoftDeleteInfo,
  StorageContainer,
  SysInfo,
  TransferConfigure,
  TransfersSnapshot,
  TransfersSummary,
  UndeleteBlobsArgs,
  UploadEnqueueArgs,
  VibrancyName,
} from "../shared/types";
import {
  addAccount,
  decryptSecret,
  encryptionAvailable,
  listAccounts,
  pinContainerAttachment,
  exportAllForBackup,
  removeAccount,
  restoreFromBackup,
  setPinned,
  updateAccount,
} from "./accounts";
import {
  BACKUP_EXT,
  BackupError,
  decryptBackup,
  encryptBackup,
} from "./backup";
import {
  clearActivities,
  deleteDownloadedFile,
  listActivities,
  logActivity,
} from "./activity";
import {
  azuriteConnectionString,
  copyBlobs,
  createContainer,
  createFolder,
  deleteContainer,
  deleteNames,
  expandBlobNames,
  listBlobVersions,
  listBlobs,
  listContainers,
  moveBlobs,
  prewarmAzureSdk,
  renameBlob,
  renameContainer,
  restoreVersion,
  undeleteBlobs,
} from "./azure";
import {
  accountCapabilities,
  accountKeyForClipboard,
  acquireContainerLease,
  breakContainerLease,
  generateAccountSas,
  generateContainerSas,
  getContainerAccess,
  getContainerProperties,
  getCors,
  getSoftDelete,
  setCors,
  setPublicAccess,
  setSoftDelete,
  setStoredPolicies,
} from "./container-admin";
import type {
  AccountSasRequest,
  ContainerSasRequest,
  SasResult,
} from "../shared/sas";
import { prewarmListWorker } from "./list-runner";
import { previewBlob } from "./preview";
import {
  cancelAll,
  cancelTransfer,
  clearFinished,
  configureTransfers,
  enqueueDownload,
  enqueueUpload,
  retryTransfer,
  snapshot as transfersSnapshot,
} from "./transfers";

const isMac = process.platform === "darwin";

/** Materials offered in the Glass tab. All are valid on current Electron. */
const VIBRANCY_OPTIONS: readonly VibrancyName[] = [
  "fullscreen-ui",
  "under-window",
  "sidebar",
  "hud",
  "content",
  "popover",
  "menu",
  "titlebar",
];

function notify(title: string, body: string): boolean {
  if (!Notification.isSupported()) return false;
  new Notification({ title, body }).show();
  return true;
}

/**
 * All renderer → main calls. To add a tool:
 * 1. add an `ipcMain.handle('domain:action', …)` here,
 * 2. expose it in `src/preload/index.ts`,
 * 3. call it from the renderer via `window.api`.
 */
export function registerIpc(): void {
  // Azure SDKs load lazily; warm them once the first window has painted so the
  // first listing doesn't pay for the module load either.
  app.once("browser-window-created", (_, win) => {
    win.webContents.once("did-finish-load", () =>
      setTimeout(() => {
        prewarmAzureSdk();
        prewarmListWorker();
      }, 750),
    );
  });

  ipcMain.handle("ping", () => "pong");

  ipcMain.handle("sys:info", (): SysInfo => {
    return {
      platform: process.platform,
      arch: process.arch,
      release: os.release(),
      hostname: os.hostname(),
      cpus: os.cpus().length,
      totalMem: os.totalmem(),
      freeMem: os.freemem(),
    };
  });

  ipcMain.handle(
    "notify:send",
    (
      _event: IpcMainInvokeEvent,
      payload: { title: string; body: string },
    ): boolean => notify(payload.title, payload.body),
  );

  ipcMain.handle(
    "dock:set-badge",
    (_event: IpcMainInvokeEvent, count: number): boolean => {
      if (isMac) app.setBadgeCount(count);
      return isMac;
    },
  );

  ipcMain.handle("win:hide", () => getMainWindow()?.hide());
  ipcMain.handle("win:show", () => showWindow());
  ipcMain.handle("win:minimize", () => getMainWindow()?.minimize());
  ipcMain.handle("win:flash", () => getMainWindow()?.flashFrame(true));

  // Hide the whole app (macOS: Cmd+H behavior — window + dock indicator go away).
  ipcMain.handle("app:hide", (): boolean => {
    if (isMac) app.hide();
    else getMainWindow()?.hide();
    return true;
  });

  // Tray-only mode: remove the dock icon entirely (macOS). Restore with dock:show.
  ipcMain.handle("dock:hide", (): boolean => {
    if (isMac) app.dock?.hide();
    return isMac;
  });
  ipcMain.handle("dock:show", (): boolean => {
    if (isMac) app.dock?.show();
    return isMac;
  });

  ipcMain.handle("glass:get", (): GlassState => getGlassState());
  ipcMain.handle(
    "glass:set",
    (_event: IpcMainInvokeEvent, name: VibrancyName | null): GlassState => {
      if (name !== null && !VIBRANCY_OPTIONS.includes(name))
        return getGlassState();
      return setGlassVibrancy(name);
    },
  );
  ipcMain.handle(
    "glass:options",
    (): readonly VibrancyName[] => VIBRANCY_OPTIONS,
  );

  ipcMain.handle(
    "shell:open",
    (_event: IpcMainInvokeEvent, url: string): boolean => {
      if (!url.startsWith("https://")) return false;
      void shell.openExternal(url);
      return true;
    },
  );

  ipcMain.handle("app:quit", () => app.quit());
  ipcMain.handle("app:version", (): string => app.getVersion());

  // ----- Blobfish storage accounts (secrets stay in main via safeStorage) -----
  ipcMain.handle("accounts:encryption", (): Promise<boolean> =>
    encryptionAvailable(),
  );
  ipcMain.handle("accounts:list", (): AccountSummary[] => listAccounts());
  ipcMain.handle(
    "accounts:add",
    (
      _event: IpcMainInvokeEvent,
      input: AccountCreateInput,
    ): Promise<AccountSummary> => addAccount(input),
  );
  ipcMain.handle(
    "accounts:remove",
    (_event: IpcMainInvokeEvent, id: string): boolean => removeAccount(id),
  );
  ipcMain.handle(
    "accounts:update",
    (
      _event: IpcMainInvokeEvent,
      id: string,
      patch: AccountUpdateInput,
    ): AccountSummary => updateAccount(id, patch),
  );
  ipcMain.handle(
    "accounts:pin",
    (_event: IpcMainInvokeEvent, id: string, pinned: boolean): AccountSummary =>
      setPinned(id, pinned),
  );
  ipcMain.handle(
    "accounts:pin-container",
    (
      _event: IpcMainInvokeEvent,
      id: string,
      container: string,
    ): Promise<AccountSummary> => pinContainerAttachment(id, container),
  );
  ipcMain.handle("accounts:azurite-template", (): string =>
    azuriteConnectionString(),
  );
  ipcMain.handle(
    "accounts:copy-secret",
    async (_event: IpcMainInvokeEvent, id: string): Promise<boolean> => {
      const { profile, secret } = await decryptSecret(id);
      clipboard.writeText(secret);
      logActivity({
        kind: "connection",
        text: `Copied secret for '${profile.name}' to clipboard`,
        status: "success",
      });
      return true;
    },
  );
  ipcMain.handle(
    "accounts:export-secret",
    async (
      _event: IpcMainInvokeEvent,
      id: string,
    ): Promise<{ saved: boolean; path?: string }> => {
      const { profile, secret } = await decryptSecret(id);
      const safeName =
        profile.name.replace(/[^\w.-]+/g, "_").slice(0, 80) || "connection";
      const win = getMainWindow();
      const saveOpts = {
        title: `Export secret for ${profile.name}`,
        defaultPath: `${safeName}-secret.txt`,
        filters: [
          { name: "Text", extensions: ["txt"] },
          { name: "All files", extensions: ["*"] },
        ],
      };
      const res = win
        ? await dialog.showSaveDialog(win, saveOpts)
        : await dialog.showSaveDialog(saveOpts);
      if (res.canceled || !res.filePath) return { saved: false };
      writeFileSync(res.filePath, secret, "utf8");
      logActivity({
        kind: "connection",
        text: `Exported secret for '${profile.name}' to file`,
        status: "success",
      });
      return { saved: true, path: res.filePath };
    },
  );
  // ----- connections backup / restore (passphrase-encrypted, see backup.ts) -----
  const backupError = (err: unknown): { ok: false; error: string } => ({
    ok: false,
    error:
      err instanceof BackupError || err instanceof Error
        ? err.message
        : String(err),
  });
  ipcMain.handle(
    "accounts:backup",
    async (
      _event: IpcMainInvokeEvent,
      passphrase: string,
    ): Promise<BackupSaveResult> => {
      try {
        const connections = await exportAllForBackup();
        if (connections.length === 0)
          return { ok: false, error: "No connections to back up yet." };
        const text = await encryptBackup(
          {
            app: "blobfish",
            appVersion: app.getVersion(),
            exportedAt: Date.now(),
            connections,
          },
          passphrase,
        );
        const win = getMainWindow();
        const day = new Date().toISOString().slice(0, 10);
        const opts = {
          title: "Back up connections",
          defaultPath: `blobfish-connections-${day}.${BACKUP_EXT}`,
          filters: [{ name: "Blobfish backup", extensions: [BACKUP_EXT] }],
        };
        const res = win
          ? await dialog.showSaveDialog(win, opts)
          : await dialog.showSaveDialog(opts);
        if (res.canceled || !res.filePath) return { ok: false, canceled: true };
        writeFileSync(res.filePath, text, { encoding: "utf8", mode: 0o600 });
        logActivity({
          kind: "connection",
          text: `Backed up ${connections.length} connection${connections.length === 1 ? "" : "s"}`,
          status: "success",
        });
        return { ok: true, count: connections.length, path: res.filePath };
      } catch (err) {
        return backupError(err);
      }
    },
  );
  ipcMain.handle(
    "accounts:restore",
    async (
      _event: IpcMainInvokeEvent,
      passphrase: string,
    ): Promise<BackupRestoreResult> => {
      try {
        const win = getMainWindow();
        const opts = {
          title: "Restore connections",
          properties: ["openFile" as const],
          filters: [
            { name: "Blobfish backup", extensions: [BACKUP_EXT] },
            { name: "All files", extensions: ["*"] },
          ],
        };
        const res = win
          ? await dialog.showOpenDialog(win, opts)
          : await dialog.showOpenDialog(opts);
        const file = res.filePaths[0];
        if (res.canceled || !file) return { ok: false, canceled: true };
        if (statSync(file).size > 20 * 1024 * 1024)
          return { ok: false, error: "That file isn't a Blobfish backup." };
        const payload = await decryptBackup(
          readFileSync(file, "utf8"),
          passphrase,
        );
        const r = await restoreFromBackup(payload.connections);
        logActivity({
          kind: "connection",
          text: `Restored ${r.added} connection${r.added === 1 ? "" : "s"} from backup${r.skipped ? ` (${r.skipped} already here)` : ""}`,
          status: "success",
        });
        return { ok: true, ...r };
      } catch (err) {
        return backupError(err);
      }
    },
  );
  // ----- SAS + container / service admin (sidebar context menus). Keys stay in main. -----
  ipcMain.handle(
    "accounts:capabilities",
    (_event: IpcMainInvokeEvent, id: string): Promise<AccountCapabilities> =>
      accountCapabilities(id),
  );
  ipcMain.handle(
    "accounts:copy-key",
    async (_event: IpcMainInvokeEvent, id: string): Promise<boolean> => {
      const { name, key } = await accountKeyForClipboard(id);
      clipboard.writeText(key);
      logActivity({
        kind: "connection",
        text: `Copied account key for '${name}' to clipboard`,
        status: "success",
      });
      return true;
    },
  );
  ipcMain.handle(
    "sas:account",
    (_event: IpcMainInvokeEvent, req: AccountSasRequest): Promise<SasResult> =>
      generateAccountSas(req),
  );
  ipcMain.handle(
    "sas:container",
    (
      _event: IpcMainInvokeEvent,
      req: ContainerSasRequest,
    ): Promise<SasResult> => generateContainerSas(req),
  );
  ipcMain.handle(
    "container:access",
    (
      _event: IpcMainInvokeEvent,
      args: ContainerActionArgs,
    ): Promise<ContainerAccessInfo> =>
      getContainerAccess(args.accountId, args.container),
  );
  ipcMain.handle(
    "container:set-policies",
    (_event: IpcMainInvokeEvent, args: SetStoredPoliciesArgs): Promise<void> =>
      setStoredPolicies(args.accountId, args.container, args.policies),
  );
  ipcMain.handle(
    "container:set-public-access",
    (_event: IpcMainInvokeEvent, args: SetPublicAccessArgs): Promise<void> =>
      setPublicAccess(args.accountId, args.container, args.level),
  );
  ipcMain.handle(
    "container:properties",
    (
      _event: IpcMainInvokeEvent,
      args: ContainerActionArgs,
    ): Promise<ContainerPropertiesInfo> =>
      getContainerProperties(args.accountId, args.container),
  );
  ipcMain.handle(
    "container:acquire-lease",
    (_event: IpcMainInvokeEvent, args: ContainerActionArgs): Promise<string> =>
      acquireContainerLease(args.accountId, args.container),
  );
  ipcMain.handle(
    "container:break-lease",
    (_event: IpcMainInvokeEvent, args: ContainerActionArgs): Promise<void> =>
      breakContainerLease(args.accountId, args.container),
  );
  ipcMain.handle(
    "service:cors",
    (_event: IpcMainInvokeEvent, accountId: string): Promise<CorsRuleInfo[]> =>
      getCors(accountId),
  );
  ipcMain.handle(
    "service:set-cors",
    (
      _event: IpcMainInvokeEvent,
      accountId: string,
      rules: CorsRuleInfo[],
    ): Promise<void> => setCors(accountId, rules),
  );
  ipcMain.handle(
    "service:soft-delete",
    (_event: IpcMainInvokeEvent, accountId: string): Promise<SoftDeleteInfo> =>
      getSoftDelete(accountId),
  );
  ipcMain.handle(
    "service:set-soft-delete",
    (
      _event: IpcMainInvokeEvent,
      accountId: string,
      input: SoftDeleteInfo,
    ): Promise<void> => setSoftDelete(accountId, input),
  );
  ipcMain.handle(
    "storage:list-containers",
    (
      _event: IpcMainInvokeEvent,
      accountId: string,
    ): Promise<StorageContainer[]> => listContainers(accountId),
  );
  ipcMain.handle(
    "storage:list-blobs",
    (_event: IpcMainInvokeEvent, args: ListBlobsArgs): Promise<ListBlobsWire> =>
      listBlobs(
        args.accountId,
        args.container,
        args.prefix,
        args.pageSize,
        args.includeDeleted,
        args.continuationToken,
      ),
  );
  ipcMain.handle(
    "storage:create-container",
    (_event: IpcMainInvokeEvent, args: ContainerActionArgs): Promise<void> =>
      createContainer(args.accountId, args.container),
  );
  ipcMain.handle(
    "storage:delete-container",
    (_event: IpcMainInvokeEvent, args: ContainerActionArgs): Promise<void> =>
      deleteContainer(args.accountId, args.container),
  );
  ipcMain.handle(
    "storage:create-folder",
    (_event: IpcMainInvokeEvent, args: CreateFolderArgs): Promise<void> =>
      createFolder(
        args.accountId,
        args.container,
        args.prefix,
        args.folderName,
      ),
  );
  ipcMain.handle(
    "storage:delete-blobs",
    (_event: IpcMainInvokeEvent, args: DeleteBlobsArgs): Promise<number> =>
      deleteNames(args.accountId, args.container, args.names),
  );
  ipcMain.handle(
    "storage:expand-blobs",
    (_event: IpcMainInvokeEvent, args: DeleteBlobsArgs): Promise<string[]> =>
      expandBlobNames(args.accountId, args.container, args.names),
  );
  ipcMain.handle(
    "storage:copy-blobs",
    (_event: IpcMainInvokeEvent, args: CopyBlobsArgs): Promise<number> =>
      copyBlobs(
        args.accountId,
        args.container,
        args.names,
        args.destPrefix,
        args.overwrite,
      ),
  );
  ipcMain.handle(
    "storage:move-blobs",
    (_event: IpcMainInvokeEvent, args: MoveBlobsArgs): Promise<number> =>
      moveBlobs(
        args.accountId,
        args.container,
        args.names,
        args.destPrefix,
        args.overwrite,
      ),
  );
  ipcMain.handle(
    "storage:list-versions",
    (
      _event: IpcMainInvokeEvent,
      args: ListVersionsArgs,
    ): Promise<BlobVersionInfo[]> =>
      listBlobVersions(args.accountId, args.container, args.name),
  );
  ipcMain.handle(
    "storage:undelete-blobs",
    (_event: IpcMainInvokeEvent, args: UndeleteBlobsArgs): Promise<number> =>
      undeleteBlobs(args.accountId, args.container, args.names),
  );
  ipcMain.handle(
    "storage:restore-version",
    (_event: IpcMainInvokeEvent, args: RestoreVersionArgs): Promise<void> =>
      restoreVersion(
        args.accountId,
        args.container,
        args.name,
        args.versionId,
        args.snapshot,
      ),
  );
  ipcMain.handle(
    "storage:rename-blob",
    (_event: IpcMainInvokeEvent, args: RenameBlobArgs): Promise<string> =>
      renameBlob(args.accountId, args.container, args.source, args.destLeaf),
  );
  ipcMain.handle(
    "storage:rename-container",
    (_event: IpcMainInvokeEvent, args: RenameContainerArgs): Promise<string> =>
      renameContainer(args.accountId, args.source, args.dest),
  );
  ipcMain.handle(
    "storage:preview",
    (_event: IpcMainInvokeEvent, args: PreviewArgs): Promise<PreviewResult> =>
      previewBlob(args),
  );
  // ----- Transfers: queued file movement (progress streams over `transfers:changed`) -----
  ipcMain.handle("transfers:list", (): TransfersSnapshot =>
    transfersSnapshot(),
  );
  ipcMain.handle(
    "transfers:configure",
    (_event: IpcMainInvokeEvent, opts: TransferConfigure): TransfersSummary =>
      configureTransfers(opts),
  );
  ipcMain.handle(
    "transfers:upload",
    (_event: IpcMainInvokeEvent, args: UploadEnqueueArgs): Promise<string[]> =>
      enqueueUpload(
        args.accountId,
        args.container,
        args.prefix,
        args.folder === true,
        args.paths,
      ),
  );
  ipcMain.handle(
    "transfers:download",
    (_event: IpcMainInvokeEvent, args: DownloadArgs): Promise<string[]> =>
      enqueueDownload(args.accountId, args.container, args.names),
  );
  ipcMain.handle(
    "transfers:cancel",
    (_event: IpcMainInvokeEvent, id: string): TransfersSummary =>
      cancelTransfer(id),
  );
  ipcMain.handle("transfers:cancel-all", (): TransfersSummary => cancelAll());
  ipcMain.handle(
    "transfers:retry",
    (_event: IpcMainInvokeEvent, id: string): TransfersSummary =>
      retryTransfer(id),
  );
  ipcMain.handle("transfers:clear-finished", (): TransfersSummary =>
    clearFinished(),
  );

  // ----- Activity log (ASE-style: transfers + ops in one place) -----
  ipcMain.handle("activity:list", (): ActivityEntry[] => listActivities());
  ipcMain.handle(
    "activity:clear",
    (
      _event: IpcMainInvokeEvent,
      mode: "completed" | "successful",
    ): ActivityEntry[] => clearActivities(mode),
  );
  ipcMain.handle(
    "activity:delete-file",
    async (
      _event: IpcMainInvokeEvent,
      args: { id: string; localPath?: string },
    ) => {
      return deleteDownloadedFile(args.id, args.localPath);
    },
  );
  ipcMain.handle(
    "activity:reveal-file",
    (_event: IpcMainInvokeEvent, localPath: string): boolean => {
      shell.showItemInFolder(localPath);
      return true;
    },
  );
  ipcMain.handle(
    "activity:open-file",
    async (
      _event: IpcMainInvokeEvent,
      localPath: string,
    ): Promise<{ success: boolean; message: string }> => {
      if (!localPath) return { success: false, message: "File path unknown." };
      const err = await shell.openPath(localPath);
      if (err) return { success: false, message: err };
      return { success: true, message: "Opened." };
    },
  );
}
