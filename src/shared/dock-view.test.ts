import { describe, expect, test } from "bun:test";
import {
  HOVER_ARM_MS,
  dockPill,
  earlierIndex,
  hoverMayOpen,
  relativeWhen,
  sessionDone,
} from "./dock-view";
import type { ActivityEntry } from "./types";

type A = Pick<ActivityEntry, "kind" | "status" | "restored">;
const idle = { active: 0, queued: 0, leftover: 0, rows: 0 };

describe("dockPill", () => {
  test("nothing at all hides the dock", () => {
    expect(dockPill([], idle).visible).toBe(false);
  });

  test("restored failures from last session are history, not news", () => {
    const acts: A[] = [
      { kind: "connection", status: "failed", restored: true },
      { kind: "transfer", status: "failed", restored: true },
      { kind: "transfer", status: "success", restored: true },
    ];
    const pill = dockPill(acts, idle);
    expect(pill).toEqual({
      visible: true,
      tone: "idle",
      status: "idle",
      done: 0,
      failed: 0,
    });
  });

  test("this session's finished download counts as done (row already gone)", () => {
    const pill = dockPill([{ kind: "transfer", status: "success" }], idle);
    expect(pill.tone).toBe("done");
    expect(pill.status).toBe("1 done");
  });

  test("background read failures never colour the pill", () => {
    const pill = dockPill([{ kind: "connection", status: "failed" }], idle);
    expect(pill.tone).toBe("idle");
  });

  test("leftover failed/cancelled rows win over done", () => {
    const pill = dockPill([{ kind: "transfer", status: "success" }], {
      ...idle,
      leftover: 2,
      rows: 2,
    });
    expect(pill).toMatchObject({ tone: "failed", status: "2 failed" });
  });

  test("work in flight is busy", () => {
    expect(
      dockPill([], { active: 1, queued: 3, leftover: 0, rows: 4 }),
    ).toMatchObject({ tone: "busy", status: "1 active" });
    expect(
      dockPill([], { active: 0, queued: 3, leftover: 0, rows: 3 }),
    ).toMatchObject({ tone: "busy", status: "3 queued" });
  });

  test("sessionDone ignores other kinds and restored entries", () => {
    expect(
      sessionDone([
        { kind: "transfer", status: "success" },
        { kind: "transfer", status: "success", restored: true },
        { kind: "blob", status: "success" },
        { kind: "transfer", status: "failed" },
      ]),
    ).toBe(1);
  });
});

describe("earlierIndex", () => {
  test("points at the first restored entry", () => {
    expect(earlierIndex([{}, {}, { restored: true }, { restored: true }])).toBe(
      2,
    );
    expect(earlierIndex([{}, {}])).toBe(-1);
  });
});

describe("relativeWhen", () => {
  const now = new Date(2026, 9, 23, 10, 30).getTime();
  test("recent", () => {
    expect(relativeWhen(now - 20_000, now)).toBe("just now");
    expect(relativeWhen(now - 5 * 60_000, now)).toBe("5 min ago");
  });
  test("today / yesterday with a 12 h clock", () => {
    expect(relativeWhen(new Date(2026, 9, 23, 8, 5).getTime(), now)).toBe(
      "today 8:05 am",
    );
    expect(relativeWhen(new Date(2026, 9, 22, 21, 10).getTime(), now)).toBe(
      "yesterday 9:10 pm",
    );
    expect(relativeWhen(new Date(2026, 9, 22, 0, 0).getTime(), now)).toBe(
      "yesterday 12:00 am",
    );
  });
  test("this week, then dates", () => {
    expect(relativeWhen(new Date(2026, 9, 19, 12, 0).getTime(), now)).toBe(
      "Mon 12:00 pm",
    );
    expect(relativeWhen(new Date(2026, 9, 12, 12, 0).getTime(), now)).toBe(
      "12 Oct",
    );
    expect(relativeWhen(new Date(2025, 11, 31, 12, 0).getTime(), now)).toBe(
      "31 Dec 2025",
    );
  });
});

describe("hoverMayOpen", () => {
  test("ignores the synthetic zero-movement move at launch", () => {
    expect(hoverMayOpen(HOVER_ARM_MS + 500, 0, 0)).toBe(false);
  });
  test("ignores moves right after mount", () => {
    expect(hoverMayOpen(100, 3, 1)).toBe(false);
  });
  test("a real move after arming opens", () => {
    expect(hoverMayOpen(HOVER_ARM_MS, 0, -2)).toBe(true);
  });
});
