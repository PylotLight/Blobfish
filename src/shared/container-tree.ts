/**
 * Sidebar "Blob Containers" tree state, per account. Pure so it can be tested
 * and so the fetch decision never hides inside a React state updater (the old
 * ensureContainers did exactly that and, with deferred updaters, never fired
 * the listing: the node sat empty with no "Loading…").
 */
import type { StorageContainer } from "./types";

/** Rows rendered before "Show more…" (ASE shows a page, then "Load more"). */
export const TREE_PAGE = 50;

export type TreeStatus = "idle" | "loading" | "ready" | "error";

export interface TreeEntry {
  status: TreeStatus;
  /** Last good listing; kept while a refresh is in flight so the tree doesn't flash empty. */
  items: StorageContainer[];
  error?: string;
  /** How many rows are rendered. */
  limit: number;
  /** Bumped per request so a stale response can't overwrite a newer one. */
  seq: number;
}

export type TreeState = Record<string, TreeEntry>;

export const EMPTY_ENTRY: TreeEntry = {
  status: "idle",
  items: [],
  limit: TREE_PAGE,
  seq: 0,
};

export type TreeAction =
  | { type: "start"; accountId: string; seq: number }
  | {
      type: "success";
      accountId: string;
      seq: number;
      items: StorageContainer[];
    }
  | { type: "failure"; accountId: string; seq: number; error: string }
  | { type: "more"; accountId: string }
  | { type: "forget"; accountId: string };

export function entryOf(state: TreeState, accountId: string): TreeEntry {
  return state[accountId] ?? EMPTY_ENTRY;
}

/** Expanding a node loads it once; errors stay put until an explicit refresh. */
export function needsLoad(entry: TreeEntry | undefined): boolean {
  return !entry || entry.status === "idle";
}

export function treeReducer(state: TreeState, action: TreeAction): TreeState {
  const prev = entryOf(state, action.accountId);
  switch (action.type) {
    case "start":
      return {
        ...state,
        [action.accountId]: {
          ...prev,
          status: "loading",
          error: undefined,
          seq: action.seq,
        },
      };
    case "success": {
      if (action.seq !== prev.seq) return state;
      const items = [...action.items].sort((a, b) =>
        a.name.localeCompare(b.name),
      );
      return {
        ...state,
        [action.accountId]: {
          ...prev,
          status: "ready",
          items,
          error: undefined,
        },
      };
    }
    case "failure":
      if (action.seq !== prev.seq) return state;
      return {
        ...state,
        [action.accountId]: {
          ...prev,
          status: "error",
          items: [],
          error: action.error,
        },
      };
    case "more":
      return {
        ...state,
        [action.accountId]: {
          ...prev,
          limit: Math.min(prev.items.length, prev.limit) + TREE_PAGE,
        },
      };
    case "forget": {
      if (!(action.accountId in state)) return state;
      const next = { ...state };
      delete next[action.accountId];
      return next;
    }
  }
}

/** The rows to render plus how many sit behind "Show more…". */
export function visibleSlice(entry: TreeEntry): {
  shown: StorageContainer[];
  hidden: number;
} {
  const shown = entry.items.slice(0, entry.limit);
  return { shown, hidden: entry.items.length - shown.length };
}

/** Successful listings only, keyed by account (what ⌘K indexes). */
export function readyListings(
  state: TreeState,
): Record<string, StorageContainer[]> {
  const out: Record<string, StorageContainer[]> = {};
  for (const [id, e] of Object.entries(state))
    if (e.status === "ready" || (e.status === "loading" && e.items.length))
      out[id] = e.items;
  return out;
}

/**
 * Up/Down/Home/End over the sidebar's focusable tree rows, in DOM order.
 * Returns the index to focus, or null to leave focus alone.
 */
export function nextTreeFocus(
  count: number,
  current: number,
  key: string,
): number | null {
  if (count === 0) return null;
  switch (key) {
    case "ArrowDown":
      return current < 0 ? 0 : Math.min(count - 1, current + 1);
    case "ArrowUp":
      return current < 0 ? count - 1 : Math.max(0, current - 1);
    case "Home":
      return 0;
    case "End":
      return count - 1;
    default:
      return null;
  }
}
