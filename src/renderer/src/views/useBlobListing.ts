import { useCallback, useEffect, useRef, useState } from "react";
import type { ListBlobsResult } from "../../../shared/types";
import { ListingPager, type ListingPhase } from "../../../shared/listing-pager";

export interface BlobListingTarget {
  accountId: string;
  container: string;
  prefix?: string;
  includeDeleted?: boolean;
}

export interface BlobListing {
  blobs: ListBlobsResult | null;
  /** First page in flight (skeleton). */
  loadingList: boolean;
  /** Paging state of the current listing; undefined when nothing is listed. */
  phase: ListingPhase | undefined;
  pagingError: string | undefined;
  /** Start a fresh listing; `onFirst` runs once the first page lands. */
  load: (
    target: BlobListingTarget,
    onFirst: () => void,
    onError: (err: unknown) => void,
  ) => void;
  /** Drop the current listing's in-flight pages (no state change). */
  cancel: () => void;
  stop: () => void;
  loadMore: () => void;
  setBlobs: (b: ListBlobsResult | null) => void;
}

/** Folder listing that pages through continuation tokens: first page fast,
 *  the rest streamed into `blobs.items` (see shared/listing-pager.ts). */
export function useBlobListing(): BlobListing {
  const [blobs, setBlobsState] = useState<ListBlobsResult | null>(null);
  const [loadingList, setLoadingList] = useState(false);
  const [phase, setPhase] = useState<ListingPhase | undefined>(undefined);
  const [pagingError, setPagingError] = useState<string | undefined>(undefined);
  const pager = useRef<ListingPager | null>(null);

  const cancel = useCallback((): void => {
    pager.current?.dispose();
    pager.current = null;
  }, []);

  const load = useCallback(
    (
      target: BlobListingTarget,
      onFirst: () => void,
      onError: (err: unknown) => void,
    ): void => {
      pager.current?.dispose();
      setLoadingList(true);
      setPhase("first");
      setPagingError(undefined);
      const p = new ListingPager(
        (continuationToken) =>
          window.api.storage.listBlobs({
            accountId: target.accountId,
            container: target.container,
            prefix: target.prefix || undefined,
            includeDeleted: target.includeDeleted || undefined,
            continuationToken,
          }),
        {
          onChange: (snap) => {
            if (pager.current !== p) return;
            setBlobsState({
              container: snap.container,
              prefix: snap.prefix,
              items: snap.items,
            });
            setPhase(snap.phase);
            setPagingError(snap.error);
            if (snap.pages === 1 && snap.phase !== "first") {
              setLoadingList(false);
              onFirst();
            }
          },
          onFirstError: (err) => {
            if (pager.current !== p) return;
            setLoadingList(false);
            setPhase(undefined);
            onError(err);
          },
        },
      );
      pager.current = p;
      void p.start();
    },
    [],
  );

  const stop = useCallback(() => pager.current?.stop(), []);
  const loadMore = useCallback(() => void pager.current?.loadMore(), []);
  const setBlobs = useCallback(
    (b: ListBlobsResult | null) => {
      if (b === null) {
        cancel();
        setPhase(undefined);
        setPagingError(undefined);
        setLoadingList(false);
      }
      setBlobsState(b);
    },
    [cancel],
  );

  useEffect(() => () => pager.current?.dispose(), []);

  return {
    blobs,
    loadingList,
    phase,
    pagingError,
    load,
    cancel,
    stop,
    loadMore,
    setBlobs,
  };
}
