import { describe, expect, test } from "bun:test";
import {
  ACTIVITY_MAX_AGE_MS,
  ACTIVITY_PERSIST_LIMIT,
  parseActivityEntry,
  parsePersistedActivities,
  serializeActivities,
} from "./activity-store";
import type { ActivityEntry } from "./types";

const NOW = 1_800_000_000_000;
const entry = (
  id: string,
  at: number,
  patch: Partial<ActivityEntry> = {},
): ActivityEntry => ({
  id,
  at,
  kind: "transfer",
  text: `Download '${id}' complete`,
  status: "success",
  ...patch,
});

describe("activity store", () => {
  test("round-trips entries newest first", () => {
    const list = [
      entry("b", NOW - 1000, {
        localPath: "/tmp/b.txt",
        transferDirection: "download",
        durationMs: 12,
        container: "c",
        accountId: "acc",
      }),
      entry("a", NOW - 5000, {
        status: "failed",
        detail: "Blobfish quit before it started",
        fileDeleted: true,
      }),
    ];
    const parsed = parsePersistedActivities(
      JSON.parse(serializeActivities(list)),
      NOW,
    );
    // Read back = last session's history.
    expect(parsed).toEqual(list.map((e) => ({ ...e, restored: true })));
  });

  test("failed reads (list containers etc.) are not persisted or replayed", () => {
    const list = [
      entry("ok", NOW - 10),
      entry("list-fail", NOW - 20, {
        kind: "connection",
        status: "failed",
        text: "List containers in 'acct' failed",
        detail:
          "Failed to list containers: self signed certificate in certificate chain",
      }),
      entry("sas", NOW - 30, { kind: "connection", text: "Created SAS" }),
      entry("upload-fail", NOW - 40, { status: "failed" }),
    ];
    const json = JSON.parse(serializeActivities(list));
    expect(json.entries.map((e: ActivityEntry) => e.id)).toEqual([
      "ok",
      "sas",
      "upload-fail",
    ]);
    // An old activity.json that already holds one is pruned on load too.
    const parsed = parsePersistedActivities({ version: 1, entries: list }, NOW);
    expect(parsed.map((e) => e.id)).toEqual(["ok", "sas", "upload-fail"]);
    expect(parsed.every((e) => e.restored === true)).toBe(true);
  });

  test("the restored flag is never written back to disk", () => {
    const json = serializeActivities([entry("a", NOW, { restored: true })]);
    expect(json).not.toContain("restored");
  });

  test("drops junk, unknown kinds, duplicates, stale and future entries", () => {
    const parsed = parsePersistedActivities(
      {
        version: 1,
        entries: [
          entry("ok", NOW - 10),
          entry("ok", NOW - 20),
          { ...entry("bad-kind", NOW), kind: "nope" },
          { ...entry("bad-status", NOW), status: "maybe" },
          { id: "no-text", at: NOW, kind: "blob", status: "success" },
          entry("old", NOW - ACTIVITY_MAX_AGE_MS - 1),
          entry("future", NOW + 10 * 60_000),
          null,
          "string",
        ],
      },
      NOW,
    );
    expect(parsed.map((e) => e.id)).toEqual(["ok"]);
  });

  test("wrong version or shape → empty", () => {
    expect(parsePersistedActivities(null, NOW)).toEqual([]);
    expect(
      parsePersistedActivities({ version: 2, entries: [entry("a", NOW)] }, NOW),
    ).toEqual([]);
    expect(parsePersistedActivities({ version: 1, entries: "x" }, NOW)).toEqual(
      [],
    );
  });

  test("caps the list and strips unknown keys", () => {
    const many = Array.from({ length: ACTIVITY_PERSIST_LIMIT + 30 }, (_, i) =>
      entry(`e${i}`, NOW - i),
    );
    expect(
      parsePersistedActivities({ version: 1, entries: many }, NOW).length,
    ).toBe(ACTIVITY_PERSIST_LIMIT);
    expect(parseActivityEntry({ ...entry("x", NOW), secret: "nope" })).toEqual(
      entry("x", NOW),
    );
  });
});
