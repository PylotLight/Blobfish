import { app, safeStorage } from 'electron'
import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type {
  AccountCreateInput,
  AccountSummary,
  AccountUpdateInput,
  AuthType,
  StorageKind
} from '../shared/types'
import {
  cleanPrefix,
  isConnectionString,
  joinPrefix,
  parseConnectionString,
  parseSasUrl,
  suggestDisplayName
} from '../shared/parse'
import { ensureEncryption as ensureAsyncEncryption, migrateSecrets, openSecret, sealSecret } from './secret-seal'

export { isConnectionString, parseConnectionString, parseSasUrl }

interface StoredAccount extends AccountSummary {
  encryptedSecret: string
}

interface AccountsFile {
  version: 1
  accounts: StoredAccount[]
}

const FILE_NAME = 'accounts.json'

function accountsPath(): string {
  return join(app.getPath('userData'), FILE_NAME)
}

function readFile(): AccountsFile {
  const p = accountsPath()
  if (!existsSync(p)) return { version: 1, accounts: [] }
  try {
    const raw = readFileSync(p, 'utf8')
    const parsed = JSON.parse(raw) as AccountsFile
    if (!Array.isArray(parsed.accounts)) return { version: 1, accounts: [] }
    return { version: 1, accounts: parsed.accounts }
  } catch {
    return { version: 1, accounts: [] }
  }
}

function writeFile(data: AccountsFile): void {
  mkdirSync(app.getPath('userData'), { recursive: true })
  writeFileSync(accountsPath(), JSON.stringify(data, null, 2), 'utf8')
}

// Electron 45: async safeStorage only (the sync calls are deprecated). See secret-seal.ts.
function ensureEncryption(): Promise<void> {
  return ensureAsyncEncryption(safeStorage)
}

/** Persist a re-sealed secret onto a fresh read, only if the entry still holds the old ciphertext. */
function persistReseal(id: string, prev: string, next: string): void {
  const data = readFile()
  const entry = data.accounts.find((a) => a.id === id)
  if (!entry || entry.encryptedSecret !== prev) return
  entry.encryptedSecret = next
  writeFile(data)
}

function stripSecret(stored: StoredAccount): AccountSummary {
  const { encryptedSecret: _drop, ...summary } = stored
  return summary
}

/* ---------- store ---------- */

export function listAccounts(): AccountSummary[] {
  return readFile().accounts.map(stripSecret)
}

export function getStoredAccount(id: string): StoredAccount {
  const found = readFile().accounts.find((a) => a.id === id)
  if (!found) throw new Error('Storage account not found.')
  return found
}

/** Decrypt the connection secret for an account. Main-process only. */
export async function decryptSecret(id: string): Promise<{ profile: AccountSummary; secret: string }> {
  const stored = getStoredAccount(id)
  const prev = stored.encryptedSecret
  const secret = await openSecret(safeStorage, prev, (next) => persistReseal(id, prev, next))
  return { profile: stripSecret(stored), secret }
}

let migrated = false
/**
 * Once per launch (after app ready): re-seal any stored secrets the async
 * decryptor flags for re-encryption. Existing sync-API ciphertext reads fine
 * either way, so this is housekeeping, never a blocker.
 */
export function migrateAccountSecrets(): void {
  if (migrated) return
  migrated = true
  const data = readFile()
  if (data.accounts.length === 0) return
  const before = new Map(data.accounts.map((a) => [a.id, a.encryptedSecret]))
  void migrateSecrets(safeStorage, data.accounts, () => {
    // Merge onto a fresh read so anything added/removed meanwhile isn't clobbered.
    const fresh = readFile()
    for (const a of fresh.accounts) {
      const next = data.accounts.find((x) => x.id === a.id)?.encryptedSecret
      if (next !== undefined && a.encryptedSecret === before.get(a.id)) a.encryptedSecret = next
    }
    writeFile(fresh)
  }).catch((err: unknown) => {
    console.warn('[accounts] secret migration failed', err instanceof Error ? err.message : String(err))
  })
}

export async function addAccount(input: AccountCreateInput): Promise<AccountSummary> {
  await ensureEncryption()
  const kind: StorageKind = input.kind
  const secret = input.secret.trim()
  if (secret === '') throw new Error('Connection string or SAS URL is required.')

  let endpoint: string
  let accountName: string | undefined
  let authType: AuthType
  let containerName: string | undefined
  let prefix: string | undefined
  let sasExpiry: string | null | undefined

  if (isConnectionString(secret)) {
    authType = 'connection-string'
    const parsed = parseConnectionString(secret)
    endpoint = parsed.endpoint
    accountName = parsed.accountName
    containerName = input.containerName?.trim() || undefined
    prefix = cleanPrefix(input.prefix)
    if (kind !== 'account' && !containerName) {
      throw new Error('Container name is required when attaching with a connection string.')
    }
  } else {
    authType = 'sas'
    const parsed = parseSasUrl(secret)
    endpoint = parsed.endpoint
    accountName = parsed.accountName
    sasExpiry = parsed.sasExpiry
    // Explicit fields win; otherwise derive container/prefix from the URL path.
    containerName = input.containerName?.trim() || parsed.containerName
    prefix = joinPrefix(parsed.prefix, input.prefix) ?? cleanPrefix(input.prefix)
    if (kind !== 'account' && !containerName) {
      throw new Error('That SAS URL has no container path. Attach as account/service instead, or add a container name.')
    }
  }

  // Normalise dfs vs blob host per kind (informational; azure.ts picks the SDK).
  if (kind === 'adls-container' && endpoint.includes('.blob.')) {
    endpoint = endpoint.replace('.blob.', '.dfs.')
  }

  const stored: StoredAccount = {
    id: randomUUID(),
    // Empty name → derive from the secret (AccountName=…, SAS host/container).
    name: input.name.trim() || suggestDisplayName(secret, containerName, prefix) || 'Storage',
    kind,
    endpoint,
    containerName,
    prefix,
    authType,
    accountName,
    createdAt: Date.now(),
    sasExpiry: sasExpiry ?? null,
    pinned: false,
    encryptedSecret: await sealSecret(safeStorage, secret)
  }
  const data = readFile()
  data.accounts.push(stored)
  writeFile(data)
  return stripSecret(stored)
}

export function removeAccount(id: string): boolean {
  const data = readFile()
  const next = data.accounts.filter((a) => a.id !== id)
  if (next.length === data.accounts.length) return false
  writeFile({ version: 1, accounts: next })
  return true
}

export function updateAccount(id: string, patch: AccountUpdateInput): AccountSummary {
  const data = readFile()
  const idx = data.accounts.findIndex((a) => a.id === id)
  if (idx === -1) throw new Error('Storage account not found.')
  const current = data.accounts[idx]!
  if (patch.name !== undefined) {
    const name = patch.name.trim()
    if (name === '') throw new Error('Display name cannot be empty.')
    current.name = name
  }
  if (patch.prefix !== undefined) {
    current.prefix = cleanPrefix(patch.prefix)
  }
  writeFile(data)
  return stripSecret(current)
}

export function setPinned(id: string, pinned: boolean): AccountSummary {
  const data = readFile()
  const idx = data.accounts.findIndex((a) => a.id === id)
  if (idx === -1) throw new Error('Storage account not found.')
  data.accounts[idx]!.pinned = pinned
  writeFile(data)
  return stripSecret(data.accounts[idx]!)
}

/**
 * Pin a single container from a full storage-account connection as its own
 * Quick Access entry. Reuses the source secret so no credential re-entry is
 * needed. Idempotent — returns the existing attachment when one already
 * covers the same endpoint + container.
 */
export async function pinContainerAttachment(sourceId: string, containerRaw: string): Promise<AccountSummary> {
  await ensureEncryption()
  const container = containerRaw.trim()
  if (container === '') throw new Error('Container name is required.')
  const { profile, secret } = await decryptSecret(sourceId)
  const data = readFile()
  const existing = data.accounts.find(
    (a) => a.endpoint === profile.endpoint && (a.containerName ?? '').toLowerCase() === container.toLowerCase()
  )
  if (existing) {
    existing.pinned = true
    writeFile(data)
    return stripSecret(existing)
  }
  const kind: StorageKind = profile.endpoint.includes('.dfs.') ? 'adls-container' : 'blob-container'
  const stored: StoredAccount = {
    id: randomUUID(),
    name: `${profile.name} / ${container}`,
    kind,
    endpoint: profile.endpoint,
    containerName: container,
    prefix: undefined,
    authType: profile.authType,
    accountName: profile.accountName,
    createdAt: Date.now(),
    sasExpiry: profile.sasExpiry ?? null,
    pinned: true,
    encryptedSecret: await sealSecret(safeStorage, secret)
  }
  data.accounts.push(stored)
  writeFile(data)
  return stripSecret(stored)
}

export function encryptionAvailable(): Promise<boolean> {
  return safeStorage.isAsyncEncryptionAvailable()
}
