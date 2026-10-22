/**
 * Hover-peek for the collapsed sidebar (pure, timers injected so it's testable).
 *
 * Collapsed sidebar = a floating popover that slides in while the pointer rests on the
 * sidebar toggle or the left window edge, and slides away a beat after it leaves.
 *
 * - open after `openDelay` of real hover (brushing past doesn't flicker it open);
 * - close `closeDelay` after the pointer has left every zone (toggle, edge, panel);
 * - holds (a context menu / dialog spawned from it, keyboard focus inside) keep it open,
 *   and the close countdown starts once the last hold is released;
 * - `dismiss()` (Escape, picking a container, click-away) closes right away;
 * - `suppressUntilLeave()`: after the toggle is clicked the pointer is still on it; don't
 *   peek straight back open until it has left the toggle once.
 */

export const PEEK_OPEN_DELAY_MS = 150;
export const PEEK_CLOSE_DELAY_MS = 300;

export type PeekZone = "toggle" | "edge" | "panel";
export type PeekHold = "menu" | "dialog" | "focus";

export interface PeekTimers {
  set: (fn: () => void, ms: number) => unknown;
  clear: (id: unknown) => void;
}

export interface SidebarPeekOptions {
  onChange: (open: boolean) => void;
  timers?: PeekTimers;
  openDelay?: number;
  closeDelay?: number;
}

export interface SidebarPeek {
  /** Pointer is over a trigger zone. `real` = an actual pointer move (not Chromium's synthetic one). */
  enter: (zone: PeekZone, real: boolean) => void;
  leave: (zone: PeekZone) => void;
  hold: (reason: PeekHold, on: boolean) => void;
  /** Only peeks while the sidebar is collapsed; disabling closes it. */
  setEnabled: (on: boolean) => void;
  dismiss: () => void;
  suppressUntilLeave: () => void;
  isOpen: () => boolean;
  dispose: () => void;
}

const defaultTimers: PeekTimers = {
  set: (fn, ms) => setTimeout(fn, ms),
  clear: (id) => clearTimeout(id as ReturnType<typeof setTimeout>),
};

export function createSidebarPeek(opts: SidebarPeekOptions): SidebarPeek {
  const timers = opts.timers ?? defaultTimers;
  const openDelay = opts.openDelay ?? PEEK_OPEN_DELAY_MS;
  const closeDelay = opts.closeDelay ?? PEEK_CLOSE_DELAY_MS;
  const hovering = new Set<PeekZone>();
  const holds = new Set<PeekHold>();
  let open = false;
  let enabled = true;
  let suppressed = false;
  let openTimer: unknown = null;
  let closeTimer: unknown = null;

  const cancelOpen = (): void => {
    if (openTimer !== null) timers.clear(openTimer);
    openTimer = null;
  };
  const cancelClose = (): void => {
    if (closeTimer !== null) timers.clear(closeTimer);
    closeTimer = null;
  };
  const setOpen = (v: boolean): void => {
    if (open === v) return;
    open = v;
    opts.onChange(v);
  };
  const triggerHovered = (): boolean =>
    hovering.has("toggle") || hovering.has("edge");

  const maybeScheduleClose = (): void => {
    if (!open || hovering.size > 0 || holds.size > 0 || closeTimer !== null)
      return;
    closeTimer = timers.set(() => {
      closeTimer = null;
      if (hovering.size === 0 && holds.size === 0) setOpen(false);
    }, closeDelay);
  };

  const dismiss = (): void => {
    cancelOpen();
    cancelClose();
    hovering.clear();
    holds.clear();
    setOpen(false);
  };

  return {
    enter(zone, real) {
      if (!enabled) return;
      if (zone === "panel") {
        // The panel only takes the pointer while it's showing.
        if (!open) return;
        hovering.add(zone);
        cancelClose();
        return;
      }
      if (suppressed && zone === "toggle") return;
      hovering.add(zone);
      cancelClose();
      if (open || openTimer !== null || !real) return;
      openTimer = timers.set(() => {
        openTimer = null;
        if (enabled && triggerHovered()) setOpen(true);
      }, openDelay);
    },
    leave(zone) {
      if (zone === "toggle") suppressed = false;
      hovering.delete(zone);
      if (!triggerHovered()) cancelOpen();
      maybeScheduleClose();
    },
    hold(reason, on) {
      if (on) {
        if (!open) return;
        holds.add(reason);
        cancelClose();
      } else {
        holds.delete(reason);
        maybeScheduleClose();
      }
    },
    setEnabled(on) {
      enabled = on;
      if (!on) dismiss();
    },
    dismiss,
    suppressUntilLeave() {
      suppressed = true;
      cancelOpen();
      hovering.delete("toggle");
    },
    isOpen: () => open,
    dispose() {
      cancelOpen();
      cancelClose();
    },
  };
}
