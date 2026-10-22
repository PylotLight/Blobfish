/* Input checks for the container / service admin dialogs. Pure: main runs them
 * before calling Azure, the dialogs run them for inline errors. */
import { flagString, POLICY_PERMISSIONS } from "./sas";
import type { CorsRuleInfo, SoftDeleteInfo, StoredAccessPolicy } from "./types";

/** Azure allows at most five stored access policies per container. */
export const MAX_POLICIES = 5;

export function validatePolicies(
  policies: StoredAccessPolicy[],
): StoredAccessPolicy[] {
  if (policies.length > MAX_POLICIES)
    throw new Error(`A container can hold at most ${MAX_POLICIES} policies.`);
  const seen = new Set<string>();
  return policies.map((p) => {
    const id = p.id.trim();
    if (!id) throw new Error("Every policy needs an ID.");
    if (id.length > 64) throw new Error(`Policy ID "${id}" is over 64 chars.`);
    if (seen.has(id)) throw new Error(`Duplicate policy ID "${id}".`);
    seen.add(id);
    const startsOn = p.startsOn ? new Date(p.startsOn) : undefined;
    const expiresOn = p.expiresOn ? new Date(p.expiresOn) : undefined;
    if (startsOn && Number.isNaN(startsOn.getTime()))
      throw new Error(`Policy "${id}" has an invalid start.`);
    if (expiresOn && Number.isNaN(expiresOn.getTime()))
      throw new Error(`Policy "${id}" has an invalid expiry.`);
    if (startsOn && expiresOn && expiresOn <= startsOn)
      throw new Error(`Policy "${id}" expires before it starts.`);
    return {
      id,
      startsOn: startsOn?.toISOString(),
      expiresOn: expiresOn?.toISOString(),
      permissions:
        flagString(POLICY_PERMISSIONS, p.permissions ?? "") || undefined,
    };
  });
}

const CORS_METHODS = new Set([
  "DELETE",
  "GET",
  "HEAD",
  "MERGE",
  "POST",
  "OPTIONS",
  "PUT",
  "PATCH",
]);

export function validateCors(rules: CorsRuleInfo[]): CorsRuleInfo[] {
  if (rules.length > 5)
    throw new Error("Azure allows at most 5 CORS rules per service.");
  const list = (s: string): string =>
    s
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean)
      .join(",");
  return rules.map((r, i) => {
    const allowedOrigins = list(r.allowedOrigins);
    const allowedMethods = list(r.allowedMethods.toUpperCase());
    if (!allowedOrigins)
      throw new Error(`Rule ${i + 1}: add an allowed origin (or *).`);
    if (!allowedMethods)
      throw new Error(`Rule ${i + 1}: pick at least one method.`);
    for (const m of allowedMethods.split(","))
      if (!CORS_METHODS.has(m))
        throw new Error(`Rule ${i + 1}: unknown method ${m}.`);
    const maxAge = Math.floor(Number(r.maxAgeInSeconds));
    if (!Number.isFinite(maxAge) || maxAge < 0)
      throw new Error(`Rule ${i + 1}: max age must be 0 or more seconds.`);
    return {
      allowedOrigins,
      allowedMethods,
      allowedHeaders: list(r.allowedHeaders),
      exposedHeaders: list(r.exposedHeaders),
      maxAgeInSeconds: maxAge,
    };
  });
}

export function validateSoftDelete(input: SoftDeleteInfo): SoftDeleteInfo {
  if (!input.enabled) return { enabled: false };
  const days = Math.floor(Number(input.days));
  if (!Number.isFinite(days) || days < 1 || days > 365)
    throw new Error("Retention must be 1–365 days.");
  return { enabled: true, days };
}
