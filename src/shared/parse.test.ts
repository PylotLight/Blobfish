import { describe, expect, test } from "bun:test";
import {
  cleanPrefix,
  isConnectionString,
  joinPrefix,
  parseConnectionString,
  parseSasUrl,
  suggestDisplayName,
} from "./parse";

describe("connection strings", () => {
  test("builds account endpoints and respects an explicit BlobEndpoint", () => {
    expect(
      parseConnectionString(
        "DefaultEndpointsProtocol=https;AccountName=photos;AccountKey=abc==;EndpointSuffix=core.example.net",
      ),
    ).toEqual({
      endpoint: "https://photos.blob.core.example.net",
      accountName: "photos",
    });
    expect(
      parseConnectionString(
        "AccountName=local;BlobEndpoint=http://127.0.0.1:10000/local/",
      ),
    ).toEqual({
      endpoint: "http://127.0.0.1:10000/local",
      accountName: "local",
    });
    expect(parseConnectionString("UseDevelopmentStorage=true")).toEqual({
      endpoint: "http://127.0.0.1:10000/devstoreaccount1",
      accountName: "devstoreaccount1",
    });
    expect(isConnectionString("  AccountName=photos;AccountKey=x  ")).toBe(
      true,
    );
  });

  test("rejects an unrecognized secret and gives a useful name fallback", () => {
    expect(() => parseConnectionString("AccountKey=only-the-key")).toThrow(
      /missing AccountName/,
    );
    expect(suggestDisplayName("AccountName=")).toBe("Storage account");
  });
});

describe("SAS URLs and prefixes", () => {
  test("extracts an encoded folder path and expiry from a real-style SAS URL", () => {
    const parsed = parseSasUrl(
      "https://photos.blob.core.windows.net/images/2026%20trip/raw?sv=2025-01-01&se=2026-11-01T00%3A00%3A00Z&sig=signature",
    );
    expect(parsed).toEqual({
      endpoint: "https://photos.blob.core.windows.net",
      containerName: "images",
      prefix: "2026 trip/raw",
      accountName: "photos",
      sasExpiry: "2026-11-01T00:00:00Z",
    });
    expect(
      suggestDisplayName(
        "https://photos.blob.core.windows.net/images/2026%20trip/raw?sv=1&sig=x",
      ),
    ).toBe("photos / images / 2026 trip/raw");
  });

  test("rejects non-storage URLs and normalizes scoped prefixes without double slashes", () => {
    expect(() => parseSasUrl("file:///images?sv=1&sig=x")).toThrow(
      /must start with https/,
    );
    expect(() => parseSasUrl("https://example.test/images")).toThrow(
      /no SAS token query/,
    );
    expect(cleanPrefix(" //team/data/// ")).toBe("team/data");
    expect(cleanPrefix(" /// ")).toBeUndefined();
    expect(joinPrefix("team/data/", "/reports/2026/")).toBe(
      "team/data/reports/2026",
    );
    expect(joinPrefix(undefined, " /reports/ ")).toBe("reports");
  });
});
