import { Menu, app } from 'electron'

const isMac = process.platform === 'darwin'

/**
 * A real application menu. Without one, macOS loses standard shortcuts:
 * Cmd+C/V/X in inputs AND the full zoom trio (in / out / reset).
 * Roles keep every action native, including zoom limits handled by Chromium.
 */
export function createAppMenu(): void {
  const template: Electron.MenuItemConstructorOptions[] = []

  if (isMac) {
    template.push({
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' }
      ]
    })
  }

  template.push({
    label: 'Edit',
    submenu: [
      { role: 'undo' },
      { role: 'redo' },
      { type: 'separator' },
      { role: 'cut' },
      { role: 'copy' },
      { role: 'paste' },
      { role: 'selectAll' }
    ]
  })

  template.push({
    label: 'View',
    submenu: [
      { role: 'zoomIn', accelerator: 'CommandOrControl==', visible: true },
      { role: 'zoomIn', accelerator: 'CommandOrControl+Plus', visible: false },
      { role: 'zoomOut' },
      { role: 'resetZoom', accelerator: 'CommandOrControl+0' },
      { type: 'separator' },
      { role: 'togglefullscreen' }
    ]
  })

  template.push({
    label: 'Window',
    submenu: [{ role: 'minimize' }, { role: 'close' }]
  })

  Menu.setApplicationMenu(Menu.buildFromTemplate(template))

  // Keep zoom sane: never let a stuck shortcut blow the layout out.
  app.on('browser-window-created', (_, window) => {
    window.webContents.on('zoom-changed', (_event, direction) => {
      const level = window.webContents.getZoomLevel()
      if (direction === 'in' && level > 3) window.webContents.setZoomLevel(3)
      if (direction === 'out' && level < -3) window.webContents.setZoomLevel(-3)
    })
  })
}
