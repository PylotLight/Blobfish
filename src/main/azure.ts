import { BlobServiceClient } from '@azure/storage-blob'
import { DataLakeServiceClient } from '@azure/storage-file-datalake'
import { decryptSecret } from './accounts'
import type { ListBlobsResult, StorageBlobItem, StorageContainer } from '../shared/types'

function isDfsEndpoint(endpoint: string): boolean {
  return endpoint.includes('.dfs.')
}

function blobServiceFromSecret(profileEndpoint: string, secret: string): BlobServiceClient {
  const s = secret.trim()
  if (s.includes('AccountName=') || s === 'UseDevelopmentStorage=true') {
    return BlobServiceClient.fromConnectionString(s)
  }
  // Full SAS URL (service or container scoped).
  return new BlobServiceClient(s)
}

function dataLakeServiceFromSecret(secret: string): DataLakeServiceClient {
  const s = secret.trim()
  if (s.includes('AccountName=') || s === 'UseDevelopmentStorage=true') {
    return DataLakeServiceClient.fromConnectionString(s)
  }
  return new DataLakeServiceClient(s)
}

/** Friendly wrapper so renderer errors are readable, not SDK soup. */
function friendlyError(err: unknown, fallback: string): Error {
  if (err instanceof Error) {
    const msg = err.message
    if (/403|AuthorizationFailure|not authorized/i.test(msg)) {
      return new Error('Access denied (403). The SAS may lack permissions or has expired.')
    }
    if (/404|ContainerNotFound|FilesystemNotFound/i.test(msg)) {
      return new Error('Container not found (404). Check the container name.')
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

export async function listContainers(accountId: string): Promise<StorageContainer[]> {
  const { profile, secret } = decryptSecret(accountId)
  // Container-scoped attachments cannot enumerate the account — return the
  // attached container as a singleton (verified to exist).
  if (profile.kind !== 'account' && profile.containerName) {
    try {
      if (isDfsEndpoint(profile.endpoint)) {
        const svc = dataLakeServiceFromSecret(secret)
        const fs = svc.getFileSystemClient(profile.containerName)
        await fs.getProperties()
      } else {
        const svc = blobServiceFromSecret(profile.endpoint, secret)
        const container = svc.getContainerClient(profile.containerName)
        await container.getProperties()
      }
    } catch (err) {
      throw friendlyError(err, `Cannot access container "${profile.containerName}"`)
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
    throw friendlyError(err, 'Failed to list containers')
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
      const svc = dataLakeServiceFromSecret(secret)
      const fs = svc.getFileSystemClient(container)
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

    const svc = blobServiceFromSecret(profile.endpoint, secret)
    const client = svc.getContainerClient(container)
    const items: StorageBlobItem[] = []
    const iter = client.listBlobsByHierarchy('/', { prefix: listingPrefix })
    for await (const entry of iter) {
      if (entry.kind === 'prefix') {
        const full = entry.name.replace(/\/$/, '')
        const leaf = effective === '' ? full : full.slice(effective.length + 1) || full
        items.push({ name: full, leaf, isPrefix: true })
      } else {
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
    throw friendlyError(err, `Failed to list blobs in "${container}"`)
  }
}
