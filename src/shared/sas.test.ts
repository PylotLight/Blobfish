import { describe, expect, test } from "bun:test";
import {
  ACCOUNT_SAS_PERMISSIONS,
  ACCOUNT_SAS_RESOURCE_TYPES,
  ACCOUNT_SAS_SERVICES,
  CONTAINER_SAS_PERMISSIONS,
  accountSasUrl,
  containerSasUrl,
  defaultSasWindow,
  flagString,
  fromLocalInput,
  normalizeAccountSas,
  normalizeContainerSas,
  parseIpRange,
  toggleFlag,
  toLocalInput,
  utcOffsetLabel,
  type AccountSasRequest,
  type ContainerSasRequest,
} from "./sas";

const START = "2026-10-22T10:00:00.000Z";
const END = "2026-10-23T10:00:00.000Z";

const acct = (over: Partial<AccountSasRequest> = {}): AccountSasRequest => ({
  accountId: "a",
  startsOn: START,
  expiresOn: END,
  permissions: "rl",
  services: "b",
  resourceTypes: "sco",
  protocol: "https",
  ...over,
});

const ctr = (over: Partial<ContainerSasRequest> = {}): ContainerSasRequest => ({
  accountId: "a",
  container: "photos",
  startsOn: START,
  expiresOn: END,
  permissions: "rl",
  protocol: "https",
  ...over,
});

describe("permission strings", () => {
  test("account permissions follow the SDK's canonical order", () => {
    expect(flagString(ACCOUNT_SAS_PERMISSIONS, "lrwdacup")).toBe("rwdlacup");
    expect(flagString(ACCOUNT_SAS_PERMISSIONS, "yixtf")).toBe("xftiy");
    expect(
      flagString(
        ACCOUNT_SAS_PERMISSIONS,
        ACCOUNT_SAS_PERMISSIONS.map((d) => d.char).reverse(),
      ),
    ).toBe("rwdxftlacupiy");
  });

  test("container permissions follow ContainerSASPermissions order", () => {
    expect(flagString(CONTAINER_SAS_PERMISSIONS, "ldwcar")).toBe("racwdl");
    expect(flagString(CONTAINER_SAS_PERMISSIONS, "fyitlxdwcar")).toBe(
      "racwdxltiyf",
    );
  });

  test("dedupes and drops unknown letters", () => {
    expect(flagString(CONTAINER_SAS_PERMISSIONS, "rrlzq!")).toBe("rl");
    expect(flagString(ACCOUNT_SAS_SERVICES, "fbqtb")).toBe("btqf");
    expect(flagString(ACCOUNT_SAS_RESOURCE_TYPES, ["o", "s"])).toBe("so");
  });

  test("toggle adds and removes while keeping order", () => {
    expect(toggleFlag(CONTAINER_SAS_PERMISSIONS, "rl", "w")).toBe("rwl");
    expect(toggleFlag(CONTAINER_SAS_PERMISSIONS, "rwl", "w")).toBe("rl");
  });
});

describe("dates", () => {
  test("default window is now-15min to now+1day, seconds zeroed", () => {
    const now = new Date(2026, 9, 22, 22, 27, 41, 500);
    const { start, expiry } = defaultSasWindow(now);
    expect(start).toEqual(new Date(2026, 9, 22, 22, 12, 0, 0));
    expect(expiry.getTime() - start.getTime()).toBe(
      24 * 3600_000 + 15 * 60_000,
    );
  });

  test("datetime-local round trip in local time", () => {
    const d = new Date(2026, 0, 5, 7, 9);
    expect(toLocalInput(d)).toBe("2026-01-05T07:09");
    expect(fromLocalInput("2026-01-05T07:09")).toEqual(d);
    expect(fromLocalInput("2026-01-05T07:09:30")).toEqual(
      new Date(2026, 0, 5, 7, 9, 30),
    );
  });

  test("bad datetime-local values are rejected", () => {
    expect(fromLocalInput("")).toBeNull();
    expect(fromLocalInput("2026-02-31T10:00")).toBeNull();
    expect(fromLocalInput("tomorrow")).toBeNull();
  });

  test("utc offset label", () => {
    expect(utcOffsetLabel(new Date())).toMatch(/^UTC[+-]\d{2}:\d{2}$/);
  });
});

describe("ip range", () => {
  test("single, range, empty", () => {
    expect(parseIpRange("")).toBeUndefined();
    expect(parseIpRange(" 10.0.0.1 ")).toEqual({ start: "10.0.0.1" });
    expect(parseIpRange("10.0.0.1-10.0.0.9")).toEqual({
      start: "10.0.0.1",
      end: "10.0.0.9",
    });
    expect(parseIpRange("10.0.0.1-10.0.0.1")).toEqual({ start: "10.0.0.1" });
  });

  test("rejects junk and backwards ranges", () => {
    expect(() => parseIpRange("10.0.0.256")).toThrow();
    expect(() => parseIpRange("10.0.0.9-10.0.0.1")).toThrow(/before/);
    expect(() => parseIpRange("1.2.3.4-5.6.7.8-9.9.9.9")).toThrow();
    expect(() => parseIpRange("::1")).toThrow();
  });
});

describe("normalizeAccountSas", () => {
  test("canonicalizes flags, protocol and dates", () => {
    const n = normalizeAccountSas(
      acct({ permissions: "lr", services: "fb", resourceTypes: "os" }),
    );
    expect(n.permissions).toBe("rl");
    expect(n.services).toBe("bf");
    expect(n.resourceTypes).toBe("so");
    expect(n.protocol).toBe("https");
    expect(n.startsOn?.toISOString()).toBe(START);
    expect(n.expiresOn.toISOString()).toBe(END);
    expect(n.ipRange).toBeUndefined();
  });

  test("protocol choices", () => {
    expect(normalizeAccountSas(acct({ protocol: "https,http" })).protocol).toBe(
      "https,http",
    );
    expect(() =>
      normalizeAccountSas(acct({ protocol: "http" as "https" })),
    ).toThrow(/protocol/);
  });

  test("start is optional", () => {
    expect(
      normalizeAccountSas(acct({ startsOn: undefined })).startsOn,
    ).toBeUndefined();
  });

  test("rejects bad input", () => {
    expect(() => normalizeAccountSas(acct({ expiresOn: "" }))).toThrow(
      /expiry/,
    );
    expect(() => normalizeAccountSas(acct({ expiresOn: START }))).toThrow(
      /after/,
    );
    expect(() => normalizeAccountSas(acct({ permissions: "" }))).toThrow(
      /permission/,
    );
    expect(() => normalizeAccountSas(acct({ services: "z" }))).toThrow(
      /service/,
    );
    expect(() => normalizeAccountSas(acct({ resourceTypes: "" }))).toThrow(
      /resource/,
    );
    expect(() => normalizeAccountSas(acct({ ipRange: "nope" }))).toThrow(/IP/);
  });
});

describe("normalizeContainerSas", () => {
  test("plain container SAS", () => {
    const n = normalizeContainerSas(ctr({ permissions: "lwr" }));
    expect(n).toMatchObject({
      container: "photos",
      permissions: "rwl",
      protocol: "https",
    });
    expect(n.identifier).toBeUndefined();
  });

  test("policy-defined fields are left out of the SAS", () => {
    const n = normalizeContainerSas(ctr({ identifier: "readers" }), {
      expiresOn: END,
      permissions: "rl",
    });
    expect(n.identifier).toBe("readers");
    expect(n.permissions).toBeUndefined();
    expect(n.expiresOn).toBeUndefined();
    // the policy doesn't set a start, so the form's start still goes in
    expect(n.startsOn?.toISOString()).toBe(START);
  });

  test("fields the policy leaves open still come from the form", () => {
    const n = normalizeContainerSas(
      ctr({ identifier: "p", permissions: "r" }),
      { startsOn: START },
    );
    expect(n.startsOn).toBeUndefined();
    expect(n.expiresOn?.toISOString()).toBe(END);
    expect(n.permissions).toBe("r");
    expect(() =>
      normalizeContainerSas(ctr({ identifier: "p", permissions: "" }), {
        startsOn: START,
      }),
    ).toThrow(/permission/);
  });

  test("missing policy, missing expiry, inverted window", () => {
    expect(() =>
      normalizeContainerSas(ctr({ identifier: "gone" }), undefined),
    ).toThrow(/no longer exists/);
    expect(() => normalizeContainerSas(ctr({ expiresOn: undefined }))).toThrow(
      /expiry/,
    );
    expect(() =>
      normalizeContainerSas(ctr({ startsOn: END, expiresOn: START })),
    ).toThrow(/after/);
    // a form expiry before the policy's start is still caught
    expect(() =>
      normalizeContainerSas(
        ctr({ identifier: "p", startsOn: undefined, expiresOn: START }),
        { startsOn: END, permissions: "r" },
      ),
    ).toThrow(/after/);
    expect(() => normalizeContainerSas(ctr({ container: " " }))).toThrow();
  });
});

describe("urls", () => {
  test("account SAS URL is the service root", () => {
    expect(
      accountSasUrl("https://acct.blob.core.windows.net/", "sv=1&sig=x"),
    ).toBe("https://acct.blob.core.windows.net/?sv=1&sig=x");
  });

  test("container SAS URL, Azurite path kept", () => {
    expect(
      containerSasUrl("https://acct.blob.core.windows.net", "photos", "sv=1"),
    ).toBe("https://acct.blob.core.windows.net/photos?sv=1");
    expect(
      containerSasUrl("http://127.0.0.1:10000/devstoreaccount1", "c1", "sv=1"),
    ).toBe("http://127.0.0.1:10000/devstoreaccount1/c1?sv=1");
  });
});
