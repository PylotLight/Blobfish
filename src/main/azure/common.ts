import { isConnectionStringSecret } from "../azure-clients";

export function joinKey(prefix: string | undefined, leaf: string): string {
  const p = (prefix ?? "").replace(/^\/+|\/+$/g, "");
  const l = leaf.replace(/^\/+|\/+$/g, "");
  return p ? `${p}/${l}` : l;
}

/** Append the SAS query to a blob URL unless the client URL already carries it. */
export function withSas(blobUrl: string, secret: string): string {
  if (blobUrl.includes("?")) return blobUrl;
  if (isConnectionStringSecret(secret) || !secret.includes("?")) return blobUrl;
  return `${blobUrl}?${secret.slice(secret.indexOf("?") + 1)}`;
}
