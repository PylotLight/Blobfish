import { describe, expect, test } from "bun:test";
import {
  connectionKey,
  decryptBackup,
  encryptBackup,
  validEntry,
  type BackupPayload,
} from "./backup";

const conn = {
  name: "Prod",
  kind: "account" as const,
  endpoint: "https://prod.blob.core.windows.net",
  authType: "connection-string" as const,
  accountName: "prod",
  createdAt: 1,
  pinned: true,
  secret:
    "DefaultEndpointsProtocol=https;AccountName=prod;AccountKey=abc==;EndpointSuffix=core.windows.net",
};
const payload: BackupPayload = {
  app: "blobfish",
  appVersion: "0.2.5",
  exportedAt: 2,
  connections: [conn],
};

describe("connections backup", () => {
  test("round-trips with the right passphrase", async () => {
    const text = await encryptBackup(payload, "correct horse");
    expect(await decryptBackup(text, "correct horse")).toEqual(payload);
  });

  test("no names, endpoints or secrets in the clear", async () => {
    const text = await encryptBackup(payload, "correct horse");
    for (const s of ["Prod", "prod.blob", "AccountKey", "abc=="])
      expect(text.includes(s)).toBe(false);
  });

  test("wrong passphrase and tampering both fail cleanly", async () => {
    const text = await encryptBackup(payload, "correct horse");
    await expect(decryptBackup(text, "wrong horse!")).rejects.toThrow(
      /Wrong passphrase/,
    );
    const f = JSON.parse(text);
    f.data = Buffer.from(
      "x" + Buffer.from(f.data, "base64").toString("latin1"),
    ).toString("base64");
    await expect(
      decryptBackup(JSON.stringify(f), "correct horse"),
    ).rejects.toThrow(/Wrong passphrase|damaged/);
  });

  test("rejects short passphrases and non-backup files", async () => {
    await expect(encryptBackup(payload, "short")).rejects.toThrow(/at least 8/);
    await expect(
      decryptBackup('{"accounts":[]}', "correct horse"),
    ).rejects.toThrow(/isn't a Blobfish backup/);
    await expect(decryptBackup("not json", "correct horse")).rejects.toThrow(
      /isn't a Blobfish backup/,
    );
  });

  test("refuses absurd kdf params instead of hanging", async () => {
    const f = JSON.parse(await encryptBackup(payload, "correct horse"));
    f.kdf.N = 1 << 30;
    await expect(
      decryptBackup(JSON.stringify(f), "correct horse"),
    ).rejects.toThrow(/damaged/);
  });

  test("connectionKey ignores name and endpoint case, keeps prefix + secret", () => {
    expect(
      connectionKey(
        { ...conn, endpoint: conn.endpoint.toUpperCase() },
        conn.secret,
      ),
    ).toBe(connectionKey(conn, conn.secret));
    expect(connectionKey({ ...conn, prefix: "a" }, conn.secret)).not.toBe(
      connectionKey(conn, conn.secret),
    );
    expect(connectionKey(conn, conn.secret + "x")).not.toBe(
      connectionKey(conn, conn.secret),
    );
  });

  test("validEntry drops junk", () => {
    expect(validEntry(conn)).toBe(true);
    expect(validEntry({ ...conn, secret: " " })).toBe(false);
    expect(validEntry({ ...conn, endpoint: "file:///etc" })).toBe(false);
    expect(validEntry({ ...conn, kind: "blob-container" })).toBe(false);
    expect(
      validEntry({ ...conn, kind: "blob-container", containerName: "c" }),
    ).toBe(true);
    expect(validEntry(null)).toBe(false);
  });
});
