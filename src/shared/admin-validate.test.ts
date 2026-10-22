import { describe, expect, test } from "bun:test";
import {
  MAX_POLICIES,
  validateCors,
  validatePolicies,
  validateSoftDelete,
} from "./admin-validate";

describe("validatePolicies", () => {
  test("trims ids, canonicalizes permissions and dates", () => {
    expect(
      validatePolicies([
        {
          id: " readers ",
          startsOn: "2026-10-22T10:00:00Z",
          expiresOn: "2026-10-29T10:00:00Z",
          permissions: "lr",
        },
      ]),
    ).toEqual([
      {
        id: "readers",
        startsOn: "2026-10-22T10:00:00.000Z",
        expiresOn: "2026-10-29T10:00:00.000Z",
        permissions: "rl",
      },
    ]);
  });

  test("limits and duplicates", () => {
    const many = Array.from({ length: MAX_POLICIES + 1 }, (_, i) => ({
      id: `p${i}`,
    }));
    expect(() => validatePolicies(many)).toThrow(/at most/);
    expect(() => validatePolicies([{ id: "a" }, { id: "a" }])).toThrow(
      /Duplicate/,
    );
    expect(() => validatePolicies([{ id: "" }])).toThrow(/ID/);
    expect(() =>
      validatePolicies([
        {
          id: "a",
          startsOn: "2026-10-29T00:00:00Z",
          expiresOn: "2026-10-22T00:00:00Z",
        },
      ]),
    ).toThrow(/before/);
  });
});

describe("validateCors", () => {
  const ok = {
    allowedOrigins: "*",
    allowedMethods: "GET",
    allowedHeaders: "",
    exposedHeaders: "",
    maxAgeInSeconds: 0,
  };

  test("normalizes lists and methods", () => {
    expect(
      validateCors([
        {
          allowedOrigins: " https://a.com , https://b.com ",
          allowedMethods: "get, put",
          allowedHeaders: "*",
          exposedHeaders: "",
          maxAgeInSeconds: 60.7,
        },
      ]),
    ).toEqual([
      {
        allowedOrigins: "https://a.com,https://b.com",
        allowedMethods: "GET,PUT",
        allowedHeaders: "*",
        exposedHeaders: "",
        maxAgeInSeconds: 60,
      },
    ]);
  });

  test("rejects bad rules", () => {
    expect(() => validateCors([{ ...ok, allowedOrigins: " " }])).toThrow(
      /origin/,
    );
    expect(() => validateCors([{ ...ok, allowedMethods: "" }])).toThrow(
      /method/,
    );
    expect(() => validateCors([{ ...ok, allowedMethods: "FETCH" }])).toThrow(
      /unknown/,
    );
    expect(() => validateCors([{ ...ok, maxAgeInSeconds: -1 }])).toThrow(
      /max age/,
    );
    expect(() => validateCors(Array(6).fill(ok))).toThrow(/at most 5/);
    expect(validateCors([])).toEqual([]);
  });
});

describe("validateSoftDelete", () => {
  test("off drops days, on needs 1-365", () => {
    expect(validateSoftDelete({ enabled: false, days: 900 })).toEqual({
      enabled: false,
    });
    expect(validateSoftDelete({ enabled: true, days: 7 })).toEqual({
      enabled: true,
      days: 7,
    });
    expect(() => validateSoftDelete({ enabled: true, days: 0 })).toThrow();
    expect(() => validateSoftDelete({ enabled: true, days: 366 })).toThrow();
  });
});
