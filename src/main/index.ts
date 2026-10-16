// Crash guard before everything else: catches errors thrown while the app's own modules load.
import './crash-guard'
import { app, BrowserWindow, dialog, type MessageBoxOptions } from 'electron'
import { electronApp, optimizer } from '@electron-toolkit/utils'
import { APP_ID } from '../shared/config'
import { migrateAccountSecrets } from './accounts'
import { registerIpc } from './ipc'
import { createAppMenu } from './menu'
import { createAppTray, destroyTray } from './tray'
import { createWindow, getMainWindow, hideWindow, resolveAppIcon, showWindow } from './window'
import { loadActivities, saveActivities } from './activity'
import { inFlightCounts, stopTransfersForQuit } from './transfers'
import { createShutdown, quitWarning } from '../shared/stability'
import { initializeUpdates, registerUpdateIpc } from './updates'

// Single instance: a second launch focuses the existing window instead of forking.
const primaryInstance = app.requestSingleInstanceLock()
if (!primaryInstance) {
  app.quit()
}

app.whenReady().then(() => {
  electronApp.setAppUserModelId(APP_ID)

  // Dev on macOS runs outside an app bundle (Electron's dock icon), so pin
  // our icon explicitly. Release builds get it from the bundled .icns.
  if (process.platform === 'darwin' && !app.isPackaged) {
    const icon = resolveAppIcon()
    if (icon) {
      try {
        app.dock?.setIcon(icon)
      } catch {
        // ignore — dock icon is cosmetic
      }
    }
  }

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  // Last session's activity feed (written by the ordered shutdown below).
  loadActivities()
  registerIpc()
  registerUpdateIpc()
  // Electron 45 async safeStorage: re-seal stored secrets if the keychain asks (background, once).
  migrateAccountSecrets()
  createAppMenu()
  createWindow()
  // Release notifications from the GitHub releases feed (first check ~30 s after launch, then every 6 h).
  initializeUpdates()
  createAppTray({
    onShow: showWindow,
    onHide: hideWindow,
    onQuit: () => app.quit()
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('second-instance', () => showWindow())

// On macOS the app stays alive in the tray after the window closes.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

// Ordered shutdown (ported from Surffish #136 via Inkfish #48): stop the transfer engines first
// (queued rows cancelled, active ones aborted and unwound so partial downloads are removed and
// every cancel is logged), then persist the activity feed, then tear down the tray. A failing or
// slow step is logged and the rest still run.
const shutdown = createShutdown(
  [
    { name: 'transfers', run: async () => void (await stopTransfersForQuit()) },
    { name: 'activity log', run: saveActivities },
    { name: 'tray', run: destroyTray }
  ],
  (message) => console.warn(message)
)

let quitReady = false
let quitPending = false

async function confirmQuitWithTransfers(): Promise<boolean> {
  const { active, queued } = inFlightCounts()
  const warning = quitWarning(active, queued)
  if (!warning) return true
  const options: MessageBoxOptions = {
    type: 'warning',
    buttons: ['Quit anyway', 'Keep transferring'],
    defaultId: 1,
    cancelId: 1,
    noLink: true,
    message: warning.message,
    detail: warning.detail
  }
  const win = getMainWindow()
  const { response } = win && !win.isDestroyed() && win.isVisible()
    ? await dialog.showMessageBox(win, options)
    : await dialog.showMessageBox(options)
  return response === 0
}

app.on('before-quit', (event) => {
  // A second instance bowing out must not run the shutdown (it would overwrite the activity log).
  if (quitReady || !primaryInstance) return
  event.preventDefault()
  if (quitPending) return
  quitPending = true
  void (async () => {
    try {
      if (!(await confirmQuitWithTransfers())) {
        quitPending = false
        showWindow()
        return
      }
      await shutdown()
    } catch (error) {
      console.error('[shutdown] quit sequence failed:', error)
    }
    quitReady = true
    app.quit()
  })()
})
