/* Trust the OS certificate store for main-process HTTPS (no electron imports, so the
 * listing worker can call it too).
 *
 * Every Azure call goes through the SDK's Node http client, and Node only trusts its own
 * bundled Mozilla roots. Chromium (and every other mac app) trusts the keychain. So on a
 * work machine behind a TLS-inspecting proxy (Zscaler, Netskope, AV web shields...) or
 * against an endpoint with a private CA, Node fails with "self signed certificate in
 * certificate chain" while the same account works in a browser or Storage Explorer.
 *
 * Electron 45 ships Node 24, which can read the system store (`tls.getCACertificates
 * ('system')`: keychain on macOS, cert store on Windows, OpenSSL dirs on Linux) and
 * replace the default CA list (`tls.setDefaultCACertificates`). We merge system roots
 * into the defaults: verification stays on, nothing is ever disabled. Both calls are
 * per-thread, hence the worker calls this as well. Older runtimes are a quiet no-op. */
import * as nodeTls from "node:tls";

type CaSource = "default" | "system" | "bundled" | "extra";

/** The slice of node:tls this needs (injectable for tests). */
export interface TlsCaApi {
  getCACertificates?: (type?: CaSource) => string[];
  setDefaultCACertificates?: (certs: string[]) => void;
}

export type SystemCaResult =
  | { applied: true; added: number; total: number }
  | { applied: false; reason: string };

function normalizePem(pem: string): string {
  return pem.replace(/\r\n/g, "\n").trim();
}

/** Default roots + system roots, de-duplicated, defaults first. */
export function mergeCaLists(
  defaults: readonly string[],
  system: readonly string[],
): { merged: string[]; added: number } {
  const seen = new Set<string>();
  const merged: string[] = [];
  for (const pem of defaults) {
    const key = normalizePem(pem);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    merged.push(pem);
  }
  const before = merged.length;
  for (const pem of system) {
    const key = normalizePem(pem);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    merged.push(pem);
  }
  return { merged, added: merged.length - before };
}

export function trustSystemCertificates(
  tls: TlsCaApi = nodeTls as unknown as TlsCaApi,
): SystemCaResult {
  if (
    typeof tls.getCACertificates !== "function" ||
    typeof tls.setDefaultCACertificates !== "function"
  ) {
    return { applied: false, reason: "runtime has no system CA support" };
  }
  try {
    const system = tls.getCACertificates("system");
    if (!Array.isArray(system) || system.length === 0) {
      return { applied: false, reason: "system store is empty" };
    }
    const defaults = tls.getCACertificates("default");
    const { merged, added } = mergeCaLists(
      Array.isArray(defaults) ? defaults : [],
      system,
    );
    if (added === 0) {
      return { applied: false, reason: "system roots already trusted" };
    }
    tls.setDefaultCACertificates(merged);
    return { applied: true, added, total: merged.length };
  } catch (err) {
    return {
      applied: false,
      reason: err instanceof Error ? err.message : String(err),
    };
  }
}

let once: SystemCaResult | null = null;

/** Idempotent per thread: runs before the first Azure client is built. */
export function ensureSystemCertificates(): SystemCaResult {
  if (once) return once;
  once = trustSystemCertificates();
  if (!once.applied && !/already trusted|empty/.test(once.reason)) {
    console.warn(`[blobfish] system CA store not used: ${once.reason}`);
  }
  return once;
}
