import { useCallback, useMemo, useReducer, useRef, useState } from "react";
import type { AccountSummary } from "../../../shared/types";
import {
  needsLoad,
  readyListings,
  treeReducer,
} from "../../../shared/container-tree";
import { errMessage } from "./types";

export function useSidebarTree(accounts: AccountSummary[]) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [groupOpen, setGroupOpen] = useState<Record<string, boolean>>({});
  const [tree, dispatchTree] = useReducer(treeReducer, {});
  const treeRef = useRef(tree);
  treeRef.current = tree;
  const treeSeq = useRef(0);
  const inflight = useRef<Record<string, number>>({});
  const containersCache = useMemo(() => readyListings(tree), [tree]);

  const loadContainers = useCallback((accountId: string, force = false) => {
    if (!force && inflight.current[accountId] !== undefined) return;
    if (!force && !needsLoad(treeRef.current[accountId])) return;
    const seq = ++treeSeq.current;
    inflight.current[accountId] = seq;
    dispatchTree({ type: "start", accountId, seq });
    window.api.storage
      .listContainers(accountId)
      .then((items) => dispatchTree({ type: "success", accountId, seq, items }))
      .catch((err: unknown) =>
        dispatchTree({
          type: "failure",
          accountId,
          seq,
          error: errMessage(err),
        }),
      )
      .finally(() => {
        if (inflight.current[accountId] === seq)
          delete inflight.current[accountId];
      });
  }, []);
  const ensureContainers = useCallback(
    (accountId: string) => loadContainers(accountId, false),
    [loadContainers],
  );
  const isGroupOpen = useCallback(
    (accountId: string) => groupOpen[accountId] ?? true,
    [groupOpen],
  );
  const toggleExpand = useCallback(
    (accountId: string, force?: boolean) => {
      const a = accounts.find((x) => x.id === accountId);
      if (a && a.kind !== "account") return;
      const next = force ?? !expanded[accountId];
      setExpanded((prev) => ({ ...prev, [accountId]: next }));
      if (next && isGroupOpen(accountId)) ensureContainers(accountId);
    },
    [accounts, expanded, ensureContainers, isGroupOpen],
  );
  const toggleGroup = useCallback(
    (accountId: string, force?: boolean) => {
      const next = force ?? !isGroupOpen(accountId);
      setGroupOpen((prev) => ({ ...prev, [accountId]: next }));
      if (next) ensureContainers(accountId);
    },
    [ensureContainers, isGroupOpen],
  );

  return {
    expanded,
    setExpanded,
    groupOpen,
    tree,
    dispatchTree,
    containersCache,
    loadContainers,
    ensureContainers,
    isGroupOpen,
    toggleExpand,
    toggleGroup,
  };
}
