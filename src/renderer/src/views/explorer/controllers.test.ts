import { describe, expect, test } from "bun:test";
import type { Dispatch, SetStateAction } from "react";
import type { StorageContainer } from "../../../../shared/types";
import { createExplorerNav, type ExplorerNavContext } from "./useExplorerNav";

type State<T> = { value: T };

function setter<T>(state: State<T>): Dispatch<SetStateAction<T>> {
  return (next) => {
    state.value =
      typeof next === "function"
        ? (next as (current: T) => T)(state.value)
        : next;
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("createExplorerNav", () => {
  test("ignores stale container results and errors, including their loading and selection side effects", async () => {
    const requests = [
      deferred<StorageContainer[]>(),
      deferred<StorageContainer[]>(),
    ];
    let requestIndex = 0;
    const previousWindow = (globalThis as { window?: unknown }).window;
    (globalThis as { window?: unknown }).window = {
      api: {
        storage: { listContainers: () => requests[requestIndex++]!.promise },
      },
    };

    const containers: State<StorageContainer[]> = { value: [{ name: "old" }] };
    const selected: State<string | null> = { value: "old" };
    const selection: State<Set<string>> = { value: new Set(["blob.txt"]) };
    const loading: boolean[] = [];
    const failures: unknown[] = [];
    const changes: (string | null)[] = [];
    const containerRef = { current: "old" as string | null };
    const containerSeq = { current: 0 };
    const base: ExplorerNavContext = {
      accountId: "account",
      scoped: false,
      containerRef,
      navPrefixRef: { current: "" },
      containerSeq,
      showDeletedRef: { current: false },
      navPrefix: "",
      backHist: [],
      fwdHist: [],
      listing: { load: () => undefined },
      props: {
        onContainerChange: (container) => changes.push(container ?? null),
      },
      setContainer: setter(selected),
      setActiveTab: () => undefined,
      setCtx: () => undefined,
      setOptsMenu: () => undefined,
      setNavPrefix: () => undefined,
      setBackHist: () => undefined,
      setFwdHist: () => undefined,
      setSelection: setter(selection),
      setLoadingContainers: (value) => loading.push(value),
      setContainersError: () => undefined,
      setContainers: setter(containers),
      setBlobError: () => undefined,
      setActionError: () => undefined,
      fail: (error, context) => failures.push({ error, context }),
    };

    try {
      const nav = createExplorerNav(base);
      nav.loadContainers("account");
      nav.loadContainers("account");
      const newest = [{ name: "newest" }];
      requests[1]!.resolve(newest);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();

      expect(containers.value).toEqual(newest);
      expect(selected.value).toBe("newest");
      expect(containerRef.current).toBe("newest");
      expect(loading).toEqual([true, true, false]);
      expect(changes).toEqual(["newest"]);
      expect(failures).toEqual([]);

      requests[0]!.reject(new Error("stale request"));
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();

      expect(containers.value).toEqual(newest);
      expect(selected.value).toBe("newest");
      expect(containerRef.current).toBe("newest");
      expect(loading).toEqual([true, true, false]);
      expect(changes).toEqual(["newest"]);
      expect(selection.value).toEqual(new Set(["blob.txt"]));
      expect(failures).toEqual([]);
    } finally {
      if (previousWindow === undefined)
        delete (globalThis as { window?: unknown }).window;
      else (globalThis as { window?: unknown }).window = previousWindow;
    }
  });

  test("keeps navigation history and prefix refs synchronized across renders; scoped root cannot go up", () => {
    const navPrefix: State<string> = { value: "" };
    const backHist: State<string[]> = { value: [] };
    const fwdHist: State<string[]> = { value: [] };
    const selection: State<Set<string>> = { value: new Set(["first.txt"]) };
    const navPrefixRef = { current: "" };
    const base: ExplorerNavContext = {
      accountId: "account",
      scoped: true,
      containerRef: { current: "container" },
      navPrefixRef,
      containerSeq: { current: 0 },
      showDeletedRef: { current: false },
      navPrefix: navPrefix.value,
      backHist: backHist.value,
      fwdHist: fwdHist.value,
      listing: { load: () => undefined },
      props: {},
      setContainer: () => undefined,
      setActiveTab: () => undefined,
      setCtx: () => undefined,
      setOptsMenu: () => undefined,
      setNavPrefix: setter(navPrefix),
      setBackHist: setter(backHist),
      setFwdHist: setter(fwdHist),
      setSelection: setter(selection),
      setLoadingContainers: () => undefined,
      setContainersError: () => undefined,
      setContainers: () => undefined,
      setBlobError: () => undefined,
      setActionError: () => undefined,
      fail: () => undefined,
    };
    const createNav = () =>
      createExplorerNav({
        ...base,
        navPrefix: navPrefix.value,
        backHist: backHist.value,
        fwdHist: fwdHist.value,
      });

    createNav().go("alpha");
    expect(selection.value).toEqual(new Set());
    expect(navPrefix.value).toBe("alpha");
    expect(navPrefixRef.current).toBe("alpha");
    expect(backHist.value).toEqual([""]);
    expect(fwdHist.value).toEqual([]);

    selection.value = new Set(["alpha/file.txt"]);
    createNav().go("alpha/beta");
    expect(selection.value).toEqual(new Set());
    expect(navPrefix.value).toBe("alpha/beta");
    expect(navPrefixRef.current).toBe("alpha/beta");
    expect(backHist.value).toEqual(["", "alpha"]);

    createNav().goBack();
    expect(navPrefix.value).toBe("alpha");
    expect(navPrefixRef.current).toBe("alpha");
    expect(backHist.value).toEqual([""]);
    expect(fwdHist.value).toEqual(["alpha/beta"]);

    selection.value = new Set(["alpha/file.txt"]);
    createNav().goForward();
    expect(selection.value).toEqual(new Set());
    expect(navPrefix.value).toBe("alpha/beta");
    expect(navPrefixRef.current).toBe("alpha/beta");
    expect(backHist.value).toEqual(["", "alpha"]);
    expect(fwdHist.value).toEqual([]);

    const switchCalls: (string | null)[] = [];
    const scopedRootNav = createExplorerNav({
      ...base,
      navPrefix: "",
      backHist: [],
      fwdHist: [],
      props: { onContainerChange: (container) => switchCalls.push(container) },
    });
    selection.value = new Set(["preserved.txt"]);
    scopedRootNav.goUp();
    expect(navPrefix.value).toBe("alpha/beta");
    expect(navPrefixRef.current).toBe("alpha/beta");
    expect(switchCalls).toEqual([]);
    expect(selection.value).toEqual(new Set(["preserved.txt"]));
  });
});
