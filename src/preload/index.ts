import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import type {
  AccountCreateInput,
  AccountSummary,
  AccountUpdateInput,
  BackupRestoreResult,
  BackupSaveResult,
  ActivityEntry,
  BlobVersionInfo,
  ContainerActionArgs,
  CopyBlobsArgs,
  CreateFolderArgs,
  DeleteBlobsArgs,
  DownloadArgs,
  GlassState,
  ListBlobsArgs,
  ListBlobsResult,
  ListBlobsWire,
  StorageBlobItem,
  ListVersionsArgs,
  MoveBlobsArgs,
  PreviewArgs,
  PreviewResult,
  RenameBlobArgs,
  RenameContainerArgs,
  RestoreVersionArgs,
  StorageContainer,
  SysInfo,
  TransferConfigure,
  TransfersDelta,
  TransfersSnapshot,
  TransfersSummary,
  UndeleteBlobsArgs,
  UploadEnqueueArgs,
  VibrancyName
} from '../shared/types'
import type { UpdateSettingsResult, UpdateState } from '../shared/update-feed'

export interface Versions {
  node: () => string
  chrome: () => string
  electron: () => string
}

/**
 * The full renderer → main surface. Sections mirror `src/main/ipc.ts`.
 * Add a tool there first, then expose it here — `window.api` is typed
 * end-to-end, so the renderer sees the new call immediately.
 */
const api = {
  ping: (): Promise<string> => ipcRenderer.invoke('ping'),
  versions: {
    node: (): string => process.versions.node,
    chrome: (): string => process.versions.chrome,
    electron: (): string => process.versions.electron
  } satisfies Versions,
  sys: {
    info: (): Promise<SysInfo> => ipcRenderer.invoke('sys:info')
  },
  notify: (title: string, body: string): Promise<boolean> =>
    ipcRenderer.invoke('notify:send', { title, body }),
  dock: {
    setBadge: (count: number): Promise<boolean> => ipcRenderer.invoke('dock:set-badge', count),
    hide: (): Promise<boolean> => ipcRenderer.invoke('dock:hide'),
    show: (): Promise<boolean> => ipcRenderer.invoke('dock:show')
  },
  glass: {
    get: (): Promise<GlassState> => ipcRenderer.invoke('glass:get'),
    set: (name: VibrancyName | null): Promise<GlassState> => ipcRenderer.invoke('glass:set', name),
    options: (): Promise<VibrancyName[]> => ipcRenderer.invoke('glass:options')
  },
  win: {
    hide: (): Promise<void> => ipcRenderer.invoke('win:hide'),
    show: (): Promise<void> => ipcRenderer.invoke('win:show'),
    minimize: (): Promise<void> => ipcRenderer.invoke('win:minimize'),
    flash: (): Promise<void> => ipcRenderer.invoke('win:flash')
  },
  shell: {
    open: (url: string): Promise<boolean> => ipcRenderer.invoke('shell:open', url)
  },
  accounts: {
    encryption: (): Promise<boolean> => ipcRenderer.invoke('accounts:encryption'),
    list: (): Promise<AccountSummary[]> => ipcRenderer.invoke('accounts:list'),
    add: (input: AccountCreateInput): Promise<AccountSummary> =>
      ipcRenderer.invoke('accounts:add', input),
    remove: (id: string): Promise<boolean> => ipcRenderer.invoke('accounts:remove', id),
    update: (id: string, patch: AccountUpdateInput): Promise<AccountSummary> =>
      ipcRenderer.invoke('accounts:update', id, patch),
    pin: (id: string, pinned: boolean): Promise<AccountSummary> =>
      ipcRenderer.invoke('accounts:pin', id, pinned),
    pinContainer: (id: string, container: string): Promise<AccountSummary> =>
      ipcRenderer.invoke('accounts:pin-container', id, container),
    copySecret: (id: string): Promise<boolean> => ipcRenderer.invoke('accounts:copy-secret', id),
    exportSecret: (id: string): Promise<{ saved: boolean; path?: string }> =>
      ipcRenderer.invoke('accounts:export-secret', id),
    azuriteTemplate: (): Promise<string> => ipcRenderer.invoke('accounts:azurite-template'),
    backup: (passphrase: string): Promise<BackupSaveResult> => ipcRenderer.invoke('accounts:backup', passphrase),
    restore: (passphrase: string): Promise<BackupRestoreResult> =>
      ipcRenderer.invoke('accounts:restore', passphrase)
  },
  storage: {
    listContainers: (accountId: string): Promise<StorageContainer[]> =>
      ipcRenderer.invoke('storage:list-containers', accountId),
    // Items cross IPC as one JSON string (see ListBlobsWire); JSON.parse here
    // is a few ms, far cheaper than structured-cloning 5,000 objects in main.
    listBlobs: async (args: ListBlobsArgs): Promise<ListBlobsResult> => {
      const wire = (await ipcRenderer.invoke('storage:list-blobs', args)) as ListBlobsWire
      return {
        container: wire.container,
        prefix: wire.prefix,
        items: JSON.parse(wire.itemsJson) as StorageBlobItem[],
        continuationToken: wire.continuationToken
      }
    },
    createContainer: (args: ContainerActionArgs): Promise<void> =>
      ipcRenderer.invoke('storage:create-container', args),
    deleteContainer: (args: ContainerActionArgs): Promise<void> =>
      ipcRenderer.invoke('storage:delete-container', args),
    createFolder: (args: CreateFolderArgs): Promise<void> =>
      ipcRenderer.invoke('storage:create-folder', args),
    deleteBlobs: (args: DeleteBlobsArgs): Promise<number> =>
      ipcRenderer.invoke('storage:delete-blobs', args),
    expandBlobs: (args: DeleteBlobsArgs): Promise<string[]> =>
      ipcRenderer.invoke('storage:expand-blobs', args),
    copyBlobs: (args: CopyBlobsArgs): Promise<number> =>
      ipcRenderer.invoke('storage:copy-blobs', args),
    moveBlobs: (args: MoveBlobsArgs): Promise<number> =>
      ipcRenderer.invoke('storage:move-blobs', args),
    renameBlob: (args: RenameBlobArgs): Promise<string> =>
      ipcRenderer.invoke('storage:rename-blob', args),
    renameContainer: (args: RenameContainerArgs): Promise<string> =>
      ipcRenderer.invoke('storage:rename-container', args),
    preview: (args: PreviewArgs): Promise<PreviewResult> =>
      ipcRenderer.invoke('storage:preview', args),
    listVersions: (args: ListVersionsArgs): Promise<BlobVersionInfo[]> =>
      ipcRenderer.invoke('storage:list-versions', args),
    undeleteBlobs: (args: UndeleteBlobsArgs): Promise<number> =>
      ipcRenderer.invoke('storage:undelete-blobs', args),
    restoreVersion: (args: RestoreVersionArgs): Promise<void> =>
      ipcRenderer.invoke('storage:restore-version', args)
  },
  transfers: {
    list: (): Promise<TransfersSnapshot> => ipcRenderer.invoke('transfers:list'),
    configure: (opts: TransferConfigure): Promise<TransfersSummary> =>
      ipcRenderer.invoke('transfers:configure', opts),
    upload: (args: UploadEnqueueArgs): Promise<string[]> =>
      ipcRenderer.invoke('transfers:upload', args),
    download: (args: DownloadArgs): Promise<string[]> =>
      ipcRenderer.invoke('transfers:download', args),
    cancel: (id: string): Promise<TransfersSummary> =>
      ipcRenderer.invoke('transfers:cancel', id),
    cancelAll: (): Promise<TransfersSummary> => ipcRenderer.invoke('transfers:cancel-all'),
    retry: (id: string): Promise<TransfersSummary> =>
      ipcRenderer.invoke('transfers:retry', id),
    clearFinished: (): Promise<TransfersSummary> =>
      ipcRenderer.invoke('transfers:clear-finished'),
    /** Compact deltas (changed rows + removed ids); apply with shared/transfers-delta. */
    onUpdate: (cb: (delta: TransfersDelta) => void): (() => void) => {
      const handler = (_event: IpcRendererEvent, delta: TransfersDelta): void => cb(delta)
      ipcRenderer.on('transfers:changed', handler)
      return () => ipcRenderer.removeListener('transfers:changed', handler)
    }
  },
  activity: {
    list: (): Promise<ActivityEntry[]> => ipcRenderer.invoke('activity:list'),
    clear: (mode: 'completed' | 'successful'): Promise<ActivityEntry[]> =>
      ipcRenderer.invoke('activity:clear', mode),
    deleteFile: (args: { id: string; localPath?: string }): Promise<{ success: boolean; movedOrMissing?: boolean; message: string }> =>
      ipcRenderer.invoke('activity:delete-file', args),
    revealFile: (localPath: string): Promise<boolean> =>
      ipcRenderer.invoke('activity:reveal-file', localPath),
    openFile: (localPath: string): Promise<{ success: boolean; message: string }> =>
      ipcRenderer.invoke('activity:open-file', localPath),
    onUpdate: (cb: (entries: ActivityEntry[]) => void): (() => void) => {
      const handler = (_event: IpcRendererEvent, entries: ActivityEntry[]): void => cb(entries)
      ipcRenderer.on('activity:changed', handler)
      return () => ipcRenderer.removeListener('activity:changed', handler)
    }
  },
  /** Update notifications from the GitHub releases feed (main/updates.ts). */
  updates: {
    get: (): Promise<UpdateState> => ipcRenderer.invoke('updates:get'),
    check: (): Promise<UpdateState> => ipcRenderer.invoke('updates:check'),
    skip: (version: string): Promise<UpdateState> => ipcRenderer.invoke('updates:skip', version),
    remindLater: (): Promise<UpdateState> => ipcRenderer.invoke('updates:remind-later'),
    setSettings: (patch: { feedUrl?: string; betaChannel?: boolean }): Promise<UpdateSettingsResult> =>
      ipcRenderer.invoke('updates:settings:set', patch),
    download: (): Promise<boolean> => ipcRenderer.invoke('updates:download'),
    openRelease: (): Promise<boolean> => ipcRenderer.invoke('updates:open-release'),
    copyBrew: (): Promise<boolean> => ipcRenderer.invoke('updates:copy-brew'),
    onChanged: (cb: (s: UpdateState) => void): (() => void) => {
      const handler = (_event: IpcRendererEvent, s: UpdateState): void => cb(s)
      ipcRenderer.on('updates:changed', handler)
      return () => ipcRenderer.removeListener('updates:changed', handler)
    },
    /** A notification click asks the window to open Settings → About & updates. */
    onReveal: (cb: () => void): (() => void) => {
      const handler = (): void => cb()
      ipcRenderer.on('updates:reveal', handler)
      return () => ipcRenderer.removeListener('updates:reveal', handler)
    }
  },
  app: {
    hide: (): Promise<boolean> => ipcRenderer.invoke('app:hide'),
    quit: (): Promise<void> => ipcRenderer.invoke('app:quit'),
    version: (): Promise<string> => ipcRenderer.invoke('app:version')
  }
}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  window.api = api
}

export type PreloadAPI = typeof api
