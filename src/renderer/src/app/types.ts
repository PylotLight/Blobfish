import type { AccountSummary } from "../../../shared/types";
import { stripIpcWrapper } from "../views/errors";

export const CONTAINER_NAME_RE = /^[a-z0-9]([a-z0-9-]{1,61}[a-z0-9])?$/;

export type SidebarMenu =
  | { kind: "account"; x: number; y: number; account: AccountSummary }
  | { kind: "group"; x: number; y: number; account: AccountSummary }
  | {
      kind: "container";
      x: number;
      y: number;
      account: AccountSummary;
      container: string;
    };

/** Lease state per `${accountId}/${container}`, read when its menu opens. */
export type LeaseProbe = { state: string; error?: string };

export function errMessage(err: unknown): string {
  return stripIpcWrapper(err instanceof Error ? err.message : String(err));
}

export interface SelectionTarget {
  accountId: string;
  container: string | null;
  /** Folder to open inside `container` (⌘K recent folders). */
  prefix?: string;
  /** Re-list even if it's already the open container (sidebar Refresh). */
  reload?: boolean;
  tick: number;
}

export function hostOf(endpoint: string): string {
  try {
    return new URL(endpoint).host;
  } catch {
    return endpoint;
  }
}
