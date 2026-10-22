/**
 * SAS form -> SDK params, pure and electron-free so the renderer (form state,
 * validation hints) and main (the real signing) agree on one set of rules.
 * Keys never come near this file: main turns the normalized output into
 * generateAccountSASQueryParameters / generateBlobSASQueryParameters calls.
 */

export interface SasFlagDef {
  /** The SAS permission / service / resource-type letter. */
  char: string;
  label: string;
  hint?: string;
}

/** Account SAS permissions, in the order @azure/storage-blob's AccountSASPermissions.toString() emits. */
export const ACCOUNT_SAS_PERMISSIONS: readonly SasFlagDef[] = [
  { char: "r", label: "Read" },
  { char: "w", label: "Write" },
  { char: "d", label: "Delete" },
  { char: "x", label: "Delete version" },
  { char: "f", label: "Filter by tags" },
  { char: "t", label: "Tag" },
  { char: "l", label: "List" },
  { char: "a", label: "Add" },
  { char: "c", label: "Create" },
  { char: "u", label: "Update" },
  { char: "p", label: "Process" },
  { char: "i", label: "Set immutability policy" },
  { char: "y", label: "Permanent delete" },
];

/** Container SAS permissions, in ContainerSASPermissions.toString() order (no HNS-only move/execute). */
export const CONTAINER_SAS_PERMISSIONS: readonly SasFlagDef[] = [
  { char: "r", label: "Read" },
  { char: "a", label: "Add" },
  { char: "c", label: "Create" },
  { char: "w", label: "Write" },
  { char: "d", label: "Delete" },
  { char: "x", label: "Delete version" },
  { char: "l", label: "List" },
  { char: "t", label: "Tag" },
  { char: "i", label: "Set immutability policy" },
  { char: "y", label: "Permanent delete" },
  { char: "f", label: "Filter by tags" },
];

/** What a stored access policy on a container can grant (ASE offers the same six). */
export const POLICY_PERMISSIONS: readonly SasFlagDef[] = [
  { char: "r", label: "Read" },
  { char: "a", label: "Add" },
  { char: "c", label: "Create" },
  { char: "w", label: "Write" },
  { char: "d", label: "Delete" },
  { char: "l", label: "List" },
];

/** AccountSASServices.toString() order. */
export const ACCOUNT_SAS_SERVICES: readonly SasFlagDef[] = [
  { char: "b", label: "Blob" },
  { char: "t", label: "Table" },
  { char: "q", label: "Queue" },
  { char: "f", label: "File" },
];

export const ACCOUNT_SAS_RESOURCE_TYPES: readonly SasFlagDef[] = [
  {
    char: "s",
    label: "Service",
    hint: "service-level APIs (properties, list containers)",
  },
  {
    char: "c",
    label: "Container",
    hint: "container APIs (create, list blobs)",
  },
  { char: "o", label: "Object", hint: "blob APIs (read, write, delete blobs)" },
];

export const DEFAULT_ACCOUNT_PERMISSIONS = "rl";
export const DEFAULT_CONTAINER_PERMISSIONS = "rl";
export const DEFAULT_SERVICES = "b";
export const DEFAULT_RESOURCE_TYPES = "sco";

export type SasProtocolChoice = "https" | "https,http";

/** Canonical flag string: known letters only, deduped, in the definition order. */
export function flagString(
  defs: readonly SasFlagDef[],
  selected: Iterable<string>,
): string {
  const want = new Set<string>();
  for (const s of selected) for (const ch of s) want.add(ch);
  return defs
    .map((d) => d.char)
    .filter((c) => want.has(c))
    .join("");
}

export function toggleFlag(
  defs: readonly SasFlagDef[],
  value: string,
  char: string,
): string {
  const set = new Set(value);
  if (set.has(char)) set.delete(char);
  else set.add(char);
  return flagString(defs, set);
}

/* ---------- dates ---------- */

const pad = (n: number): string => String(n).padStart(2, "0");

/** A Date as an `<input type="datetime-local">` value, in local time, minute precision. */
export function toLocalInput(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Parse a datetime-local value (local time). Empty / garbage -> null. */
export function fromLocalInput(value: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(
    value.trim(),
  );
  if (!m) return null;
  const [, y, mo, d, h, mi, s] = m;
  const date = new Date(
    Number(y),
    Number(mo) - 1,
    Number(d),
    Number(h),
    Number(mi),
    Number(s ?? 0),
  );
  // Reject rollovers like 2026-02-31.
  if (date.getMonth() !== Number(mo) - 1 || date.getDate() !== Number(d))
    return null;
  return date;
}

/** ASE defaults: start 15 minutes ago (clock skew), expiry a day out. Seconds zeroed. */
export function defaultSasWindow(now: Date = new Date()): {
  start: Date;
  expiry: Date;
} {
  const base = new Date(now);
  base.setSeconds(0, 0);
  return {
    start: new Date(base.getTime() - 15 * 60_000),
    expiry: new Date(base.getTime() + 24 * 60 * 60_000),
  };
}

/** "UTC+11:00" for the local zone at `d` (DST aware). */
export function utcOffsetLabel(d: Date = new Date()): string {
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? "+" : "-";
  const abs = Math.abs(off);
  return `UTC${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}

/* ---------- IP range ---------- */

const IPV4 =
  /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;

function ipToNum(ip: string): number {
  return ip.split(".").reduce((n, part) => n * 256 + Number(part), 0);
}

/** `1.2.3.4` or `1.2.3.4-1.2.3.255`. Empty -> undefined. Throws on bad input. */
export function parseIpRange(
  raw: string | undefined,
): { start: string; end?: string } | undefined {
  const s = (raw ?? "").trim();
  if (s === "") return undefined;
  const [start = "", end, extra] = s.split("-").map((x) => x.trim());
  if (
    extra !== undefined ||
    !IPV4.test(start) ||
    (end !== undefined && !IPV4.test(end))
  )
    throw new Error(
      "IP range must be one IPv4 address or a range like 168.1.5.60-168.1.5.70.",
    );
  if (end !== undefined && ipToNum(end) < ipToNum(start))
    throw new Error("IP range end must not be before its start.");
  return end !== undefined && end !== start ? { start, end } : { start };
}

/* ---------- requests (renderer -> main) ---------- */

export interface AccountSasRequest {
  accountId: string;
  /** ISO 8601. Optional: an omitted start means "valid immediately". */
  startsOn?: string;
  expiresOn: string;
  permissions: string;
  services: string;
  resourceTypes: string;
  protocol: SasProtocolChoice;
  ipRange?: string;
}

export interface ContainerSasRequest {
  accountId: string;
  container: string;
  startsOn?: string;
  expiresOn?: string;
  permissions?: string;
  /** Stored access policy id to bind the SAS to. */
  identifier?: string;
  protocol: SasProtocolChoice;
  ipRange?: string;
}

export interface SasResult {
  /** Full URL, resource + `?` + query. */
  url: string;
  /** Query string without the leading `?`. */
  query: string;
  expiresOn?: string;
}

/** What a stored access policy already pins (fields the SAS must then leave out). */
export interface PolicyShape {
  startsOn?: string;
  expiresOn?: string;
  permissions?: string;
}

export interface NormalizedAccountSas {
  startsOn?: Date;
  expiresOn: Date;
  permissions: string;
  services: string;
  resourceTypes: string;
  protocol: SasProtocolChoice;
  ipRange?: { start: string; end?: string };
}

export interface NormalizedContainerSas {
  container: string;
  startsOn?: Date;
  expiresOn?: Date;
  permissions?: string;
  identifier?: string;
  protocol: SasProtocolChoice;
  ipRange?: { start: string; end?: string };
}

function isoDate(v: string | undefined, what: string): Date | undefined {
  if (v === undefined || v === "") return undefined;
  const d = new Date(v);
  if (Number.isNaN(d.getTime()))
    throw new Error(`${what} is not a valid date.`);
  return d;
}

function protocolOf(p: string): SasProtocolChoice {
  if (p === "https" || p === "https,http") return p;
  throw new Error(`Unknown protocol "${p}".`);
}

/** Validate + canonicalize an account SAS request. Throws a readable Error. */
export function normalizeAccountSas(
  req: AccountSasRequest,
): NormalizedAccountSas {
  const startsOn = isoDate(req.startsOn, "Start time");
  const expiresOn = isoDate(req.expiresOn, "Expiry time");
  if (!expiresOn) throw new Error("Pick an expiry time.");
  if (startsOn && expiresOn.getTime() <= startsOn.getTime())
    throw new Error("Expiry must be after the start time.");
  const permissions = flagString(ACCOUNT_SAS_PERMISSIONS, req.permissions);
  if (!permissions) throw new Error("Pick at least one permission.");
  const services = flagString(ACCOUNT_SAS_SERVICES, req.services);
  if (!services) throw new Error("Pick at least one service.");
  const resourceTypes = flagString(
    ACCOUNT_SAS_RESOURCE_TYPES,
    req.resourceTypes,
  );
  if (!resourceTypes) throw new Error("Pick at least one resource type.");
  return {
    startsOn,
    expiresOn,
    permissions,
    services,
    resourceTypes,
    protocol: protocolOf(req.protocol),
    ipRange: parseIpRange(req.ipRange),
  };
}

/**
 * Validate + canonicalize a container SAS request. With a stored access policy,
 * any field the policy already defines must be left out of the SAS (Azure
 * rejects the token otherwise), so those are dropped here; everything the
 * policy leaves open still has to come from the form.
 */
export function normalizeContainerSas(
  req: ContainerSasRequest,
  policy?: PolicyShape,
): NormalizedContainerSas {
  const container = req.container.trim();
  if (!container) throw new Error("Container name is required.");
  const identifier = req.identifier?.trim() || undefined;
  if (identifier && !policy)
    throw new Error(`Stored access policy "${identifier}" no longer exists.`);
  const p = identifier ? policy : undefined;
  const startsOn = p?.startsOn
    ? undefined
    : isoDate(req.startsOn, "Start time");
  const expiresOn = p?.expiresOn
    ? undefined
    : isoDate(req.expiresOn, "Expiry time");
  const permissions = p?.permissions
    ? undefined
    : flagString(CONTAINER_SAS_PERMISSIONS, req.permissions ?? "") || undefined;
  if (!p?.expiresOn && !expiresOn) throw new Error("Pick an expiry time.");
  if (!p?.permissions && !permissions)
    throw new Error("Pick at least one permission.");
  const effStart = startsOn ?? isoDate(p?.startsOn, "Policy start");
  const effExpiry = expiresOn ?? isoDate(p?.expiresOn, "Policy expiry");
  if (effStart && effExpiry && effExpiry.getTime() <= effStart.getTime())
    throw new Error("Expiry must be after the start time.");
  return {
    container,
    startsOn,
    expiresOn,
    permissions,
    identifier,
    protocol: protocolOf(req.protocol),
    ipRange: parseIpRange(req.ipRange),
  };
}

/** `https://acct.blob.core.windows.net/` + `?` + query for account SAS (ASE shape). */
export function accountSasUrl(endpoint: string, query: string): string {
  return `${endpoint.replace(/\/+$/, "")}/?${query}`;
}

export function containerSasUrl(
  endpoint: string,
  container: string,
  query: string,
): string {
  return `${endpoint.replace(/\/+$/, "")}/${encodeURIComponent(container)}?${query}`;
}
