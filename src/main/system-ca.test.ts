import { describe, expect, test } from "bun:test";
import {
  mergeCaLists,
  trustSystemCertificates,
  type TlsCaApi,
} from "./system-ca";

const A = "-----BEGIN CERTIFICATE-----\nAAA\n-----END CERTIFICATE-----";
const B = "-----BEGIN CERTIFICATE-----\nBBB\n-----END CERTIFICATE-----";
const CORP = "-----BEGIN CERTIFICATE-----\nCORP\n-----END CERTIFICATE-----";

function fakeTls(system: string[] | Error, defaults = [A, B]) {
  let set: string[] | null = null;
  const api: TlsCaApi = {
    getCACertificates: (type) => {
      if (type === "system") {
        if (system instanceof Error) throw system;
        return system;
      }
      return defaults;
    },
    setDefaultCACertificates: (certs) => {
      set = certs;
    },
  };
  return {
    api,
    get set() {
      return set;
    },
  };
}

describe("mergeCaLists", () => {
  test("keeps defaults first and adds only new system roots", () => {
    const crlf = CORP.replace(/\n/g, "\r\n");
    expect(mergeCaLists([A, B], [B, crlf, CORP, ""])).toEqual({
      merged: [A, B, crlf],
      added: 1,
    });
  });
});

describe("trustSystemCertificates", () => {
  test("merges a corporate root from the OS store into the defaults", () => {
    const t = fakeTls([A, CORP]);
    expect(trustSystemCertificates(t.api)).toEqual({
      applied: true,
      added: 1,
      total: 3,
    });
    expect(t.set).toEqual([A, B, CORP]);
  });

  test("no-op when the system store adds nothing", () => {
    const t = fakeTls([A]);
    expect(trustSystemCertificates(t.api)).toMatchObject({ applied: false });
    expect(t.set).toBeNull();
  });

  test("no-op on runtimes without the API (never disables verification)", () => {
    expect(trustSystemCertificates({})).toEqual({
      applied: false,
      reason: "runtime has no system CA support",
    });
  });

  test("a throwing store read is reported, not fatal", () => {
    const t = fakeTls(new Error("keychain locked"));
    expect(trustSystemCertificates(t.api)).toEqual({
      applied: false,
      reason: "keychain locked",
    });
    expect(t.set).toBeNull();
  });

  test("empty system store is a no-op", () => {
    const t = fakeTls([]);
    expect(trustSystemCertificates(t.api)).toMatchObject({ applied: false });
  });
});
