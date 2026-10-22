import { describe, expect, test } from "bun:test";
import {
  EMPTY_ENTRY,
  TREE_PAGE,
  entryOf,
  needsLoad,
  nextTreeFocus,
  readyListings,
  treeReducer,
  visibleSlice,
  type TreeState,
} from "./container-tree";

const names = (n: number): { name: string }[] =>
  Array.from({ length: n }, (_, i) => ({
    name: `c${String(i).padStart(4, "0")}`,
  }));

describe("treeReducer", () => {
  test("load once: idle -> loading -> ready (sorted)", () => {
    let s: TreeState = {};
    expect(needsLoad(s.a)).toBe(true);
    s = treeReducer(s, { type: "start", accountId: "a", seq: 1 });
    expect(entryOf(s, "a").status).toBe("loading");
    expect(needsLoad(s.a)).toBe(false);
    s = treeReducer(s, {
      type: "success",
      accountId: "a",
      seq: 1,
      items: [{ name: "zeta" }, { name: "alpha" }],
    });
    expect(entryOf(s, "a").status).toBe("ready");
    expect(entryOf(s, "a").items.map((c) => c.name)).toEqual(["alpha", "zeta"]);
    expect(needsLoad(s.a)).toBe(false);
  });

  test("a stale response never overwrites a newer refresh", () => {
    let s: TreeState = {};
    s = treeReducer(s, { type: "start", accountId: "a", seq: 1 });
    s = treeReducer(s, { type: "start", accountId: "a", seq: 2 });
    s = treeReducer(s, {
      type: "success",
      accountId: "a",
      seq: 1,
      items: [{ name: "old" }],
    });
    expect(entryOf(s, "a").status).toBe("loading");
    s = treeReducer(s, { type: "failure", accountId: "a", seq: 1, error: "x" });
    expect(entryOf(s, "a").status).toBe("loading");
    s = treeReducer(s, {
      type: "success",
      accountId: "a",
      seq: 2,
      items: [{ name: "new" }],
    });
    expect(entryOf(s, "a").items).toEqual([{ name: "new" }]);
  });

  test("refresh keeps the old rows visible until the new list lands", () => {
    let s: TreeState = {};
    s = treeReducer(s, { type: "start", accountId: "a", seq: 1 });
    s = treeReducer(s, {
      type: "success",
      accountId: "a",
      seq: 1,
      items: names(3),
    });
    s = treeReducer(s, { type: "start", accountId: "a", seq: 2 });
    expect(entryOf(s, "a").items).toHaveLength(3);
    expect(readyListings(s).a).toHaveLength(3);
  });

  test("failure is an error state, not an empty account", () => {
    let s: TreeState = {};
    s = treeReducer(s, { type: "start", accountId: "a", seq: 1 });
    s = treeReducer(s, {
      type: "failure",
      accountId: "a",
      seq: 1,
      error: "403",
    });
    expect(entryOf(s, "a")).toMatchObject({
      status: "error",
      error: "403",
      items: [],
    });
    // stays put on re-expand; only an explicit refresh retries
    expect(needsLoad(s.a)).toBe(false);
    expect(readyListings(s).a).toBeUndefined();
  });

  test("forget drops the account, other accounts untouched", () => {
    let s: TreeState = {};
    s = treeReducer(s, { type: "start", accountId: "a", seq: 1 });
    s = treeReducer(s, { type: "start", accountId: "b", seq: 2 });
    s = treeReducer(s, { type: "forget", accountId: "a" });
    expect(s.a).toBeUndefined();
    expect(s.b?.status).toBe("loading");
    expect(treeReducer(s, { type: "forget", accountId: "zzz" })).toBe(s);
  });
});

describe("visibleSlice / show more", () => {
  test("first page, then one page per Show more", () => {
    let s: TreeState = {};
    s = treeReducer(s, { type: "start", accountId: "a", seq: 1 });
    s = treeReducer(s, {
      type: "success",
      accountId: "a",
      seq: 1,
      items: names(120),
    });
    let v = visibleSlice(entryOf(s, "a"));
    expect(v.shown).toHaveLength(TREE_PAGE);
    expect(v.hidden).toBe(120 - TREE_PAGE);
    s = treeReducer(s, { type: "more", accountId: "a" });
    v = visibleSlice(entryOf(s, "a"));
    expect(v.shown).toHaveLength(TREE_PAGE * 2);
    s = treeReducer(s, { type: "more", accountId: "a" });
    v = visibleSlice(entryOf(s, "a"));
    expect(v.shown).toHaveLength(120);
    expect(v.hidden).toBe(0);
  });

  test("small lists show everything", () => {
    const v = visibleSlice({
      ...EMPTY_ENTRY,
      status: "ready",
      items: names(3),
    });
    expect(v).toEqual({ shown: names(3), hidden: 0 });
  });
});

describe("nextTreeFocus", () => {
  test("arrows clamp, Home/End jump, other keys ignored", () => {
    expect(nextTreeFocus(5, 2, "ArrowDown")).toBe(3);
    expect(nextTreeFocus(5, 4, "ArrowDown")).toBe(4);
    expect(nextTreeFocus(5, 0, "ArrowUp")).toBe(0);
    expect(nextTreeFocus(5, -1, "ArrowDown")).toBe(0);
    expect(nextTreeFocus(5, -1, "ArrowUp")).toBe(4);
    expect(nextTreeFocus(5, 3, "Home")).toBe(0);
    expect(nextTreeFocus(5, 1, "End")).toBe(4);
    expect(nextTreeFocus(5, 1, "Enter")).toBeNull();
    expect(nextTreeFocus(0, 0, "ArrowDown")).toBeNull();
  });
});
