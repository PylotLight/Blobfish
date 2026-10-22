/* SAS signing + container / service admin behind the sidebar context menus.
 * Account keys are read and used here only; the renderer gets the finished SAS
 * (that's the product) and never the key. */
import type {
  BlobServiceClient,
  ContainerClient,
  PublicAccessType,
  SignedIdentifier,
} from "@azure/storage-blob";
import { decryptSecret } from "./accounts";
import { logActivity } from "./activity";
import { friendlyError } from "./azure";
import {
  blobContainerClientFromSecret,
  blobServiceFromSecret,
} from "./azure-clients";
import { signAccountSas, signContainerSas } from "./sas-sign";
import {
  blobHostEndpoint,
  blobHostSecret,
  sasUnavailableReason,
  sharedKeyFromSecret,
  type SharedKey,
} from "./shared-key";
import {
  accountSasUrl,
  containerSasUrl,
  normalizeAccountSas,
  normalizeContainerSas,
  type AccountSasRequest,
  type ContainerSasRequest,
  type SasResult,
} from "../shared/sas";
import {
  validateCors,
  validatePolicies,
  validateSoftDelete,
} from "../shared/admin-validate";
import type {
  AccountCapabilities,
  AccountSummary,
  ContainerAccessInfo,
  ContainerPropertiesInfo,
  CorsRuleInfo,
  PublicAccessLevel,
  SoftDeleteInfo,
  StoredAccessPolicy,
} from "../shared/types";

type Loaded = { profile: AccountSummary; secret: string };

function isAccountScope(profile: AccountSummary): boolean {
  return profile.kind === "account" && !profile.containerName;
}

function service({ profile, secret }: Loaded): BlobServiceClient {
  return blobServiceFromSecret(profile.endpoint, blobHostSecret(secret));
}

function container({ secret }: Loaded, name: string): ContainerClient {
  return blobContainerClientFromSecret(blobHostSecret(secret), name);
}

function requireKey(secret: string): SharedKey {
  const key = sharedKeyFromSecret(secret);
  if (!key) throw new Error(sasUnavailableReason(secret) ?? "No account key.");
  return key;
}

function requireAccountScope(profile: AccountSummary, what: string): void {
  if (!isAccountScope(profile))
    throw new Error(`${what} needs a full storage-account connection.`);
}

function publicLevel(p: PublicAccessType | undefined): PublicAccessLevel {
  return p === "container" || p === "blob" ? p : "none";
}

function sdkPublic(level: PublicAccessLevel): PublicAccessType | undefined {
  return level === "none" ? undefined : level;
}

function toPolicy(si: SignedIdentifier): StoredAccessPolicy {
  return {
    id: si.id,
    startsOn: si.accessPolicy?.startsOn?.toISOString(),
    expiresOn: si.accessPolicy?.expiresOn?.toISOString(),
    permissions: si.accessPolicy?.permissions || undefined,
  };
}

async function wrap<T>(
  run: () => Promise<T>,
  fallback: string,
  activity?: { text: string; ok?: string },
): Promise<T> {
  const started = Date.now();
  try {
    const out = await run();
    if (activity?.ok)
      logActivity({
        kind: "container",
        text: activity.ok,
        status: "success",
        durationMs: Date.now() - started,
      });
    return out;
  } catch (err) {
    const friendly = friendlyError(err, fallback);
    if (activity)
      logActivity({
        kind: "container",
        text: activity.text,
        detail: friendly.message,
        status: "failed",
      });
    throw friendly;
  }
}

/* ---------- capabilities + key ---------- */

export async function accountCapabilities(
  accountId: string,
): Promise<AccountCapabilities> {
  const { profile, secret } = await decryptSecret(accountId);
  const sharedKey = sharedKeyFromSecret(secret) !== null;
  return {
    sharedKey,
    sasReason: sharedKey ? undefined : sasUnavailableReason(secret),
    accountScope: isAccountScope(profile),
  };
}

/** The account key for the clipboard. Only ipc.ts calls this, straight into clipboard.writeText. */
export async function accountKeyForClipboard(
  accountId: string,
): Promise<{ name: string; key: string }> {
  const { profile, secret } = await decryptSecret(accountId);
  const key = sharedKeyFromSecret(secret);
  if (!key) throw new Error("This connection has no account key.");
  return { name: profile.name, key: key.accountKey };
}

/* ---------- SAS ---------- */

export async function generateAccountSas(
  req: AccountSasRequest,
): Promise<SasResult> {
  const { profile, secret } = await decryptSecret(req.accountId);
  requireAccountScope(profile, "An account SAS");
  const key = requireKey(secret);
  const n = normalizeAccountSas(req);
  const query = signAccountSas(key, n);
  logActivity({
    kind: "connection",
    text: `Created account SAS for '${profile.name}' (${n.permissions}, expires ${n.expiresOn.toISOString()})`,
    status: "success",
  });
  return {
    url: accountSasUrl(blobHostEndpoint(profile.endpoint), query),
    query,
    expiresOn: n.expiresOn.toISOString(),
  };
}

export async function generateContainerSas(
  req: ContainerSasRequest,
): Promise<SasResult> {
  const loaded = await decryptSecret(req.accountId);
  const { profile, secret } = loaded;
  const key = requireKey(secret);
  let policy: StoredAccessPolicy | undefined;
  if (req.identifier) {
    // The server's copy decides which fields the policy pins, not the form's.
    const acl = await wrap(
      () => container(loaded, req.container).getAccessPolicy(),
      "Failed to read stored access policies",
    );
    const si = acl.signedIdentifiers.find((s) => s.id === req.identifier);
    policy = si ? toPolicy(si) : undefined;
  }
  const n = normalizeContainerSas(req, policy);
  const query = signContainerSas(key, n);
  const expiresOn = n.expiresOn?.toISOString() ?? policy?.expiresOn;
  logActivity({
    kind: "container",
    text: `Created SAS for container '${n.container}' in '${profile.name}'${n.identifier ? ` (policy ${n.identifier})` : ""}`,
    status: "success",
  });
  return {
    url: containerSasUrl(
      blobHostEndpoint(profile.endpoint),
      n.container,
      query,
    ),
    query,
    expiresOn,
  };
}

/* ---------- container access: public level + stored access policies ---------- */

export async function getContainerAccess(
  accountId: string,
  name: string,
): Promise<ContainerAccessInfo> {
  const loaded = await decryptSecret(accountId);
  const acl = await wrap(
    () => container(loaded, name).getAccessPolicy(),
    `Failed to read access settings for "${name}"`,
  );
  return {
    publicAccess: publicLevel(acl.blobPublicAccess),
    policies: acl.signedIdentifiers.map(toPolicy),
  };
}

function toIdentifiers(policies: StoredAccessPolicy[]): SignedIdentifier[] {
  return policies.map((p) => ({
    id: p.id,
    accessPolicy: {
      startsOn: p.startsOn ? new Date(p.startsOn) : undefined,
      expiresOn: p.expiresOn ? new Date(p.expiresOn) : undefined,
      permissions: p.permissions,
    },
  }));
}

/** setAccessPolicy replaces both halves, so each setter re-sends the other half as it is now. */
export async function setStoredPolicies(
  accountId: string,
  name: string,
  policies: StoredAccessPolicy[],
): Promise<void> {
  const clean = validatePolicies(policies);
  const loaded = await decryptSecret(accountId);
  const client = container(loaded, name);
  await wrap(
    async () => {
      const acl = await client.getAccessPolicy();
      await client.setAccessPolicy(acl.blobPublicAccess, toIdentifiers(clean));
    },
    `Failed to save access policies for "${name}"`,
    {
      text: `Save access policies on '${name}' failed`,
      ok: `Saved ${clean.length} access polic${clean.length === 1 ? "y" : "ies"} on '${name}'`,
    },
  );
}

export async function setPublicAccess(
  accountId: string,
  name: string,
  level: PublicAccessLevel,
): Promise<void> {
  const loaded = await decryptSecret(accountId);
  const client = container(loaded, name);
  await wrap(
    async () => {
      const acl = await client.getAccessPolicy();
      await client.setAccessPolicy(sdkPublic(level), acl.signedIdentifiers);
    },
    `Failed to set public access on "${name}"`,
    {
      text: `Set public access on '${name}' failed`,
      ok: `Set public access on '${name}' to ${level}`,
    },
  );
}

/* ---------- properties + lease ---------- */

export async function getContainerProperties(
  accountId: string,
  name: string,
): Promise<ContainerPropertiesInfo> {
  const loaded = await decryptSecret(accountId);
  const client = container(loaded, name);
  const p = await wrap(
    () => client.getProperties(),
    `Failed to read properties of "${name}"`,
  );
  return {
    name,
    url: client.url.split("?")[0]!,
    lastModified: p.lastModified?.toISOString(),
    etag: p.etag,
    leaseState: p.leaseState,
    leaseStatus: p.leaseStatus,
    leaseDuration: p.leaseDuration,
    publicAccess: publicLevel(p.blobPublicAccess),
    hasImmutabilityPolicy: p.hasImmutabilityPolicy,
    hasLegalHold: p.hasLegalHold,
    defaultEncryptionScope: p.defaultEncryptionScope,
    denyEncryptionScopeOverride: p.denyEncryptionScopeOverride,
    isImmutableStorageWithVersioningEnabled:
      p.isImmutableStorageWithVersioningEnabled,
    metadata: p.metadata ?? {},
  };
}

/** ASE's Acquire Lease: an infinite lease. Returns the lease ID. */
export async function acquireContainerLease(
  accountId: string,
  name: string,
): Promise<string> {
  const loaded = await decryptSecret(accountId);
  const client = container(loaded, name);
  return wrap(
    async () => {
      const res = await client.getBlobLeaseClient().acquireLease(-1);
      if (!res.leaseId) throw new Error("Azure returned no lease ID.");
      return res.leaseId;
    },
    `Failed to acquire a lease on "${name}"`,
    {
      text: `Acquire lease on '${name}' failed`,
      ok: `Acquired an infinite lease on '${name}'`,
    },
  );
}

/** Break immediately (period 0), no lease ID needed. */
export async function breakContainerLease(
  accountId: string,
  name: string,
): Promise<void> {
  const loaded = await decryptSecret(accountId);
  const client = container(loaded, name);
  await wrap(
    async () => {
      await client.getBlobLeaseClient().breakLease(0);
    },
    `Failed to break the lease on "${name}"`,
    {
      text: `Break lease on '${name}' failed`,
      ok: `Broke the lease on '${name}'`,
    },
  );
}

/* ---------- service properties: CORS + blob soft delete ---------- */

export async function getCors(accountId: string): Promise<CorsRuleInfo[]> {
  const loaded = await decryptSecret(accountId);
  requireAccountScope(loaded.profile, "CORS settings");
  const props = await wrap(
    () => service(loaded).getProperties(),
    "Failed to read service properties",
  );
  return (props.cors ?? []).map((r) => ({
    allowedOrigins: r.allowedOrigins,
    allowedMethods: r.allowedMethods,
    allowedHeaders: r.allowedHeaders,
    exposedHeaders: r.exposedHeaders,
    maxAgeInSeconds: r.maxAgeInSeconds,
  }));
}

/** Only `cors` is sent; Azure leaves every service property that's omitted as it is. */
export async function setCors(
  accountId: string,
  rules: CorsRuleInfo[],
): Promise<void> {
  const clean = validateCors(rules);
  const loaded = await decryptSecret(accountId);
  requireAccountScope(loaded.profile, "CORS settings");
  await wrap(
    async () => {
      await service(loaded).setProperties({ cors: clean });
    },
    "Failed to save CORS settings",
    {
      text: `Save CORS settings on '${loaded.profile.name}' failed`,
      ok: `Saved ${clean.length} CORS rule${clean.length === 1 ? "" : "s"} on '${loaded.profile.name}'`,
    },
  );
}

export async function getSoftDelete(
  accountId: string,
): Promise<SoftDeleteInfo> {
  const loaded = await decryptSecret(accountId);
  requireAccountScope(loaded.profile, "Soft delete settings");
  const props = await wrap(
    () => service(loaded).getProperties(),
    "Failed to read service properties",
  );
  const p = props.deleteRetentionPolicy;
  return { enabled: Boolean(p?.enabled), days: p?.days };
}

export async function setSoftDelete(
  accountId: string,
  input: SoftDeleteInfo,
): Promise<void> {
  const clean = validateSoftDelete(input);
  const loaded = await decryptSecret(accountId);
  requireAccountScope(loaded.profile, "Soft delete settings");
  await wrap(
    async () => {
      await service(loaded).setProperties({
        deleteRetentionPolicy: clean.enabled
          ? { enabled: true, days: clean.days }
          : { enabled: false },
      });
    },
    "Failed to save soft delete policy",
    {
      text: `Save soft delete policy on '${loaded.profile.name}' failed`,
      ok: clean.enabled
        ? `Blob soft delete on '${loaded.profile.name}': ${clean.days} days`
        : `Blob soft delete turned off on '${loaded.profile.name}'`,
    },
  );
}
