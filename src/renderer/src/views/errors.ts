/**
 * Central error parsing for the renderer.
 * Electron IPC failures arrive as `Error invoking remote method 'x': Error: ...`.
 * Never surface that wrapper — strip it and map to a friendly title/message,
 * keeping the raw text available only under "Details".
 */

export type ExplorerErrorKind = 'auth' | 'not-found' | 'exists' | 'network' | 'empty' | 'unknown'

export interface ExplorerError {
  title: string
  message: string
  /** Sanitized technical detail (no IPC wrapper), shown collapsed. */
  technical: string
  kind: ExplorerErrorKind
  /** True when the operation outcome is unknown (e.g. 403 on list). */
  unauthorized: boolean
}

const IPC_PREFIX_RE =
  /^(Error:\s*)?(Error invoking remote method '[^']*':\s*(Error:\s*)?)+/i

export function stripIpcWrapper(raw: string): string {
  let out = raw.trim()
  // Electron can nest the wrapper more than once — strip repeatedly.
  for (let i = 0; i < 3; i++) {
    const next = out.replace(IPC_PREFIX_RE, '').trim()
    if (next === out) break
    out = next
  }
  // Drop a single leading "Error: " left over from `String(err)`.
  out = out.replace(/^Error:\s*/i, '').trim()
  return out || raw.trim()
}

export function parseStorageError(err: unknown, context: 'containers' | 'blobs' | 'action'): ExplorerError {
  const raw = err instanceof Error ? err.message : String(err ?? '')
  const clean = stripIpcWrapper(raw)
  const lower = clean.toLowerCase()

  const technical = clean.length > 800 ? `${clean.slice(0, 800)}…` : clean

  if (/does not represent any resource on the server/i.test(clean)) {
    return {
      title: 'Wrong SAS scope (400)',
      message:
        'This SAS URL is scoped to a different container than the one requested. Re-attach with a service SAS or the matching container SAS.',
      technical,
      kind: 'auth',
      unauthorized: true
    }
  }
  if (/403|authorizationfailure|not authorized|access denied/i.test(clean)) {
    return {
      title: context === 'containers' ? 'Cannot list containers — access denied (403)' : context === 'blobs' ? 'Cannot list blobs — access denied (403)' : 'Access denied (403)',
      message:
        "This connection's key or SAS token lacks permission for that action, or it has expired. Update the connection credentials, then retry.",
      technical,
      kind: 'auth',
      unauthorized: true
    }
  }
  if (/authenticationfailed|invalid sas|invalid.*connection string/i.test(clean)) {
    return {
      title: 'Authentication failed',
      message: 'The connection string or SAS URL is invalid or has expired. Re-attach the account with fresh credentials.',
      technical,
      kind: 'auth',
      unauthorized: true
    }
  }
  if (/404|containernotfound|filesystemnotfound|blobnotfound|pathnotfound|not found/i.test(clean)) {
    // Avoid dead-lowercase check duplication; `lower` is used for network below.
    void lower
    return {
      title: 'Not found (404)',
      message: 'The container, folder or blob may have been renamed or removed. Refresh to reload.',
      technical,
      kind: 'not-found',
      unauthorized: false
    }
  }
  if (/409|already exists|containerexists|filesystemalreadyexists/i.test(clean)) {
    return {
      title: 'Already exists (409)',
      message: 'That name is already taken. Pick a different name and try again.',
      technical,
      kind: 'exists',
      unauthorized: false
    }
  }
  if (/enotfound|eai_again|fetch failed|failed to fetch|network|cannot reach|econnrefused|etimedout/i.test(lower)) {
    return {
      title: 'Network error',
      message: 'Cannot reach the storage endpoint. Check your connection and endpoint, then retry.',
      technical,
      kind: 'network',
      unauthorized: false
    }
  }
  return {
    title: 'Something went wrong',
    message: clean.length <= 160 ? clean : 'The operation failed. Expand Details for the technical message, then retry.',
    technical,
    kind: 'unknown',
    unauthorized: false
  }
}
