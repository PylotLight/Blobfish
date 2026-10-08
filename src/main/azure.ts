import { BlobServiceClient, ContainerClient } from '@azure/storage-blob'
import { DataLakeFileSystemClient, DataLakeServiceClient } from '@azure/storage-file-datalake'
import { basename } from 'node:path'
import { decryptSecret } from './accounts'
import { logActivity } from './activity'
import { formatBytes } from '../shared/format'
import type { ListBlobsResult, StorageBlobItem, StorageContainer } from '../shared/types'

export function isDfsEndpoint(endpoint: string): boolean {
  return endpoint.includes('.dfs.')
}

export function isConnectionStringSecret(secret: string): boolean {
  const s = secret.trim()
  return s.includes('AccountName=') || s === 'UseDevelopmentStorage=true'
}

export function blobServiceFromSecret(_profileEndpoint: string, secret: string): BlobServiceClient {
  if (isConnectionStringSecret(secret)) {
    return BlobServiceClient.fromConnectionString(secret.trim())
  }
  // Full SAS URL (service or container scoped).
  return new BlobServiceClient(secret.trim())
}

export function dataLakeServiceFromSecret(secret: string): DataLakeServiceClient {
  if (isConnectionStringSecret(secret)) {
    return DataLakeServiceClient.fromConnectionString(secret.trim())
  }
  return new DataLakeServiceClient(secret.trim())
}

/**
 * A SAS URL may be scoped to the whole service (`https://acct.blob…?sv=…`),
 * a single container (`…/mycontainer?sv=…`), or a directory inside one
 * (`…/mycontainer/dir?sv=…`). `new BlobServiceClient(containerSasUrl)
 * .getContainerClient(container)` would then double the path
 * (`…/mycontainer/mycontainer`) and Azure answers 400 "The requested URI
 * does not represent any resource on the server." — exactly the failure
 * reported for container-SAS attachments. These helpers return a client
 * bound to the SAS scope instead.
 */
function containerUrlFromSas(secret: string, container: string): string {
  const trimmed = secret.trim()
  const url = new URL(trimmed)
  const segs = url.pathname.split('/').filter(Boolean)
  const sasContainer = segs[0] ? decodeURIComponent(segs[0]) : undefined
  if (!sasContainer) return trimmed
  if (container && sasContainer.toLowerCase() !== container.trim().toLowerCase()) {
    throw new Error(
      `This SAS grants access to container "${sasContainer}", not "${container}". Re-attach with a service SAS or the matching container SAS.`
    )
  }
  // Strip any directory prefix — the client must point at the container root.
  return `${url.origin}/${encodeURIComponent(sasContainer)}${url.search}`
}

function sasContainerName(secret: string): string | undefined {
  try {
    const url = new URL(secret.trim())
    const segs = url.pathname.split('/').filter(Boolean)
    return segs[0] ? decodeURIComponent(segs[0]) : undefined
  } catch {
    return undefined
  }
}

export function blobContainerClientFromSecret(secret: string, container: string): ContainerClient {
  if (isConnectionStringSecret(secret)) {
    return BlobServiceClient.fromConnectionString(secret.trim()).getContainerClient(container)
  }
  const trimmed = secret.trim()
  const sasContainer = sasContainerName(trimmed)
  if (!sasContainer) {
    // Service-scoped SAS — derive the container from it.
    return new BlobServiceClient(trimmed).getContainerClient(container)
  }
  return new ContainerClient(containerUrlFromSas(trimmed, container))
}

export function dataLakeFileSystemClientFromSecret(
  secret: string,
  container: string
): DataLakeFileSystemClient {
  if (isConnectionStringSecret(secret)) {
    return DataLakeServiceClient.fromConnectionString(secret.trim()).getFileSystemClient(container)
  }
  const trimmed = secret.trim()
  const sasContainer = sasContainerName(trimmed)
  if (!sasContainer) {
    return new DataLakeServiceClient(trimmed).getFileSystemClient(container)
  }
  return new DataLakeFileSystemClient(containerUrlFromSas(trimmed, container))
}

/** Friendly wrapper so renderer errors are readable, not SDK soup. */
export function friendlyError(err: unknown, fallback: string): Error {
  if (err instanceof Error) {
    const msg = err.message
    if (/does not represent any resource on the server/i.test(msg)) {
      return new Error(
        `Invalid resource (400). The SAS scope doesn't match the requested container — re-attach with a service SAS or the matching container SAS. (${msg})`
      )
    }
    if (/403|AuthorizationFailure|not authorized/i.test(msg)) {
      return new Error('Access denied (403). This key/SAS lacks permission for that action, or it has expired.')
    }
    if (/404|ContainerNotFound|FilesystemNotFound|BlobNotFound|PathNotFound/i.test(msg)) {
      return new Error('Not found (404). The container, folder or blob may have been removed.')
    }
    if (/409|ContainerAlreadyExists|FilesystemAlreadyExists|BlobAlreadyExists/i.test(msg)) {
      return new Error('Already exists (409). Pick a different name.')
    }
    if (/ENOTFOUND|EAI_AGAIN|Failed to fetch|fetch failed|network/i.test(msg)) {
      return new Error('Network error: cannot reach the storage endpoint.')
    }
    if (/Invalid SAS|AuthenticationFailed/i.test(msg)) {
      return new Error('Authentication failed. The connection string or SAS is invalid or expired.')
    }
    return new Error(`${fallback}: ${msg}`)
  }
  return new Error(fallback)
}

function joinKey(prefix: string | undefined, leaf: string): string {
  const p = (prefix ?? '').replace(/^\/+|\/+$/g, '')
  const l = leaf.replace(/^\/+|\/+$/g, '')
  return p ? `${p}/${l}` : l
}

/** Append the SAS query to a blob URL unless the client URL already carries it. */
function withSas(blobUrl: string, secret: string): string {
  if (blobUrl.includes('?')) return blobUrl
  if (isConnectionStringSecret(secret) || !secret.includes('?')) return blobUrl
  return `${blobUrl}?${secret.slice(secret.indexOf('?') + 1)}`
}

export async function listContainers(accountId: string): Promise<StorageContainer[]> {
  const { profile, secret } = decryptSecret(accountId)
  // Container-scoped attachments cannot enumerate the account — return the
  // attached container as a singleton without probing it. A getProperties
  // probe 403s on list-only SAS tokens even though blob listing works fine,
  // which cried wolf in the activity dock; the blob listing itself is the
  // arbiter of access and its failures surface in the blob view.
  if (profile.kind !== 'account' && profile.containerName) {
    // Still validates a container SAS against the attached container
    // (throws on mismatch) — it just performs no network call.
    if (isDfsEndpoint(profile.endpoint)) {
      dataLakeFileSystemClientFromSecret(secret, profile.containerName)
    } else {
      blobContainerClientFromSecret(secret, profile.containerName)
    }
    return [{ name: profile.containerName }]
  }
  // Forgiving: an "account" profile that actually holds a container SAS URL.
  if (profile.containerName && profile.authType === 'sas') {
    return [{ name: profile.containerName }]
  }
  try {
    if (isDfsEndpoint(profile.endpoint)) {
      const svc = dataLakeServiceFromSecret(secret)
      const out: StorageContainer[] = []
      for await (const fs of svc.listFileSystems()) {
        out.push({ name: fs.name })
      }
      return out.sort((a, b) => a.name.localeCompare(b.name))
    }
    const svc = blobServiceFromSecret(profile.endpoint, secret)
    const out: StorageContainer[] = []
    for await (const c of svc.listContainers()) {
      out.push({
        name: c.name,
        lastModified: c.properties?.lastModified?.toISOString()
      })
    }
    return out.sort((a, b) => a.name.localeCompare(b.name))
  } catch (err) {
    const friendly = friendlyError(err, 'Failed to list containers')
    logActivity({
      kind: 'connection',
      text: `List containers in '${profile.name}' failed`,
      detail: friendly.message,
      status: 'failed'
    })
    throw friendly
  }
}

export async function listBlobs(
  accountId: string,
  containerArg?: string,
  prefixArg?: string,
  pageSize = 5000
): Promise<ListBlobsResult> {
  const { profile, secret } = decryptSecret(accountId)
  const container = (containerArg ?? profile.containerName ?? '').trim()
  if (container === '') throw new Error('No container selected.')
  const base = (profile.prefix ?? '').replace(/^\/+|\/+$/g, '')
  const nav = (prefixArg ?? '').replace(/^\/+/, '')
  const effective = [base, nav].filter(Boolean).join('/').replace(/^\/+|\/+$/g, '')
  const listingPrefix = effective === '' ? undefined : effective.endsWith('/') ? effective : `${effective}/`

  try {
    if (isDfsEndpoint(profile.endpoint)) {
      const fs = dataLakeFileSystemClientFromSecret(secret, container)
      const items: StorageBlobItem[] = []
      const seen = new Set<string>()
      // listPaths with recursive=false emulates hierarchy.
      for await (const p of fs.listPaths({
        path: effective === '' ? undefined : effective,
        recursive: false
      })) {
        const full = p.name!
        const rest = effective === '' ? full : full.slice(effective.length + 1)
        if (rest === '' || rest.includes('/')) {
          // Deeper nesting collapsed to the next segment as a prefix.
          const seg = rest.split('/')[0]
          const dirName = effective === '' ? seg! : `${effective}/${seg}`
          if (seg && !seen.has(dirName)) {
            seen.add(dirName)
            items.push({ name: dirName, leaf: seg!, isPrefix: true })
          }
          continue
        }
        items.push({
          name: full,
          leaf: rest,
          isPrefix: Boolean(p.isDirectory),
          size: p.contentLength,
          lastModified: p.lastModified?.toISOString()
        })
        if (items.length >= Math.min(pageSize, 5000)) break
      }
      items.sort((a, b) => Number(b.isPrefix) - Number(a.isPrefix) || a.leaf.localeCompare(b.leaf))
      return { container, prefix: effective, items }
    }

    const client = blobContainerClientFromSecret(secret, container)
    const items: StorageBlobItem[] = []
    const iter = client.listBlobsByHierarchy('/', { prefix: listingPrefix })
    for await (const entry of iter) {
      if (entry.kind === 'prefix') {
        const full = entry.name.replace(/\/$/, '')
        const leaf = effective === '' ? full : full.slice(effective.length + 1) || full
        items.push({ name: full, leaf, isPrefix: true })
      } else {
        // Zero-byte `folder/` marker blobs (created by New Folder) surface as folders.
        if (entry.name.endsWith('/') && (entry.properties?.contentLength ?? 0) === 0) {
          const full = entry.name.replace(/\/$/, '')
          const leaf = effective === '' ? full : full.slice(effective.length + 1) || full
          items.push({ name: full, leaf, isPrefix: true })
          continue
        }
        items.push({
          name: entry.name,
          leaf: entry.name.slice((listingPrefix ?? '').length) || entry.name,
          isPrefix: false,
          size: entry.properties?.contentLength,
          lastModified: entry.properties?.lastModified?.toISOString(),
          contentType: entry.properties?.contentType
        })
      }
      if (items.length >= Math.min(pageSize, 5000)) break
    }
    items.sort((a, b) => Number(b.isPrefix) - Number(a.isPrefix) || a.leaf.localeCompare(b.leaf))
    return { container, prefix: effective, items }
  } catch (err) {
    const friendly = friendlyError(err, `Failed to list blobs in "${container}"`)
    logActivity({
      kind: 'connection',
      text: `List blobs in '${container}' failed`,
      detail: friendly.message,
      status: 'failed'
    })
    throw friendly
  }
}

/* ---------------- CRUD ---------------- */

export async function createContainer(accountId: string, name: string): Promise<void> {
  const clean = name.trim().toLowerCase()
  if (!/^[a-z0-9]([a-z0-9-]{1,61}[a-z0-9])?$/.test(clean)) {
    throw new Error('Container names are 3–63 lowercase letters, numbers and dashes.')
  }
  const started = Date.now()
  const { profile, secret } = decryptSecret(accountId)
  try {
    if (isDfsEndpoint(profile.endpoint)) {
      await dataLakeServiceFromSecret(secret).getFileSystemClient(clean).create()
    } else {
      await blobServiceFromSecret(profile.endpoint, secret).getContainerClient(clean).create()
    }
    logActivity({
      kind: 'container',
      text: `Created container '${clean}' in '${profile.name}'`,
      status: 'success',
      durationMs: Date.now() - started
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to create container'
    logActivity({ kind: 'container', text: `Create container '${clean}' failed`, detail: message, status: 'failed' })
    throw friendlyError(err, `Failed to create container "${clean}"`)
  }
}

export async function deleteContainer(accountId: string, name: string): Promise<void> {
  const started = Date.now()
  const { profile, secret } = decryptSecret(accountId)
  try {
    if (isDfsEndpoint(profile.endpoint)) {
      await dataLakeServiceFromSecret(secret).getFileSystemClient(name).delete()
    } else {
      await blobServiceFromSecret(profile.endpoint, secret).getContainerClient(name).delete()
    }
    logActivity({
      kind: 'container',
      text: `Deleted container '${name}' from '${profile.name}'`,
      status: 'success',
      durationMs: Date.now() - started
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to delete container'
    logActivity({ kind: 'container', text: `Delete container '${name}' failed`, detail: message, status: 'failed' })
    throw friendlyError(err, `Failed to delete container "${name}"`)
  }
}

/**
 * Azure has no server-side container rename, so this copies every blob to a
 * new container and deletes the source. Refuses to delete the source unless
 * every copy succeeded.
 */
export async function renameContainer(
  accountId: string,
  source: string,
  destRaw: string
): Promise<string> {
  const dest = destRaw.trim().toLowerCase()
  if (!/^[a-z0-9]([a-z0-9-]{1,61}[a-z0-9])?$/.test(dest)) {
    throw new Error('Container names are 3–63 lowercase letters, numbers and dashes.')
  }
  if (dest === source) return source
  const started = Date.now()
  const { profile, secret } = decryptSecret(accountId)
  if (isDfsEndpoint(profile.endpoint)) {
    throw new Error('Renaming ADLS Gen2 filesystems is not supported yet — create a new one and move files instead.')
  }
  if (profile.kind !== 'account' || profile.containerName) {
    throw new Error('Renaming containers is only available on full storage-account connections.')
  }
  const svc = blobServiceFromSecret(profile.endpoint, secret)
  const srcClient = svc.getContainerClient(source)
  const destClient = svc.getContainerClient(dest)
  try {
    await destClient.create()
  } catch (err) {
    throw friendlyError(err, `Failed to create container "${dest}"`)
  }
  try {
    const names: string[] = []
    for await (const b of srcClient.listBlobsFlat()) {
      names.push(b.name)
    }
    let sas = ''
    if (!isConnectionStringSecret(secret) && secret.includes('?')) {
      sas = secret.slice(secret.indexOf('?'))
    }
    // Bounded parallelism keeps large containers moving without flooding.
    const queue = [...names]
    const workers = Array.from({ length: Math.min(8, Math.max(1, queue.length)) }, async () => {
      while (queue.length > 0) {
        const n = queue.shift()!
        const rawUrl = srcClient.getBlobClient(n).url
        const srcUrl = rawUrl.includes('?') ? rawUrl : `${rawUrl}${sas}`
        await destClient.getBlockBlobClient(n).syncCopyFromURL(srcUrl)
      }
    })
    await Promise.all(workers)
    await srcClient.delete()
    logActivity({
      kind: 'container',
      text: `Renamed container '${source}' → '${dest}' (${names.length} blob${names.length === 1 ? '' : 's'})`,
      status: 'success',
      durationMs: Date.now() - started
    })
    return dest
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to rename container'
    logActivity({ kind: 'container', text: `Rename container '${source}' failed`, detail: message, status: 'failed' })
    // Leave both containers in place so nothing is lost; surface the cause.
    throw friendlyError(err, `Failed to rename container "${source}"`)
  }
}

export async function createFolder(
  accountId: string,
  container: string,
  prefix: string | undefined,
  folderName: string
): Promise<void> {
  const leaf = folderName.trim().replace(/^\/+|\/+$/g, '')
  if (leaf === '' || leaf.includes('/')) {
    throw new Error('Folder name cannot be empty or contain slashes.')
  }
  const full = joinKey(prefix, leaf)
  const started = Date.now()
  const { profile, secret } = decryptSecret(accountId)
  try {
    if (isDfsEndpoint(profile.endpoint)) {
      const fs = dataLakeFileSystemClientFromSecret(secret, container)
      await fs.getDirectoryClient(full).create()
    } else {
      const client = blobContainerClientFromSecret(secret, container)
      // Zero-byte `folder/` marker — renders as a folder in hierarchy listings.
      await client.getBlockBlobClient(`${full}/`).uploadData(Buffer.alloc(0))
    }
    logActivity({
      kind: 'folder',
      text: `Created folder '${full}' in '${container}'`,
      status: 'success',
      durationMs: Date.now() - started
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to create folder'
    logActivity({ kind: 'folder', text: `Create folder '${leaf}' failed`, detail: message, status: 'failed' })
    throw friendlyError(err, `Failed to create folder "${leaf}"`)
  }
}

/** Expand folder prefixes (trailing `/`) into the flat files beneath them, with sizes. */
export async function expandFiles(
  profileEndpoint: string,
  secret: string,
  container: string,
  names: string[]
): Promise<Array<{ name: string; size?: number }>> {
  const folders = names.filter((n) => n.endsWith('/'))
  const files: Array<{ name: string; size?: number }> = names
    .filter((n) => !n.endsWith('/'))
    .map((name) => ({ name }))
  if (folders.length === 0) return files
  const out = [...files]
  const seen = new Set(out.map((f) => f.name))
  if (isDfsEndpoint(profileEndpoint)) {
    const fs = dataLakeFileSystemClientFromSecret(secret, container)
    for (const f of folders) {
      const trimmed = f.replace(/\/$/, '')
      for await (const p of fs.listPaths({ path: trimmed, recursive: true })) {
        if (!p.isDirectory && p.name && !seen.has(p.name)) {
          seen.add(p.name)
          out.push({ name: p.name, size: p.contentLength })
        }
      }
    }
  } else {
    const client = blobContainerClientFromSecret(secret, container)
    for (const f of folders) {
      for await (const b of client.listBlobsFlat({ prefix: f })) {
        if (!seen.has(b.name)) {
          seen.add(b.name)
          out.push({ name: b.name, size: b.properties?.contentLength })
        }
      }
    }
  }
  return out
}

export async function deleteNames(
  accountId: string,
  container: string,
  names: string[]
): Promise<number> {
  if (names.length === 0) return 0
  const started = Date.now()
  const { profile, secret } = decryptSecret(accountId)
  try {
    let count: number
    if (isDfsEndpoint(profile.endpoint)) {
      const fs = dataLakeFileSystemClientFromSecret(secret, container)
      // Directories first (recursive), then files.
      for (const n of names.filter((x) => x.endsWith('/'))) {
        await fs.getDirectoryClient(n.replace(/\/$/, '')).delete(true)
      }
      count = 0
      for (const f of await expandFiles(profile.endpoint, secret, container, names)) {
        await fs.getFileClient(f.name).delete()
        count += 1
      }
    } else {
      const client = blobContainerClientFromSecret(secret, container)
      const flat = (await expandFiles(profile.endpoint, secret, container, names)).map((f) => f.name)
      await Promise.all(flat.map((n) => client.deleteBlob(n)))
      // Remove any folder markers left behind.
      await Promise.all(
        names.filter((n) => n.endsWith('/')).map((n) => client.deleteBlob(n).catch(() => {}))
      )
      count = flat.length
    }
    logActivity({
      kind: 'blob',
      text: `Deleted ${count} item${count === 1 ? '' : 's'} from '${container}'`,
      status: 'success',
      durationMs: Date.now() - started
    })
    return count
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to delete'
    logActivity({ kind: 'blob', text: `Delete from '${container}' failed`, detail: message, status: 'failed' })
    throw friendlyError(err, 'Failed to delete')
  }
}

export async function renameBlob(
  accountId: string,
  container: string,
  source: string,
  destLeaf: string
): Promise<string> {
  const leaf = destLeaf.trim()
  if (leaf === '' || leaf.includes('/')) {
    throw new Error('New file name cannot be empty or contain slashes.')
  }
  const slash = source.lastIndexOf('/')
  const dest = slash === -1 ? leaf : `${source.slice(0, slash + 1)}${leaf}`
  if (dest === source) return source
  const started = Date.now()
  const { profile, secret } = decryptSecret(accountId)
  if (isDfsEndpoint(profile.endpoint)) {
    throw new Error('Rename is not supported for ADLS Gen2 attachments yet.')
  }
  try {
    const client = blobContainerClientFromSecret(secret, container)
    const srcBlob = client.getBlobClient(source)
    const destBlob = client.getBlockBlobClient(dest)
    const srcUrl = withSas(srcBlob.url, secret)
    await destBlob.syncCopyFromURL(srcUrl)
    await srcBlob.delete()
    logActivity({
      kind: 'blob',
      text: `Renamed '${source}' → '${dest}'`,
      status: 'success',
      durationMs: Date.now() - started
    })
    return dest
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Rename failed'
    logActivity({ kind: 'blob', text: `Rename '${basename(source)}' failed`, detail: message, status: 'failed' })
    throw friendlyError(err, `Failed to rename "${basename(source)}"`)
  }
}

/* ---------------- copy / move ---------------- */

function cleanDestPrefix(raw: string | undefined): string {
  const parts = (raw ?? '').split('/').map((s) => s.trim()).filter(Boolean)
  for (const p of parts) {
    if (p === '..') throw new Error('Destination folder names cannot be "..".')
    if (p.includes('\\')) throw new Error('Destination folder cannot contain backslashes.')
  }
  return parts.join('/')
}

interface CopyPlan {
  src: string
  dest: string
}

/** Blob-only expansion of selected folders → files plus leftover folder markers. */
async function expandBlobFolder(
  client: ContainerClient,
  folders: string[]
): Promise<{ files: Array<{ name: string; size?: number }>; markers: string[] }> {
  const files: Array<{ name: string; size?: number }> = []
  const markers: string[] = []
  const seen = new Set<string>()
  for (const f of folders) {
    for await (const b of client.listBlobsFlat({ prefix: f })) {
      if (seen.has(b.name)) continue
      seen.add(b.name)
      if (b.name.endsWith('/')) markers.push(b.name)
      else files.push({ name: b.name, size: b.properties?.contentLength })
    }
  }
  return { files, markers }
}

/** List-based existence check. getProperties needs read permission, which
 *  list/write-only SAS tokens lack; a prefix listing only needs list. Names
 *  return in lexicographic order, so we can stop at the first non-match. */
async function blobExists(client: ContainerClient, name: string): Promise<{ exists: boolean; size?: number }> {
  for await (const b of client.listBlobsFlat({ prefix: name })) {
    if (b.name === name) return { exists: true, size: b.properties?.contentLength }
    if (b.name > name && !b.name.startsWith(name)) break
  }
  return { exists: false }
}

/**
 * Plan sources → destinations. Explicit files land by basename; files under
 * selected folders keep their path relative to the selected folder. Refuses
 * self-moves and preflights destination collisions so nothing is silently
 * overwritten.
 */
async function planBlobCopy(
  client: ContainerClient,
  names: string[],
  destPrefix: string,
  overwrite: boolean
): Promise<{ jobs: CopyPlan[]; markers: string[] }> {
  if (names.length === 0) throw new Error('Nothing selected.')
  const folders = names.filter((n) => n.endsWith('/'))
  for (const f of folders) {
    const fp = f.replace(/\/$/, '')
    if (destPrefix === fp || destPrefix.startsWith(`${fp}/`)) {
      throw new Error(`Cannot copy/move "${fp}" into itself or its own subfolder.`)
    }
  }
  const jobs: CopyPlan[] = []
  const seen = new Set<string>()
  const destSeen = new Map<string, string>()
  const addJob = (src: string, dest: string): void => {
    if (dest === src) return // no-op
    const clash = destSeen.get(dest)
    if (clash !== undefined && clash !== src) {
      throw new Error(
        `Two selected items map to the same destination ("${dest}"). Move/copy them separately.`
      )
    }
    destSeen.set(dest, src)
    jobs.push({ src, dest })
  }
  for (const n of names.filter((x) => !x.endsWith('/'))) {
    if (seen.has(n)) continue
    seen.add(n)
    addJob(n, destPrefix ? `${destPrefix}/${basename(n)}` : basename(n))
  }
  const { files, markers } = await expandBlobFolder(client, folders)
  for (const f of files) {
    if (seen.has(f.name)) continue
    seen.add(f.name)
    const parent = folders
      .filter((fd) => f.name.startsWith(fd))
      .sort((a, b) => b.length - a.length)[0]!
    const rel = f.name.slice(parent.length)
    addJob(f.name, destPrefix ? `${destPrefix}/${rel}` : rel)
  }
  if (jobs.length === 0) throw new Error('Selected blobs are already in that folder.')
  if (!overwrite) {
    const conflicts: string[] = []
    await Promise.all(
      jobs.map(async (j) => {
        const found = await blobExists(client, j.dest)
        if (found.exists) conflicts.push(`${j.dest} (${formatBytes(found.size)})`)
      })
    )
    if (conflicts.length > 0) {
      const shown = conflicts.slice(0, 5).join(', ')
      throw new Error(
        `Destination already exists (${conflicts.length}): ${shown}${conflicts.length > 5 ? '…' : ''} ` +
          'Tick “Replace existing” to overwrite, or pick a different folder.'
      )
    }
  }
  return { jobs, markers }
}

async function runBlobCopy(client: ContainerClient, secret: string, jobs: CopyPlan[]): Promise<void> {
  // Bounded parallelism keeps large selections moving without flooding.
  const queue = [...jobs]
  const workers = Array.from({ length: Math.min(8, Math.max(1, queue.length)) }, async () => {
    while (queue.length > 0) {
      const job = queue.shift()!
      const srcUrl = withSas(client.getBlobClient(job.src).url, secret)
      await client.getBlockBlobClient(job.dest).syncCopyFromURL(srcUrl)
    }
  })
  await Promise.all(workers)
}

export async function copyBlobs(
  accountId: string,
  container: string,
  names: string[],
  destPrefixRaw?: string,
  overwrite = false
): Promise<number> {
  const destPrefix = cleanDestPrefix(destPrefixRaw)
  const started = Date.now()
  const { profile, secret } = decryptSecret(accountId)
  if (isDfsEndpoint(profile.endpoint)) {
    throw new Error('Copy is not supported for ADLS Gen2 attachments yet.')
  }
  const client = blobContainerClientFromSecret(secret, container)
  try {
    const { jobs } = await planBlobCopy(client, names, destPrefix, overwrite)
    await runBlobCopy(client, secret, jobs)
    logActivity({
      kind: 'blob',
      text: `Copied ${jobs.length} item${jobs.length === 1 ? '' : 's'} to '${destPrefix || container}'`,
      status: 'success',
      durationMs: Date.now() - started
    })
    return jobs.length
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Copy failed'
    logActivity({ kind: 'blob', text: `Copy to '${destPrefix || container}' failed`, detail: message, status: 'failed' })
    throw friendlyError(err, 'Failed to copy')
  }
}

export async function moveBlobs(
  accountId: string,
  container: string,
  names: string[],
  destPrefixRaw?: string,
  overwrite = false
): Promise<number> {
  const destPrefix = cleanDestPrefix(destPrefixRaw)
  const started = Date.now()
  const { profile, secret } = decryptSecret(accountId)
  if (isDfsEndpoint(profile.endpoint)) {
    throw new Error('Move is not supported for ADLS Gen2 attachments yet.')
  }
  const client = blobContainerClientFromSecret(secret, container)
  try {
    const { jobs, markers } = await planBlobCopy(client, names, destPrefix, overwrite)
    await runBlobCopy(client, secret, jobs)
    // Sources are deleted only after every copy succeeded.
    await Promise.all([...new Set(jobs.map((j) => j.src))].map((n) => client.deleteBlob(n)))
    await Promise.all(markers.map((m) => client.deleteBlob(m).catch(() => {})))
    logActivity({
      kind: 'blob',
      text: `Moved ${jobs.length} item${jobs.length === 1 ? '' : 's'} to '${destPrefix || container}'`,
      status: 'success',
      durationMs: Date.now() - started
    })
    return jobs.length
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Move failed'
    logActivity({ kind: 'blob', text: `Move to '${destPrefix || container}' failed`, detail: message, status: 'failed' })
    throw friendlyError(err, 'Failed to move')
  }
}

/** Well-known Azurite defaults, offered as a one-click shortcut in the wizard. */
export function azuriteConnectionString(): string {
  return (
    'DefaultEndpointsProtocol=http;AccountName=devstoreaccount1;' +
    'AccountKey=Eby8vdM02xNOcqFlqUwJPLlmEtlCDXJ1OUzFT50uSRZ6IFsuFq2UVErCz4I6tq/K1SZFPTOtr/KBHBeksoGMGw==;' +
    'BlobEndpoint=http://127.0.0.1:10000/devstoreaccount1;'
  )
}
