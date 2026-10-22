/**
 * Storage-account secret (connection string / SAS URL) at-rest handling, on
 * Electron's async safeStorage API.
 *
 * The sync `safeStorage.encryptString/decryptString/isEncryptionAvailable`
 * calls are deprecated in Electron 45 (removed later). The async decryptor
 * reads ciphertext written by the old sync API (same OS-keychain-backed
 * format), so existing `accounts.json` entries stay readable as-is. When it
 * says `shouldReEncrypt` (key rotated / legacy format) we re-seal the secret
 * and persist it, so the next read is on the current format.
 *
 * Kept free of `electron` imports so it's unit-testable under bun.
 * Same shape as Inkfish #55 (peer-keys.ts).
 */

export interface AsyncSafeStorage {
  isAsyncEncryptionAvailable(): Promise<boolean>;
  encryptStringAsync(plainText: string): Promise<Buffer>;
  decryptStringAsync(
    encrypted: Buffer,
  ): Promise<{ shouldReEncrypt: boolean; result: string }>;
}

export const ENCRYPTION_UNAVAILABLE =
  "OS keychain encryption is unavailable (safeStorage). " +
  "On Linux this usually means libsecret / gnome-keyring is missing.";

export async function ensureEncryption(ss: AsyncSafeStorage): Promise<void> {
  if (!(await ss.isAsyncEncryptionAvailable()))
    throw new Error(ENCRYPTION_UNAVAILABLE);
}

/** Encrypt a secret for storage → base64. Throws when there's no keychain (never stores plaintext). */
export async function sealSecret(
  ss: AsyncSafeStorage,
  plain: string,
): Promise<string> {
  await ensureEncryption(ss);
  return (await ss.encryptStringAsync(plain)).toString("base64");
}

/**
 * Decrypt a stored base64 secret. When the decryptor asks for a re-seal,
 * `onReEncrypt(newCiphertext)` is called so the caller can persist it. A failed
 * re-seal is logged and ignored: the old ciphertext still reads fine.
 */
export async function openSecret(
  ss: AsyncSafeStorage,
  encrypted: string,
  onReEncrypt?: (next: string) => void,
): Promise<string> {
  await ensureEncryption(ss);
  const { result, shouldReEncrypt } = await ss.decryptStringAsync(
    Buffer.from(encrypted, "base64"),
  );
  if (shouldReEncrypt && onReEncrypt) {
    try {
      onReEncrypt((await ss.encryptStringAsync(result)).toString("base64"));
    } catch (err) {
      console.warn(
        "[accounts] secret re-encrypt failed",
        err instanceof Error ? err.message : String(err),
      );
    }
  }
  return result;
}

/**
 * Once-per-launch pass: open every stored secret so any flagged for re-sealing
 * are re-encrypted and persisted in one write. Undecryptable entries (keychain
 * reset etc.) are left untouched. Returns how many changed.
 */
export async function migrateSecrets(
  ss: AsyncSafeStorage,
  accounts: Array<{ encryptedSecret: string }>,
  persist: () => void,
): Promise<number> {
  if (!(await ss.isAsyncEncryptionAvailable())) return 0;
  let changed = 0;
  for (const a of accounts) {
    try {
      await openSecret(ss, a.encryptedSecret, (next) => {
        a.encryptedSecret = next;
        changed++;
      });
    } catch {
      // leave as-is; that connection surfaces its own error when opened
    }
  }
  if (changed > 0) persist();
  return changed;
}
