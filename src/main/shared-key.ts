/* Shared-key detection for SAS signing. Main-process only (it sees key material),
 * but electron-free so it can be unit tested. */

/** Azurite / storage emulator well-known account (public, documented by Microsoft). */
export const DEV_ACCOUNT_NAME = "devstoreaccount1";
export const DEV_ACCOUNT_KEY =
  "Eby8vdM02xNOcqFlqUwJPLlmEtlCDXJ1OUzFT50uSRZ6IFsuFq2UVErCz4I6tq/K1SZFPTOtr/KBHBeksoGMGw==";

/** Split `K=V;K=V` on the first `=` only (base64 keys end in `=`). Keys are case-insensitive. */
export function connectionStringFields(secret: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const part of secret.trim().split(";")) {
    const i = part.indexOf("=");
    if (i <= 0) continue;
    out.set(part.slice(0, i).trim().toLowerCase(), part.slice(i + 1).trim());
  }
  return out;
}

export interface SharedKey {
  accountName: string;
  accountKey: string;
}

/** Account name + key from a connection string, or null for SAS URLs / SAS connection strings. */
export function sharedKeyFromSecret(secret: string): SharedKey | null {
  const s = secret.trim();
  if (/^UseDevelopmentStorage=true$/i.test(s))
    return { accountName: DEV_ACCOUNT_NAME, accountKey: DEV_ACCOUNT_KEY };
  if (/^https?:\/\//i.test(s)) return null;
  const f = connectionStringFields(s);
  const accountName = f.get("accountname");
  const accountKey = f.get("accountkey");
  if (!accountName || !accountKey) return null;
  return { accountName, accountKey };
}

export const SAS_ONLY_REASON =
  "This connection uses a SAS token, so it can't sign new ones. Attach the account with an account-key connection string to create SAS tokens.";
export const NO_KEY_REASON =
  "This connection string has no AccountKey, so it can't sign SAS tokens.";

export function sasUnavailableReason(secret: string): string | undefined {
  if (sharedKeyFromSecret(secret)) return undefined;
  return /^https?:\/\//i.test(secret.trim()) ? SAS_ONLY_REASON : NO_KEY_REASON;
}

/** Blob APIs on a dfs SAS URL need the blob host (same account, same token). */
export function blobHostSecret(secret: string): string {
  const s = secret.trim();
  if (!/^https?:\/\//i.test(s) || !s.includes(".dfs.")) return s;
  try {
    const url = new URL(s);
    url.host = url.host.replace(".dfs.", ".blob.");
    return url.toString();
  } catch {
    return s;
  }
}

export function blobHostEndpoint(endpoint: string): string {
  return endpoint.replace(".dfs.", ".blob.");
}
