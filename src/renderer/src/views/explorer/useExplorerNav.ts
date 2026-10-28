import type { Dispatch, RefObject, SetStateAction } from "react";
import type { StorageContainer } from "../../../../shared/types";
import type { useBlobListing } from "../useBlobListing";

export interface ExplorerNavContext {
  accountId: string | undefined;
  scoped: boolean;
  containerRef: RefObject<string | null>;
  navPrefixRef: RefObject<string>;
  containerSeq: RefObject<number>;
  showDeletedRef: RefObject<boolean>;
  navPrefix: string;
  backHist: string[];
  fwdHist: string[];
  listing: Pick<ReturnType<typeof useBlobListing>, "load">;
  props: { onContainerChange?: (container: string | null) => void };
  setContainer: Dispatch<SetStateAction<string | null>>;
  setActiveTab: (value: string | null) => void;
  setCtx: (value: null) => void;
  setOptsMenu: (value: null) => void;
  setNavPrefix: Dispatch<SetStateAction<string>>;
  setBackHist: Dispatch<SetStateAction<string[]>>;
  setFwdHist: Dispatch<SetStateAction<string[]>>;
  setSelection: (value: Set<string>) => void;
  setLoadingContainers: (value: boolean) => void;
  setContainersError: (value: null) => void;
  setContainers: Dispatch<SetStateAction<StorageContainer[]>>;
  setBlobError: (value: null) => void;
  setActionError: (value: null) => void;
  fail: (error: unknown, context?: "containers" | "blobs" | "action") => void;
}

/** Navigation callbacks retain the root's refs and lifecycle/request ownership. */
export function createExplorerNav({
  accountId,
  scoped,
  containerRef,
  navPrefixRef,
  containerSeq,
  showDeletedRef,
  navPrefix,
  backHist,
  fwdHist,
  listing,
  props,
  setContainer,
  setActiveTab,
  setCtx,
  setOptsMenu,
  setNavPrefix,
  setBackHist,
  setFwdHist,
  setSelection,
  setLoadingContainers,
  setContainersError,
  setContainers,
  setBlobError,
  setActionError,
  fail,
}: ExplorerNavContext) {
  function switchContainer(next: string | null): void {
    setContainer(next);
    containerRef.current = next;
    setActiveTab(null);
    setCtx(null);
    setOptsMenu(null);
    props.onContainerChange?.(next);
  }

  function resetNav(): void {
    setNavPrefix("");
    navPrefixRef.current = "";
    setBackHist([]);
    setFwdHist([]);
    setSelection(new Set());
  }

  const loadContainers = (id: string, highlight?: string | null) => {
    const seq = ++containerSeq.current;
    setLoadingContainers(true);
    setContainersError(null);
    window.api.storage
      .listContainers(id)
      .then((cs) => {
        if (seq !== containerSeq.current) return;
        setContainers(cs);
        setContainersError(null);
        setContainer((prev) => {
          let chosen: string | null = null;
          if (highlight && cs.some((c) => c.name === highlight))
            chosen = highlight;
          else if (prev && cs.some((c) => c.name === prev)) chosen = prev;
          else if (cs.length === 1) chosen = cs[0]?.name ?? null;
          containerRef.current = chosen;
          props.onContainerChange?.(chosen);
          return chosen;
        });
        // Empty list is a valid state — rendered as an empty table, not an error.
      })
      .catch((err: unknown) => {
        if (seq !== containerSeq.current) return;
        fail(err, "containers");
      })
      .finally(() => {
        if (seq !== containerSeq.current) return;
        setLoadingContainers(false);
      });
  };

  function reloadBlobs(): void {
    const curContainer = containerRef.current;
    if (!accountId || !curContainer) return;
    setBlobError(null);
    listing.load(
      {
        accountId,
        container: curContainer,
        prefix: navPrefixRef.current,
        includeDeleted: showDeletedRef.current,
      },
      () => {
        setBlobError(null);
        setSelection(new Set());
      },
      (err) => fail(err, "blobs"),
    );
  }

  function go(next: string): void {
    setBackHist((h) => [...h, navPrefix]);
    setFwdHist([]);
    setNavPrefix(next);
    navPrefixRef.current = next;
    setSelection(new Set());
  }

  function goBack(): void {
    if (backHist.length === 0) return;
    const prev = backHist[backHist.length - 1]!;
    setBackHist((h) => h.slice(0, -1));
    setFwdHist((h) => [navPrefix, ...h]);
    setNavPrefix(prev);
    navPrefixRef.current = prev;
    setSelection(new Set());
  }

  function goForward(): void {
    if (fwdHist.length === 0) return;
    const [next, ...rest] = fwdHist;
    setFwdHist(rest);
    setBackHist((h) => [...h, navPrefix]);
    setNavPrefix(next!);
    navPrefixRef.current = next!;
    setSelection(new Set());
  }

  function goUp(): void {
    const segs = navPrefix.split("/").filter(Boolean);
    if (segs.length === 0) {
      // Scoped attachments are rooted at their container — nowhere above to go.
      if (scoped) return;
      // At container root → up means back to the container directory.
      switchContainer(null);
      resetNav();
      return;
    }
    go(segs.slice(0, -1).join("/"));
  }

  function retryCurrent(): void {
    if (!accountId) return;
    setActionError(null);
    if (!containerRef.current) loadContainers(accountId);
    else reloadBlobs();
  }

  return {
    switchContainer,
    resetNav,
    loadContainers,
    reloadBlobs,
    go,
    goBack,
    goForward,
    goUp,
    retryCurrent,
  };
}
