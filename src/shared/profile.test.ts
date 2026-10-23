import { describe, expect, test } from "bun:test";
import { resolveProfileName, usesDefaultUserData } from "./profile";

describe("resolveProfileName", () => {
  test("release keeps the default profile", () => {
    expect(
      resolveProfileName({ appName: "Blobfish", isPackaged: true }),
    ).toBeNull();
  });
  test("dev runs get their own profile", () => {
    expect(resolveProfileName({ appName: "Blobfish", isPackaged: false })).toBe(
      "Blobfish Dev",
    );
  });
  test("BLOBFISH_PROFILE picks a sanitized named profile", () => {
    expect(
      resolveProfileName({
        appName: "Blobfish",
        isPackaged: false,
        profileEnv: " two/../x ",
      }),
    ).toBe("Blobfish two..x");
    expect(
      resolveProfileName({
        appName: "Blobfish",
        isPackaged: true,
        profileEnv: "qa",
      }),
    ).toBe("Blobfish qa");
  });
  test("blank override falls back", () => {
    expect(
      resolveProfileName({
        appName: "Blobfish",
        isPackaged: true,
        profileEnv: "  ",
      }),
    ).toBeNull();
  });
});

test("only the default userData location is moved", () => {
  expect(
    usesDefaultUserData("/a/Application Support", "/a/Application Support"),
  ).toBe(true);
  expect(usesDefaultUserData("/tmp/custom", "/a/Application Support")).toBe(
    false,
  );
});
