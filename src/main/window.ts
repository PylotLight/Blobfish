import { BrowserWindow, app, screen, shell, type Rectangle } from "electron";
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { is } from "@electron-toolkit/utils";
import { WINDOW } from "../shared/config";
import type { GlassState, VibrancyName } from "../shared/types";
import {
  centerOnArea,
  fitBoundsToDisplays,
  parseSavedWindowState,
  type SavedWindowState,
} from "../shared/window-geometry";

const isMac = process.platform === "darwin";

let mainWindow: BrowserWindow | null = null;

const DEFAULT_VIBRANCY: VibrancyName = "fullscreen-ui";
let currentVibrancy: VibrancyName | null = isMac ? DEFAULT_VIBRANCY : null;

export function getMainWindow(): BrowserWindow | null {
  return mainWindow;
}

/** electron-vite emits out/preload/index.js or index.mjs depending on config — accept both. */
function resolvePreload(): string {
  const base = join(__dirname, "../preload/index");
  if (existsSync(`${base}.js`)) return `${base}.js`;
  return `${base}.mjs`;
}

/** App icon (`build/icon.png`). Resolves in every layout:
 * - `bun run dev` / `bun run start`: out/main → repo root
 * - packaged: app.asar/out/main → app.asar (shipped via `files`) */
export function resolveAppIcon(): string | undefined {
  const p = join(__dirname, "../../build/icon.png");
  return existsSync(p) ? p : undefined;
}

// Window state (ported from Surffish via Inkfish #49): the main window reopens where you left
// it (size, position, maximized, full screen), fitted back onto a display that still exists.
const WINDOW_STATE_FILE = "window-state.json";
const SAVE_DELAY_MS = 500;
const MIN_SIZE = { width: WINDOW.minWidth, height: WINDOW.minHeight };

function windowStatePath(): string {
  return join(app.getPath("userData"), WINDOW_STATE_FILE);
}

function loadWindowState(): SavedWindowState | null {
  try {
    const path = windowStatePath();
    if (!existsSync(path)) return null;
    const saved = parseSavedWindowState(JSON.parse(readFileSync(path, "utf8")));
    if (!saved) return null;
    const areas = screen.getAllDisplays().map((d) => d.workArea);
    const bounds =
      fitBoundsToDisplays(saved.bounds, areas, MIN_SIZE) ??
      centerOnArea(saved.bounds, screen.getPrimaryDisplay().workArea, MIN_SIZE);
    return { ...saved, bounds };
  } catch (err) {
    console.warn(
      "[window] could not read window state:",
      err instanceof Error ? err.message : String(err),
    );
    return null;
  }
}

function saveWindowState(win: BrowserWindow, normalBounds: Rectangle): void {
  if (win.isDestroyed()) return;
  const state: SavedWindowState = {
    // Normal (un-maximized) bounds, so un-maximizing after a relaunch goes back to your size.
    bounds: normalBounds,
    maximized: win.isMaximized(),
    fullScreen: win.isFullScreen(),
  };
  try {
    const path = windowStatePath();
    writeFileSync(`${path}.tmp`, JSON.stringify(state));
    renameSync(`${path}.tmp`, path);
  } catch (err) {
    console.warn(
      "[window] could not save window state:",
      err instanceof Error ? err.message : String(err),
    );
  }
}

function trackWindowState(win: BrowserWindow): void {
  // Track normal bounds ourselves: a window that launched maximized has no earlier normal size
  // on Linux, so getNormalBounds() there returns the maximized rect and the size would be lost.
  let normalBounds = win.getBounds();
  let timer: NodeJS.Timeout | null = null;
  const schedule = (): void => {
    if (
      !win.isDestroyed() &&
      !win.isMaximized() &&
      !win.isFullScreen() &&
      !win.isMinimized()
    ) {
      normalBounds = win.getBounds();
    }
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      saveWindowState(win, normalBounds);
    }, SAVE_DELAY_MS);
  };
  for (const event of [
    "resize",
    "move",
    "maximize",
    "unmaximize",
    "enter-full-screen",
    "leave-full-screen",
  ] as const) {
    win.on(event as "resize", schedule);
  }
  // 'close' fires before the window goes away (quit included), so the last state always lands.
  win.on("close", () => {
    if (timer) clearTimeout(timer);
    timer = null;
    saveWindowState(win, normalBounds);
  });
}

export function createWindow(): BrowserWindow {
  const saved = loadWindowState();
  const win = new BrowserWindow({
    width: saved?.bounds.width ?? WINDOW.width,
    height: saved?.bounds.height ?? WINDOW.height,
    ...(saved ? { x: saved.bounds.x, y: saved.bounds.y } : {}),
    minWidth: WINDOW.minWidth,
    minHeight: WINDOW.minHeight,
    show: false,
    autoHideMenuBar: true,
    // Window/taskbar icon on Linux/Windows (macOS uses the bundle icon).
    icon: resolveAppIcon(),
    // macOS glass: native vibrancy + transparent window + inset traffic lights.
    // The renderer MUST stay translucent (see index.css) or the blur is covered up.
    titleBarStyle: isMac ? "hiddenInset" : "default",
    trafficLightPosition: isMac ? { x: 16, y: 16 } : undefined,
    transparent: isMac,
    vibrancy: currentVibrancy ?? undefined,
    visualEffectState: isMac ? "active" : undefined,
    backgroundColor: isMac ? "#00000000" : "#101418",
    webPreferences: {
      preload: resolvePreload(),
      sandbox: false,
      contextIsolation: true,
      // Electron 45 (from Surffish): Blobfish never plays media, and the window
      // spends most of its life hidden behind the tray, so it never needs to
      // hold a screen/system wake lock. backgroundThrottling stays on (default):
      // transfers run in main, so a hidden renderer can be throttled freely.
      disableWakeLocks: true,
    },
  });

  win.on("ready-to-show", () => {
    if (saved?.maximized) win.maximize();
    if (saved?.fullScreen) win.setFullScreen(true);
    win.show();
  });
  trackWindowState(win);

  win.webContents.setWindowOpenHandler((details) => {
    void shell.openExternal(details.url);
    return { action: "deny" };
  });

  if (is.dev && process.env["ELECTRON_RENDERER_URL"]) {
    void win.loadURL(process.env["ELECTRON_RENDERER_URL"]);
  } else {
    void win.loadFile(join(__dirname, "../renderer/index.html"));
  }

  win.on("closed", () => {
    if (mainWindow === win) mainWindow = null;
  });

  mainWindow = win;
  return win;
}

export function showWindow(): void {
  // app.hide()/dock.hide() on macOS also require re-showing the app itself.
  if (isMac) app.show();
  const win = mainWindow;
  if (!win) {
    createWindow();
    return;
  }
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

export function hideWindow(): void {
  mainWindow?.hide();
}

export function getGlassState(): GlassState {
  return {
    platform: process.platform,
    vibrancy: currentVibrancy,
    transparent: isMac,
  };
}

export function setGlassVibrancy(name: VibrancyName | null): GlassState {
  currentVibrancy = isMac ? name : null;
  mainWindow?.setVibrancy(currentVibrancy);
  return getGlassState();
}
