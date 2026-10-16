/* Azure client construction, free of electron imports so the listing worker
 * (list-worker.ts) can build the same clients the main process does. */
import type * as BlobSdk from '@azure/storage-blob'
import type { BlobServiceClient, ContainerClient } from '@azure/storage-blob'
import type * as DataLakeSdk from '@azure/storage-file-datalake'
import type { DataLakeFileSystemClient, DataLakeServiceClient } from '@azure/storage-file-datalake'
import { createRequire } from 'node:module'

/* The Azure SDKs cost ~120-160 ms of synchronous module loading, which used to
 * sit in front of app ready on every launch. They load on first use instead
 * (or from prewarmAzureSdk() once the window has painted). */
const requireSdk = createRequire(import.meta.url)
let blobSdk: typeof BlobSdk | null = null
let dataLakeSdk: typeof DataLakeSdk | null = null

export function blobApi(): typeof BlobSdk {
  return (blobSdk ??= requireSdk('@azure/storage-blob') as typeof BlobSdk)
}

export function dataLakeApi(): typeof DataLakeSdk {
  return (dataLakeSdk ??= requireSdk('@azure/storage-file-datalake') as typeof DataLakeSdk)
}

/** Load the SDKs off the startup path so the first listing doesn't pay for them. */
export function prewarmAzureSdk(): void {
  try {
    blobApi()
    dataLakeApi()
  } catch {
    // A broken install surfaces on first real use with a proper error.
  }
}

export function isDfsEndpoint(endpoint: string): boolean {
  return endpoint.includes('.dfs.')
}

export function isConnectionStringSecret(secret: string): boolean {
  const s = secret.trim()
  return s.includes('AccountName=') || s === 'UseDevelopmentStorage=true'
}

export function blobServiceFromSecret(_profileEndpoint: string, secret: string): BlobServiceClient {
  if (isConnectionStringSecret(secret)) {
    return blobApi().BlobServiceClient.fromConnectionString(secret.trim())
  }
  // Full SAS URL (service or container scoped).
  return new (blobApi().BlobServiceClient)(secret.trim())
}

export function dataLakeServiceFromSecret(secret: string): DataLakeServiceClient {
  if (isConnectionStringSecret(secret)) {
    return dataLakeApi().DataLakeServiceClient.fromConnectionString(secret.trim())
  }
  return new (dataLakeApi().DataLakeServiceClient)(secret.trim())
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
    return blobApi().BlobServiceClient.fromConnectionString(secret.trim()).getContainerClient(container)
  }
  const trimmed = secret.trim()
  const sasContainer = sasContainerName(trimmed)
  if (!sasContainer) {
    // Service-scoped SAS — derive the container from it.
    return new (blobApi().BlobServiceClient)(trimmed).getContainerClient(container)
  }
  return new (blobApi().ContainerClient)(containerUrlFromSas(trimmed, container))
}

export function dataLakeFileSystemClientFromSecret(
  secret: string,
  container: string
): DataLakeFileSystemClient {
  if (isConnectionStringSecret(secret)) {
    return dataLakeApi().DataLakeServiceClient.fromConnectionString(secret.trim()).getFileSystemClient(container)
  }
  const trimmed = secret.trim()
  const sasContainer = sasContainerName(trimmed)
  if (!sasContainer) {
    return new (dataLakeApi().DataLakeServiceClient)(trimmed).getFileSystemClient(container)
  }
  return new (dataLakeApi().DataLakeFileSystemClient)(containerUrlFromSas(trimmed, container))
}
