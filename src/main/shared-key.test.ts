import { describe, expect, test } from "bun:test";
import {
  DEV_ACCOUNT_KEY,
  NO_KEY_REASON,
  SAS_ONLY_REASON,
  blobHostSecret,
  sasUnavailableReason,
  sharedKeyFromSecret,
} from "./shared-key";

const KEY = "abc+def/ghi==";

describe("sharedKeyFromSecret", () => {
  test("account key connection string (key keeps its = padding)", () => {
    expect(
      sharedKeyFromSecret(
        `DefaultEndpointsProtocol=https;AccountName=acct;AccountKey=${KEY};EndpointSuffix=core.windows.net`,
      ),
    ).toEqual({ accountName: "acct", accountKey: KEY });
  });

  test("keys are case-insensitive", () => {
    expect(sharedKeyFromSecret(`accountname=acct;accountkey=${KEY}`)).toEqual({
      accountName: "acct",
      accountKey: KEY,
    });
  });

  test("Azurite shorthand", () => {
    expect(sharedKeyFromSecret("UseDevelopmentStorage=true")).toEqual({
      accountName: "devstoreaccount1",
      accountKey: DEV_ACCOUNT_KEY,
    });
  });

  test("SAS URLs and SAS connection strings can't sign", () => {
    const sasUrl = "https://acct.blob.core.windows.net/?sv=2024&sig=abc%3D";
    expect(sharedKeyFromSecret(sasUrl)).toBeNull();
    expect(sasUnavailableReason(sasUrl)).toBe(SAS_ONLY_REASON);
    const sasCs =
      "BlobEndpoint=https://acct.blob.core.windows.net/;SharedAccessSignature=sv=2024&sig=x";
    expect(sharedKeyFromSecret(sasCs)).toBeNull();
    expect(sasUnavailableReason(sasCs)).toBe(NO_KEY_REASON);
    expect(
      sasUnavailableReason(`AccountName=a;AccountKey=${KEY}`),
    ).toBeUndefined();
  });
});

describe("blobHostSecret", () => {
  test("dfs SAS urls point at the blob host, others untouched", () => {
    expect(
      blobHostSecret("https://a.dfs.core.windows.net/fs?sv=1&sig=x%3D"),
    ).toBe("https://a.blob.core.windows.net/fs?sv=1&sig=x%3D");
    const blob = "https://a.blob.core.windows.net/c?sv=1&sig=x%3D";
    expect(blobHostSecret(blob)).toBe(blob);
    const cs = `AccountName=a;AccountKey=${KEY}`;
    expect(blobHostSecret(cs)).toBe(cs);
  });
});
