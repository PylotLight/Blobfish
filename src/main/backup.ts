import { createCipheriv, createDecipheriv, randomBytes, scrypt as scryptCb, type ScryptOptions } from 'node:crypto'
import type { AuthType, StorageKind } from '../shared/types'

/**
 * Connections backup file (`.blobfish-backup`). Secrets are decrypted out of the OS keychain
 * and re-sealed under a passphrase the user picks, so a backup restores on another Mac (or
 * after a keychain reset) where safeStorage ciphertext would be useless.
 *
 * scrypt (N=2^15, r=8, p=1) -> AES-256-GCM. Only the format header is plaintext; names,
 * endpoints and secrets are all inside the ciphertext.
 */

export const BACKUP_FORMAT = 'blobfish-backup'
export const BACKUP_EXT = 'blobfish-backup'
export const MIN_PASSPHRASE = 8

export interface BackupEntry {
  name: string
  kind: StorageKind
  endpoint: string
  containerName?: string
  prefix?: string
  authType: AuthType
  accountName?: string
  createdAt: number
  sasExpiry?: string | null
  pinned?: boolean
  secret: string
}

export interface BackupPayload {
  app: 'blobfish'
  appVersion: string
  exportedAt: number
  connections: BackupEntry[]
}

interface BackupFile {
  format: typeof BACKUP_FORMAT
  version: 1
  kdf: { name: 'scrypt'; N: number; r: number; p: number; salt: string }
  cipher: 'aes-256-gcm'
  iv: string
  tag: string
  data: string
}

export class BackupError extends Error {}

const KDF = { N: 1 << 15, r: 8, p: 1 }

function deriveKey(pass: string, salt: Buffer, k: { N: number; r: number; p: number }): Promise<Buffer> {
  const opts: ScryptOptions = { N: k.N, r: k.r, p: k.p, maxmem: 256 * k.N * k.r }
  return new Promise((resolve, reject) =>
    scryptCb(pass.normalize('NFKC'), salt, 32, opts, (err, key) => (err ? reject(err) : resolve(key)))
  )
}

export async function encryptBackup(payload: BackupPayload, passphrase: string): Promise<string> {
  if (passphrase.length < MIN_PASSPHRASE) {
    throw new BackupError(`Passphrase must be at least ${MIN_PASSPHRASE} characters.`)
  }
  const salt = randomBytes(16)
  const iv = randomBytes(12)
  const key = await deriveKey(passphrase, salt, KDF)
  const c = createCipheriv('aes-256-gcm', key, iv)
  c.setAAD(Buffer.from(`${BACKUP_FORMAT}:1`))
  const data = Buffer.concat([c.update(JSON.stringify(payload), 'utf8'), c.final()])
  const file: BackupFile = {
    format: BACKUP_FORMAT,
    version: 1,
    kdf: { name: 'scrypt', ...KDF, salt: salt.toString('base64') },
    cipher: 'aes-256-gcm',
    iv: iv.toString('base64'),
    tag: c.getAuthTag().toString('base64'),
    data: data.toString('base64')
  }
  return JSON.stringify(file, null, 2)
}

export async function decryptBackup(text: string, passphrase: string): Promise<BackupPayload> {
  let file: BackupFile
  try {
    file = JSON.parse(text) as BackupFile
  } catch {
    throw new BackupError("That file isn't a Blobfish backup.")
  }
  if (file?.format !== BACKUP_FORMAT) throw new BackupError("That file isn't a Blobfish backup.")
  if (file.version !== 1 || file.cipher !== 'aes-256-gcm' || file.kdf?.name !== 'scrypt') {
    throw new BackupError('This backup was made by a newer Blobfish. Update and try again.')
  }
  const { N, r, p } = file.kdf
  if (![N, r, p].every((n) => Number.isInteger(n) && n > 0) || N > 1 << 20 || r > 32 || p > 16) {
    throw new BackupError('Backup file is damaged (bad key settings).')
  }
  const key = await deriveKey(passphrase, Buffer.from(file.kdf.salt, 'base64'), { N, r, p })
  let plain: string
  try {
    const d = createDecipheriv('aes-256-gcm', key, Buffer.from(file.iv, 'base64'))
    d.setAAD(Buffer.from(`${BACKUP_FORMAT}:1`))
    d.setAuthTag(Buffer.from(file.tag, 'base64'))
    plain = Buffer.concat([d.update(Buffer.from(file.data, 'base64')), d.final()]).toString('utf8')
  } catch {
    throw new BackupError('Wrong passphrase, or the backup file is damaged.')
  }
  const payload = JSON.parse(plain) as BackupPayload
  if (!Array.isArray(payload?.connections)) throw new BackupError('Backup file is damaged (no connections).')
  return payload
}

/** Same connection = same kind, endpoint, container, prefix and secret. Names don't count. */
export function connectionKey(e: Pick<BackupEntry, 'kind' | 'endpoint' | 'containerName' | 'prefix'>, secret: string): string {
  return [e.kind, e.endpoint.toLowerCase(), (e.containerName ?? '').toLowerCase(), e.prefix ?? '', secret.trim()].join('\u0000')
}

const KINDS: StorageKind[] = ['account', 'blob-container', 'adls-container']

/** Drop entries a hand-edited or truncated file could smuggle in. */
export function validEntry(e: unknown): e is BackupEntry {
  if (!e || typeof e !== 'object') return false
  const x = e as Record<string, unknown>
  return (
    typeof x.name === 'string' &&
    typeof x.secret === 'string' &&
    x.secret.trim() !== '' &&
    typeof x.endpoint === 'string' &&
    /^https?:\/\//i.test(x.endpoint) &&
    KINDS.includes(x.kind as StorageKind) &&
    (x.authType === 'sas' || x.authType === 'connection-string') &&
    (x.kind === 'account' || (typeof x.containerName === 'string' && x.containerName !== ''))
  )
}
