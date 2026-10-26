import { basename } from "node:path";
import { decryptSecret } from "../accounts";
import { logActivity } from "../activity";
import { blobContainerClientFromSecret, isDfsEndpoint } from "../azure-clients";
import { withSas } from "./common";
import { friendlyError } from "./errors";

export async function renameBlob(
  accountId: string,
  container: string,
  source: string,
  destLeaf: string,
): Promise<string> {
  const leaf = destLeaf.trim();
  if (leaf === "" || leaf.includes("/")) {
    throw new Error("New file name cannot be empty or contain slashes.");
  }
  const slash = source.lastIndexOf("/");
  const dest = slash === -1 ? leaf : `${source.slice(0, slash + 1)}${leaf}`;
  if (dest === source) return source;
  const started = Date.now();
  const { profile, secret } = await decryptSecret(accountId);
  if (isDfsEndpoint(profile.endpoint)) {
    throw new Error("Rename is not supported for ADLS Gen2 attachments yet.");
  }
  try {
    const client = blobContainerClientFromSecret(secret, container);
    const srcBlob = client.getBlobClient(source);
    const destBlob = client.getBlockBlobClient(dest);
    const srcUrl = withSas(srcBlob.url, secret);
    await destBlob.syncCopyFromURL(srcUrl);
    await srcBlob.delete();
    logActivity({
      kind: "blob",
      text: `Renamed '${source}' → '${dest}'`,
      status: "success",
      durationMs: Date.now() - started,
    });
    return dest;
  } catch (err) {
    const message = err instanceof Error ? err.message : "Rename failed";
    logActivity({
      kind: "blob",
      text: `Rename '${basename(source)}' failed`,
      detail: message,
      status: "failed",
    });
    throw friendlyError(err, `Failed to rename "${basename(source)}"`);
  }
}
