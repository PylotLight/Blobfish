import { describe, expect, test } from "bun:test";
import {
  ENCRYPTION_UNAVAILABLE,
  migrateSecrets,
  openSecret,
  sealSecret,
  type AsyncSafeStorage,
} from "./secret-seal";

/** Fake keychain: "v1:"/"v2:" prefixes stand in for key versions; decrypting v1 asks for a re-seal. */
function fake(
  opts: { available?: boolean; failEncrypt?: boolean } = {},
): AsyncSafeStorage & { encrypts: number } {
  const ss = {
    encrypts: 0,
    isAsyncEncryptionAvailable: async () => opts.available ?? true,
    encryptStringAsync: async (plain: string) => {
      if (opts.failEncrypt) throw new Error("keychain locked");
      ss.encrypts++;
      return Buffer.from(`v2:${plain}`);
    },
    decryptStringAsync: async (buf: Buffer) => {
      const s = buf.toString();
      if (!/^v[12]:/.test(s)) throw new Error("bad ciphertext");
      return { result: s.slice(3), shouldReEncrypt: s.startsWith("v1:") };
    },
  };
  return ss;
}
const b64 = (s: string) => Buffer.from(s).toString("base64");

describe("secret-seal (async safeStorage)", () => {
  test("seal then open round-trips", async () => {
    const ss = fake();
    const sealed = await sealSecret(
      ss,
      "DefaultEndpointsProtocol=https;AccountName=a;AccountKey=k",
    );
    expect(await openSecret(ss, sealed)).toBe(
      "DefaultEndpointsProtocol=https;AccountName=a;AccountKey=k",
    );
  });

  test("never stores plaintext when the keychain is unavailable", async () => {
    const ss = fake({ available: false });
    await expect(sealSecret(ss, "secret")).rejects.toThrow(
      ENCRYPTION_UNAVAILABLE,
    );
    await expect(openSecret(ss, b64("v2:secret"))).rejects.toThrow(
      ENCRYPTION_UNAVAILABLE,
    );
  });

  test("legacy (sync-API) ciphertext still opens, and is re-sealed when asked", async () => {
    const ss = fake();
    let next: string | undefined;
    expect(await openSecret(ss, b64("v1:sas"), (n) => (next = n))).toBe("sas");
    expect(next).toBe(b64("v2:sas"));
  });

  test("current ciphertext is not re-sealed", async () => {
    const ss = fake();
    let called = false;
    expect(await openSecret(ss, b64("v2:sas"), () => (called = true))).toBe(
      "sas",
    );
    expect(called).toBe(false);
  });

  test("failed re-seal still returns the secret", async () => {
    const ss = fake({ failEncrypt: true });
    let called = false;
    expect(await openSecret(ss, b64("v1:sas"), () => (called = true))).toBe(
      "sas",
    );
    expect(called).toBe(false);
  });

  test("migrate re-seals only flagged entries, skips broken ones, persists once", async () => {
    const ss = fake();
    const accounts = [
      { id: "a", encryptedSecret: b64("v1:one") },
      { id: "b", encryptedSecret: b64("v2:two") },
      { id: "c", encryptedSecret: b64("garbage") },
    ];
    let persists = 0;
    expect(await migrateSecrets(ss, accounts, () => persists++)).toBe(1);
    expect(persists).toBe(1);
    expect(accounts.map((a) => a.encryptedSecret)).toEqual([
      b64("v2:one"),
      b64("v2:two"),
      b64("garbage"),
    ]);
  });

  test("migrate is a no-op without a keychain", async () => {
    let persists = 0;
    expect(
      await migrateSecrets(
        fake({ available: false }),
        [{ encryptedSecret: b64("v1:x") }],
        () => persists++,
      ),
    ).toBe(0);
    expect(persists).toBe(0);
  });
});
