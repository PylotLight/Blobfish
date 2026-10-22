import { describe, expect, test } from "bun:test";
import { signAccountSas, signContainerSas } from "./sas-sign";
import { DEV_ACCOUNT_KEY, DEV_ACCOUNT_NAME } from "./shared-key";
import { normalizeAccountSas, normalizeContainerSas } from "../shared/sas";

const key = { accountName: DEV_ACCOUNT_NAME, accountKey: DEV_ACCOUNT_KEY };
const START = "2026-10-22T10:00:00.000Z";
const END = "2026-10-23T10:00:00.000Z";

describe("signAccountSas (real SDK)", () => {
  test("query carries the canonical fields", () => {
    const q = new URLSearchParams(
      signAccountSas(
        key,
        normalizeAccountSas({
          accountId: "x",
          startsOn: START,
          expiresOn: END,
          permissions: "lwr",
          services: "b",
          resourceTypes: "oc",
          protocol: "https",
          ipRange: "10.0.0.1-10.0.0.9",
        }),
      ),
    );
    expect(q.get("sp")).toBe("rwl");
    expect(q.get("ss")).toBe("b");
    expect(q.get("srt")).toBe("co");
    expect(q.get("spr")).toBe("https");
    expect(q.get("st")).toBe("2026-10-22T10:00:00Z");
    expect(q.get("se")).toBe("2026-10-23T10:00:00Z");
    expect(q.get("sip")).toBe("10.0.0.1-10.0.0.9");
    expect(q.get("sv")).toBeTruthy();
    expect(q.get("sig")).toBeTruthy();
  });

  test("https+http protocol, no start", () => {
    const q = new URLSearchParams(
      signAccountSas(
        key,
        normalizeAccountSas({
          accountId: "x",
          expiresOn: END,
          permissions: "r",
          services: "b",
          resourceTypes: "s",
          protocol: "https,http",
        }),
      ),
    );
    expect(q.get("spr")).toBe("https,http");
    expect(q.get("st")).toBeNull();
  });
});

describe("signContainerSas (real SDK)", () => {
  test("container SAS fields, deterministic signature per key", () => {
    const n = normalizeContainerSas({
      accountId: "x",
      container: "photos",
      startsOn: START,
      expiresOn: END,
      permissions: "ldr",
      protocol: "https",
    });
    const q = new URLSearchParams(signContainerSas(key, n));
    expect(q.get("sr")).toBe("c");
    expect(q.get("sp")).toBe("rdl");
    expect(q.get("spr")).toBe("https");
    expect(q.get("si")).toBeNull();
    const again = new URLSearchParams(signContainerSas(key, n));
    expect(again.get("sig")).toBe(q.get("sig"));
    const other = new URLSearchParams(
      signContainerSas(
        { ...key, accountKey: Buffer.from("another key").toString("base64") },
        n,
      ),
    );
    expect(other.get("sig")).not.toBe(q.get("sig"));
  });

  test("bound to a stored policy: si set, policy fields absent", () => {
    const n = normalizeContainerSas(
      {
        accountId: "x",
        container: "photos",
        startsOn: START,
        expiresOn: END,
        permissions: "r",
        identifier: "readers",
        protocol: "https",
      },
      { expiresOn: END, permissions: "rl" },
    );
    const q = new URLSearchParams(signContainerSas(key, n));
    expect(q.get("si")).toBe("readers");
    expect(q.get("sp")).toBeNull();
    expect(q.get("se")).toBeNull();
    expect(q.get("st")).toBe("2026-10-22T10:00:00Z");
  });
});
