import { afterEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const launcherSource = readFileSync(
  join(import.meta.dir, "blobfish.mjs"),
  "utf8",
);
const fixtures: string[] = [];

afterEach(() => {
  for (const root of fixtures.splice(0))
    rmSync(root, { recursive: true, force: true });
});

function makeFixture(
  options: { built?: boolean; localElectron?: boolean } = {},
) {
  const root = mkdtempSync(join(tmpdir(), "blobfish-launcher-test-"));
  fixtures.push(root);
  const binDir = join(root, "bin");
  const entry = join(binDir, "blobfish.mjs");
  const capture = join(root, "child-args.json");
  mkdirSync(binDir, { recursive: true });
  writeFileSync(entry, launcherSource);
  writeFileSync(
    join(root, "package.json"),
    JSON.stringify({ devDependencies: { electron: "46.0.0-alpha.2" } }),
  );
  if (options.built !== false) {
    const out = join(root, "out", "main");
    mkdirSync(out, { recursive: true });
    writeFileSync(join(out, "index.js"), "// fixture main entry\n");
  }
  if (options.localElectron) {
    const electron = join(root, "node_modules", "electron");
    mkdirSync(electron, { recursive: true });
    const fakeElectron = join(root, "fake-electron");
    writeFileSync(
      join(electron, "package.json"),
      JSON.stringify({ main: "index.js" }),
    );
    writeFileSync(
      join(electron, "index.js"),
      `module.exports = ${JSON.stringify(fakeElectron)};\n`,
    );
    writeFileSync(
      fakeElectron,
      '#!/bin/sh\nprintf \'%s\\n\' "$@" > "$BLOBFISH_TEST_CAPTURE"\nexit "$BLOBFISH_TEST_EXIT"\n',
    );
    chmodSync(fakeElectron, 0o755);
  }
  return { root, entry, capture };
}

describe("Blobfish package launcher", () => {
  test("explains how to recover when the built app is missing", () => {
    const { entry } = makeFixture({ built: false });
    const result = spawnSync("node", [entry], { encoding: "utf8" });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("built app not found");
    expect(result.stderr).toContain("bun install && bun run build");
  });

  test("uses a locally installed Electron and forwards arguments and its exit status", () => {
    const { root, entry, capture } = makeFixture({ localElectron: true });
    const result = spawnSync("node", [entry, "--open", "reports/2026"], {
      encoding: "utf8",
      env: {
        ...process.env,
        BLOBFISH_TEST_CAPTURE: capture,
        BLOBFISH_TEST_EXIT: "17",
      },
    });
    expect(result.status).toBe(17);
    expect(readFileSync(capture, "utf8").trim().split("\n")).toEqual([
      join(root, "out", "main", "index.js"),
      "--open",
      "reports/2026",
    ]);
  });

  test("falls back to npx with the pinned Electron version and preserves the child status", () => {
    const { root, entry, capture } = makeFixture();
    const fakeBin = join(root, "fake-bin");
    mkdirSync(fakeBin);
    const npx = join(fakeBin, "npx");
    writeFileSync(
      npx,
      '#!/bin/sh\nprintf \'%s\\n\' "$@" > "$BLOBFISH_TEST_CAPTURE"\nexit "$BLOBFISH_TEST_EXIT"\n',
    );
    chmodSync(npx, 0o755);
    const result = spawnSync("node", [entry, "--open", "recent"], {
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${fakeBin}:${process.env.PATH ?? ""}`,
        BLOBFISH_TEST_CAPTURE: capture,
        BLOBFISH_TEST_EXIT: "19",
      },
    });
    expect(result.status).toBe(19);
    expect(readFileSync(capture, "utf8").trim().split("\n")).toEqual([
      "--yes",
      "electron@46.0.0-alpha.2",
      join(root, "out", "main", "index.js"),
      "--open",
      "recent",
    ]);
  });
});
