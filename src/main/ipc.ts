import { app, ipcMain, Notification, shell, type IpcMainInvokeEvent } from 'electron'
import * as os from 'node:os'
import { getGlassState, getMainWindow, setGlassVibrancy, showWindow } from './window'
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
import {
  addAccount,
  encryptionAvailable,
  listAccounts,
  removeAccount,
  setPinned,
  updateAccount
} from './accounts'
import {
  azuriteConnectionString,
  createContainer,
  createFolder,
  deleteContainer,
  deleteNames,
  downloadNames,
  listBlobs,
  listContainers,
  renameBlob,
  uploadPickedFiles
} from './azure'

const isMac = process.platform === 'darwin'

/** Materials offered in the Glass tab. All are valid on current Electron. */
const VIBRANCY_OPTIONS: readonly VibrancyName[] = [
  'fullscreen-ui',
  'under-window',
  'sidebar',
  'hud',
  'content',
  'popover',
  'menu',
  'titlebar'
]

function notify(title: string, body: string): boolean {
  if (!Notification.isSupported()) return false
  new Notification({ title, body }).show()
  return true
}

/**
 * All renderer → main calls. To add a tool:
 * 1. add an `ipcMain.handle('domain:action', …)` here,
 * 2. expose it in `src/preload/index.ts`,
 * 3. call it from the renderer via `window.api`.
 */
export function registerIpc(): void {
  ipcMain.handle('ping', () => 'pong')

  ipcMain.handle('sys:info', (): SysInfo => {
    return {
      platform: process.platform,
      arch: process.arch,
      release: os.release(),
      hostname: os.hostname(),
      cpus: os.cpus().length,
      totalMem: os.totalmem(),
      freeMem: os.freemem()
    }
  })

  ipcMain.handle(
    'notify:send',
    (_event: IpcMainInvokeEvent, payload: { title: string; body: string }): boolean =>
      notify(payload.title, payload.body)
  )

  ipcMain.handle('dock:set-badge', (_event: IpcMainInvokeEvent, count: number): boolean => {
    if (isMac) app.setBadgeCount(count)
    return isMac
  })

  ipcMain.handle('win:hide', () => getMainWindow()?.hide())
  ipcMain.handle('win:show', () => showWindow())
  ipcMain.handle('win:minimize', () => getMainWindow()?.minimize())
  ipcMain.handle('win:flash', () => getMainWindow()?.flashFrame(true))

  // Hide the whole app (macOS: Cmd+H behavior — window + dock indicator go away).
  ipcMain.handle('app:hide', (): boolean => {
    if (isMac) app.hide()
    else getMainWindow()?.hide()
    return true
  })

  // Tray-only mode: remove the dock icon entirely (macOS). Restore with dock:show.
  ipcMain.handle('dock:hide', (): boolean => {
    if (isMac) app.dock?.hide()
    return isMac
  })
  ipcMain.handle('dock:show', (): boolean => {
    if (isMac) app.dock?.show()
    return isMac
  })

  ipcMain.handle('glass:get', (): GlassState => getGlassState())
  ipcMain.handle(
    'glass:set',
    (_event: IpcMainInvokeEvent, name: VibrancyName | null): GlassState => {
      if (name !== null && !VIBRANCY_OPTIONS.includes(name)) return getGlassState()
      return setGlassVibrancy(name)
    }
  )
  ipcMain.handle('glass:options', (): readonly VibrancyName[] => VIBRANCY_OPTIONS)

  ipcMain.handle('shell:open', (_event: IpcMainInvokeEvent, url: string): boolean => {
    if (!url.startsWith('https://')) return false
    void shell.openExternal(url)
    return true
  })

  ipcMain.handle('app:quit', () => app.quit())

  // ----- Blobfish storage accounts (secrets stay in main via safeStorage) -----
  ipcMain.handle('accounts:encryption', (): boolean => encryptionAvailable())
  ipcMain.handle('accounts:list', (): AccountSummary[] => listAccounts())
  ipcMain.handle(
    'accounts:add',
    (_event: IpcMainInvokeEvent, input: AccountCreateInput): AccountSummary =>
      addAccount(input)
  )
  ipcMain.handle(
    'accounts:remove',
    (_event: IpcMainInvokeEvent, id: string): boolean => removeAccount(id)
  )
  ipcMain.handle(
    'accounts:update',
    (_event: IpcMainInvokeEvent, id: string, patch: AccountUpdateInput): AccountSummary =>
      updateAccount(id, patch)
  )
  ipcMain.handle(
    'accounts:pin',
    (_event: IpcMainInvokeEvent, id: string, pinned: boolean): AccountSummary =>
      setPinned(id, pinned)
  )
  ipcMain.handle('accounts:azurite-template', (): string => azuriteConnectionString())
  ipcMain.handle(
    'storage:list-containers',
    (_event: IpcMainInvokeEvent, accountId: string): Promise<StorageContainer[]> =>
      listContainers(accountId)
  )
  ipcMain.handle(
    'storage:list-blobs',
    (_event: IpcMainInvokeEvent, args: ListBlobsArgs): Promise<ListBlobsResult> =>
      listBlobs(args.accountId, args.container, args.prefix, args.pageSize)
  )
  ipcMain.handle(
    'storage:create-container',
    (_event: IpcMainInvokeEvent, args: ContainerActionArgs): Promise<void> =>
      createContainer(args.accountId, args.container)
  )
  ipcMain.handle(
    'storage:delete-container',
    (_event: IpcMainInvokeEvent, args: ContainerActionArgs): Promise<void> =>
      deleteContainer(args.accountId, args.container)
  )
  ipcMain.handle(
    'storage:create-folder',
    (_event: IpcMainInvokeEvent, args: CreateFolderArgs): Promise<void> =>
      createFolder(args.accountId, args.container, args.prefix, args.folderName)
  )
  ipcMain.handle(
    'storage:delete-blobs',
    (_event: IpcMainInvokeEvent, args: DeleteBlobsArgs): Promise<number> =>
      deleteNames(args.accountId, args.container, args.names)
  )
  ipcMain.handle(
    'storage:rename-blob',
    (_event: IpcMainInvokeEvent, args: RenameBlobArgs): Promise<string> =>
      renameBlob(args.accountId, args.container, args.source, args.destLeaf)
  )
  ipcMain.handle(
    'storage:upload',
    (_event: IpcMainInvokeEvent, args: UploadArgs): Promise<string[]> =>
      uploadPickedFiles(args.accountId, args.container, args.prefix)
  )
  ipcMain.handle(
    'storage:download',
    (_event: IpcMainInvokeEvent, args: DownloadArgs): Promise<string> =>
      downloadNames(args.accountId, args.container, args.names)
  )
}
