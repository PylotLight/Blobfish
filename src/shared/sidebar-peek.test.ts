import { describe, expect, test } from "bun:test";
import {
  createSidebarPeek,
  PEEK_CLOSE_DELAY_MS,
  PEEK_OPEN_DELAY_MS,
  type PeekTimers,
} from "./sidebar-peek";

/** Manual clock: timers only fire when the test advances time. */
function harness() {
  let now = 0;
  let seq = 0;
  const pending = new Map<number, { at: number; fn: () => void }>();
  const timers: PeekTimers = {
    set: (fn, ms) => {
      const id = ++seq;
      pending.set(id, { at: now + ms, fn });
      return id;
    },
    clear: (id) => {
      pending.delete(id as number);
    },
  };
  const changes: boolean[] = [];
  const peek = createSidebarPeek({ timers, onChange: (v) => changes.push(v) });
  const tick = (ms: number): void => {
    const end = now + ms;
    for (;;) {
      let next: [number, { at: number; fn: () => void }] | null = null;
      for (const e of pending) if (!next || e[1].at < next[1].at) next = e;
      if (!next || next[1].at > end) break;
      pending.delete(next[0]);
      now = next[1].at;
      next[1].fn();
    }
    now = end;
  };
  return { peek, tick, changes, pending };
}

describe("sidebar peek", () => {
  test("opens after the open delay of real hover on the toggle", () => {
    const h = harness();
    h.peek.enter("toggle", true);
    h.tick(PEEK_OPEN_DELAY_MS - 1);
    expect(h.peek.isOpen()).toBe(false);
    h.tick(1);
    expect(h.peek.isOpen()).toBe(true);
    expect(h.changes).toEqual([true]);
  });

  test("left edge hot zone opens it too", () => {
    const h = harness();
    h.peek.enter("edge", true);
    h.tick(PEEK_OPEN_DELAY_MS);
    expect(h.peek.isOpen()).toBe(true);
  });

  test("brushing past (leave before the delay) never opens", () => {
    const h = harness();
    h.peek.enter("toggle", true);
    h.tick(100);
    h.peek.leave("toggle");
    h.tick(1000);
    expect(h.peek.isOpen()).toBe(false);
    expect(h.changes).toEqual([]);
  });

  test("synthetic (non-moving) pointer events don't arm it", () => {
    const h = harness();
    h.peek.enter("toggle", false);
    h.tick(1000);
    expect(h.peek.isOpen()).toBe(false);
    // the first real move arms it
    h.peek.enter("toggle", true);
    h.tick(PEEK_OPEN_DELAY_MS);
    expect(h.peek.isOpen()).toBe(true);
  });

  test("repeated moves don't restart the open delay", () => {
    const h = harness();
    h.peek.enter("toggle", true);
    h.tick(100);
    h.peek.enter("toggle", true);
    h.tick(50);
    expect(h.peek.isOpen()).toBe(true);
  });

  test("closes after the close delay once the pointer leaves", () => {
    const h = harness();
    h.peek.enter("toggle", true);
    h.tick(PEEK_OPEN_DELAY_MS);
    h.peek.leave("toggle");
    h.tick(PEEK_CLOSE_DELAY_MS - 1);
    expect(h.peek.isOpen()).toBe(true);
    h.tick(1);
    expect(h.peek.isOpen()).toBe(false);
    expect(h.changes).toEqual([true, false]);
  });

  test("moving from the toggle into the panel keeps it open", () => {
    const h = harness();
    h.peek.enter("toggle", true);
    h.tick(PEEK_OPEN_DELAY_MS);
    h.peek.leave("toggle");
    h.tick(40);
    h.peek.enter("panel", true);
    h.tick(5000);
    expect(h.peek.isOpen()).toBe(true);
    h.peek.leave("panel");
    h.tick(PEEK_CLOSE_DELAY_MS);
    expect(h.peek.isOpen()).toBe(false);
  });

  test("re-entering during the close delay cancels the close", () => {
    const h = harness();
    h.peek.enter("edge", true);
    h.tick(PEEK_OPEN_DELAY_MS);
    h.peek.leave("edge");
    h.tick(200);
    h.peek.enter("panel", false);
    h.tick(1000);
    expect(h.peek.isOpen()).toBe(true);
  });

  test("panel hover can't open it while hidden", () => {
    const h = harness();
    h.peek.enter("panel", true);
    h.tick(1000);
    expect(h.peek.isOpen()).toBe(false);
  });

  test("a context menu / dialog / focus hold keeps it open past the close delay", () => {
    for (const reason of ["menu", "dialog", "focus"] as const) {
      const h = harness();
      h.peek.enter("panel", true); // ignored, closed
      h.peek.enter("toggle", true);
      h.tick(PEEK_OPEN_DELAY_MS);
      h.peek.enter("panel", true);
      h.peek.hold(reason, true);
      h.peek.leave("panel");
      h.peek.leave("toggle");
      h.tick(5000);
      expect(h.peek.isOpen()).toBe(true);
      h.peek.hold(reason, false);
      h.tick(PEEK_CLOSE_DELAY_MS - 1);
      expect(h.peek.isOpen()).toBe(true);
      h.tick(1);
      expect(h.peek.isOpen()).toBe(false);
    }
  });

  test("released hold doesn't close while the pointer is still on the panel", () => {
    const h = harness();
    h.peek.enter("toggle", true);
    h.tick(PEEK_OPEN_DELAY_MS);
    h.peek.enter("panel", true);
    h.peek.leave("toggle");
    h.peek.hold("menu", true);
    h.peek.hold("menu", false);
    h.tick(5000);
    expect(h.peek.isOpen()).toBe(true);
  });

  test("dismiss (Escape / picking a container) closes immediately", () => {
    const h = harness();
    h.peek.enter("toggle", true);
    h.tick(PEEK_OPEN_DELAY_MS);
    h.peek.enter("panel", true);
    h.peek.hold("focus", true);
    h.peek.dismiss();
    expect(h.peek.isOpen()).toBe(false);
    expect(h.pending.size).toBe(0);
    // stale holds/hover are gone: next peek closes normally
    h.peek.enter("edge", true);
    h.tick(PEEK_OPEN_DELAY_MS);
    h.peek.leave("edge");
    h.tick(PEEK_CLOSE_DELAY_MS);
    expect(h.peek.isOpen()).toBe(false);
  });

  test("dismiss cancels a pending open", () => {
    const h = harness();
    h.peek.enter("toggle", true);
    h.tick(50);
    h.peek.dismiss();
    h.tick(1000);
    expect(h.peek.isOpen()).toBe(false);
  });

  test("after clicking the toggle it won't re-peek until the pointer leaves it", () => {
    const h = harness();
    h.peek.suppressUntilLeave();
    h.peek.enter("toggle", true);
    h.tick(1000);
    expect(h.peek.isOpen()).toBe(false);
    h.peek.leave("toggle");
    h.peek.enter("toggle", true);
    h.tick(PEEK_OPEN_DELAY_MS);
    expect(h.peek.isOpen()).toBe(true);
  });

  test("disabled (sidebar pinned open) never peeks and closes an open peek", () => {
    const h = harness();
    h.peek.enter("toggle", true);
    h.tick(PEEK_OPEN_DELAY_MS);
    h.peek.setEnabled(false);
    expect(h.peek.isOpen()).toBe(false);
    h.peek.enter("toggle", true);
    h.tick(1000);
    expect(h.peek.isOpen()).toBe(false);
    h.peek.setEnabled(true);
    h.peek.enter("toggle", true);
    h.tick(PEEK_OPEN_DELAY_MS);
    expect(h.peek.isOpen()).toBe(true);
  });

  test("disabling mid open-delay cancels the open", () => {
    const h = harness();
    h.peek.enter("edge", true);
    h.tick(100);
    h.peek.setEnabled(false);
    h.peek.setEnabled(true);
    h.tick(1000);
    expect(h.peek.isOpen()).toBe(false);
  });
});
