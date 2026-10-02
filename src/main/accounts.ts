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
  parseSasUrl
} from '../shared/parse'

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

function ensureEncryption(): void {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error(
      'OS keychain encryption is unavailable (safeStorage). ' +
        'On Linux this usually means libsecret / gnome-keyring is missing.'
    )
  }
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
export function decryptSecret(id: string): { profile: AccountSummary; secret: string } {
  ensureEncryption()
  const stored = getStoredAccount(id)
  const secret = safeStorage.decryptString(Buffer.from(stored.encryptedSecret, 'base64'))
  return { profile: stripSecret(stored), secret }
}

export function addAccount(input: AccountCreateInput): AccountSummary {
  ensureEncryption()
  const name = input.name.trim()
  if (name === '') throw new Error('Display name is required.')
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
    name,
    kind,
    endpoint,
    containerName,
    prefix,
    authType,
    accountName,
    createdAt: Date.now(),
    sasExpiry: sasExpiry ?? null,
    encryptedSecret: safeStorage.encryptString(secret).toString('base64')
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

export function encryptionAvailable(): boolean {
  return safeStorage.isEncryptionAvailable()
}
