import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";

const names = [
  "friendlyError",
  "listContainers",
  "listBlobs",
  "createContainer",
  "deleteContainer",
  "renameContainer",
  "createFolder",
  "expandFiles",
  "expandBlobNames",
  "deleteNames",
  "renameBlob",
  "copyBlobs",
  "moveBlobs",
  "listBlobVersions",
  "undeleteBlobs",
  "restoreVersion",
  "azuriteConnectionString",
  "blobContainerClientFromSecret",
  "blobServiceFromSecret",
  "dataLakeFileSystemClientFromSecret",
  "dataLakeServiceFromSecret",
  "isConnectionStringSecret",
  "isDfsEndpoint",
  "prewarmAzureSdk",
] as const;

describe("Azure facade", () => {
  test("retains the established runtime exports", () => {
    // transfers.test.ts mocks the facade itself. Inspect the real facade in a
    // fresh runtime so this contract does not depend on test-file execution order.
    const child = spawnSync(
      process.execPath,
      [
        "--eval",
        `
          import { mock } from "bun:test";
          mock.module("./accounts", () => ({ decryptSecret: async () => ({}) }));
          mock.module("./activity", () => ({ logActivity: () => {} }));
          mock.module("./azure-clients", () => ({
            blobContainerClientFromSecret: () => ({}),
            blobServiceFromSecret: () => ({}),
            dataLakeFileSystemClientFromSecret: () => ({}),
            dataLakeServiceFromSecret: () => ({}),
            isConnectionStringSecret: () => false,
            isDfsEndpoint: () => false,
            prewarmAzureSdk: () => {},
          }));
          mock.module("./list-runner", () => ({ runListPage: async () => ({}) }));
          const azure = await import("./azure");
          console.log(JSON.stringify(Object.fromEntries(
            Object.entries(azure).map(([name, value]) => [name, typeof value]),
          )));
        `,
      ],
      { cwd: import.meta.dir, encoding: "utf8" },
    );
    if (child.status !== 0) {
      throw new Error(`Azure facade import failed: ${child.stderr}`);
    }
    const surface = JSON.parse(child.stdout) as Record<string, string>;
    expect(Object.keys(surface).sort()).toEqual([...names].sort());
    for (const name of names) expect(surface[name]).toBe("function");
  });
});
