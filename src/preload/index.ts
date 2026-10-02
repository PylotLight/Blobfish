import { contextBridge, ipcRenderer } from 'electron'
import type {
  AccountCreateInput,
  AccountSummary,
  AccountUpdateInput,
  ContainerActionArgs,
  CreateFolderArgs,
  DeleteBlobsArgs,
  DownloadArgs,
  GlassState,
  ListBlobsArgs,
  ListBlobsResult,
  RenameBlobArgs,
  StorageContainer,
  SysInfo,
  UploadArgs,
  VibrancyName
} from '../shared/types'

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
    azuriteTemplate: (): Promise<string> => ipcRenderer.invoke('accounts:azurite-template')
  },
  storage: {
    listContainers: (accountId: string): Promise<StorageContainer[]> =>
      ipcRenderer.invoke('storage:list-containers', accountId),
    listBlobs: (args: ListBlobsArgs): Promise<ListBlobsResult> =>
      ipcRenderer.invoke('storage:list-blobs', args),
    createContainer: (args: ContainerActionArgs): Promise<void> =>
      ipcRenderer.invoke('storage:create-container', args),
    deleteContainer: (args: ContainerActionArgs): Promise<void> =>
      ipcRenderer.invoke('storage:delete-container', args),
    createFolder: (args: CreateFolderArgs): Promise<void> =>
      ipcRenderer.invoke('storage:create-folder', args),
    deleteBlobs: (args: DeleteBlobsArgs): Promise<number> =>
      ipcRenderer.invoke('storage:delete-blobs', args),
    renameBlob: (args: RenameBlobArgs): Promise<string> =>
      ipcRenderer.invoke('storage:rename-blob', args),
    upload: (args: UploadArgs): Promise<string[]> => ipcRenderer.invoke('storage:upload', args),
    download: (args: DownloadArgs): Promise<string> =>
      ipcRenderer.invoke('storage:download', args)
  },
  app: {
    hide: (): Promise<boolean> => ipcRenderer.invoke('app:hide'),
    quit: (): Promise<void> => ipcRenderer.invoke('app:quit')
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
