/**
 * Transfers dock view model (pure). Decides what the collapsed dock shows and how the
 * activity feed reads, so the component only renders.
 *
 * - Restored entries (last session's activity.json) are history: they never count as
 *   new, never colour the pill, never open the dock.
 * - The collapsed dock is a compact pill, never an empty full-width strip.
 */
import type { ActivityEntry } from "./types";

export interface DockCounts {
  active: number;
  queued: number;
  /** Failed or cancelled rows still in the transfers list (this session; rows aren't persisted). */
  leftover: number;
  /** Rows in the transfers list, any status. */
  rows: number;
}

export type DockTone = "idle" | "busy" | "done" | "failed";

export interface DockPill {
  /** hidden = nothing at all to show (no rows, no activity, not even history). */
  visible: boolean;
  tone: DockTone;
  /** Short status after "Transfers": "idle", "2 done", "1 failed", "3 queued"... */
  status: string;
  done: number;
  failed: number;
}

/** Successful transfers logged this session (restored history excluded). */
export function sessionDone(
  activities: readonly Pick<ActivityEntry, "kind" | "status" | "restored">[],
): number {
  let n = 0;
  for (const a of activities)
    if (!a.restored && a.kind === "transfer" && a.status === "success") n++;
  return n;
}

export function dockPill(
  activities: readonly Pick<ActivityEntry, "kind" | "status" | "restored">[],
  c: DockCounts,
): DockPill {
  const done = sessionDone(activities);
  const failed = Math.max(0, c.leftover);
  const visible = c.rows > 0 || activities.length > 0;
  if (c.active > 0)
    return {
      visible,
      tone: "busy",
      status: `${c.active} active`,
      done,
      failed,
    };
  if (c.queued > 0)
    return {
      visible,
      tone: "busy",
      status: `${c.queued} queued`,
      done,
      failed,
    };
  if (failed > 0)
    return {
      visible,
      tone: "failed",
      status: `${failed} failed`,
      done,
      failed,
    };
  if (done > 0)
    return { visible, tone: "done", status: `${done} done`, done, failed };
  return { visible, tone: "idle", status: "idle", done, failed };
}

/** Index of the first restored entry (where the "Earlier" divider goes), or -1. */
export function earlierIndex(
  activities: readonly Pick<ActivityEntry, "restored">[],
): number {
  return activities.findIndex((a) => a.restored === true);
}

function clock(d: Date): string {
  const h = d.getHours();
  const m = d.getMinutes();
  return `${h % 12 === 0 ? 12 : h % 12}:${m < 10 ? "0" : ""}${m} ${h < 12 ? "am" : "pm"}`;
}

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

function startOfDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/**
 * Short local "when": just now · 5 min ago · today 9:10 pm · yesterday 9:10 pm ·
 * Mon 9:10 pm · 12 Oct (· 2025 when another year). Local time, 12 h.
 */
export function relativeWhen(at: number, now = Date.now()): string {
  const diff = now - at;
  if (diff < 60_000 && diff > -60_000) return "just now";
  if (diff > 0 && diff < 60 * 60_000)
    return `${Math.floor(diff / 60_000)} min ago`;
  const d = new Date(at);
  const n = new Date(now);
  const days = Math.round((startOfDay(n) - startOfDay(d)) / 86_400_000);
  if (days === 0) return `today ${clock(d)}`;
  if (days === 1) return `yesterday ${clock(d)}`;
  if (days > 1 && days < 7) return `${DAYS[d.getDay()]} ${clock(d)}`;
  const date = `${d.getDate()} ${MONTHS[d.getMonth()]}`;
  return d.getFullYear() === n.getFullYear()
    ? date
    : `${date} ${d.getFullYear()}`;
}

/** Hover may open the dock only after a real pointer move, not a layout-triggered one. */
export const HOVER_ARM_MS = 800;

export function hoverMayOpen(
  sinceMountMs: number,
  movementX: number,
  movementY: number,
): boolean {
  return sinceMountMs >= HOVER_ARM_MS && (movementX !== 0 || movementY !== 0);
}
