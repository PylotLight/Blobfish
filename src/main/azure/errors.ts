/** Friendly wrapper so renderer errors are readable, not SDK soup. */
export function friendlyError(err: unknown, fallback: string): Error {
  if (err instanceof Error) {
    const msg = err.message;
    if (/does not represent any resource on the server/i.test(msg)) {
      return new Error(
        `Invalid resource (400). The SAS scope doesn't match the requested container — re-attach with a service SAS or the matching container SAS. (${msg})`,
      );
    }
    if (/403|AuthorizationFailure|not authorized/i.test(msg)) {
      return new Error(
        "Access denied (403). This key/SAS lacks permission for that action, or it has expired.",
      );
    }
    if (
      /404|ContainerNotFound|FilesystemNotFound|BlobNotFound|PathNotFound/i.test(
        msg,
      )
    ) {
      return new Error(
        "Not found (404). The container, folder or blob may have been removed.",
      );
    }
    if (
      /409|ContainerAlreadyExists|FilesystemAlreadyExists|BlobAlreadyExists/i.test(
        msg,
      )
    ) {
      return new Error("Already exists (409). Pick a different name.");
    }
    if (/ENOTFOUND|EAI_AGAIN|Failed to fetch|fetch failed|network/i.test(msg)) {
      return new Error("Network error: cannot reach the storage endpoint.");
    }
    if (/Invalid SAS|AuthenticationFailed/i.test(msg)) {
      return new Error(
        "Authentication failed. The connection string or SAS is invalid or expired.",
      );
    }
    return new Error(`${fallback}: ${msg}`);
  }
  return new Error(fallback);
}
