import { describe, expect, test } from "bun:test";
import type { BlobItem, BlobPrefix } from "@azure/storage-blob";
import type { Path } from "@azure/storage-file-datalake";
import {
  clampPageSize,
  mapDfsPaths,
  mapHierarchySegment,
  MAX_LIST_PAGE,
} from "./list-page";

const props = (n: number) => ({
  contentLength: n,
  lastModified: new Date("2026-10-01T10:00:00Z"),
  contentType: "text/plain",
});

describe("mapHierarchySegment", () => {
  test("folders first, leaves relative to the folder, marker blobs become folders", () => {
    const blobPrefixes = [{ name: "logs/2026/" }] as BlobPrefix[];
    const blobItems = [
      { name: "logs/", properties: props(0) },
      { name: "logs/b.txt", properties: props(5) },
      { name: "logs/a.txt", properties: props(3), deleted: true },
      { name: "logs/empty/", properties: props(0) },
    ] as unknown as BlobItem[];
    const rows = mapHierarchySegment({ blobPrefixes, blobItems }, "logs");
    expect(rows.map((r) => [r.leaf, r.isPrefix])).toEqual([
      ["2026", true],
      ["empty", true],
      ["a.txt", false],
      ["b.txt", false],
    ]);
    const a = rows.find((r) => r.leaf === "a.txt")!;
    expect(a).toMatchObject({
      name: "logs/a.txt",
      size: 3,
      deleted: true,
      lastModified: "2026-10-01T10:00:00.000Z",
    });
    expect(rows.find((r) => r.leaf === "b.txt")!.deleted).toBeUndefined();
  });

  test("container root", () => {
    const rows = mapHierarchySegment(
      {
        blobItems: [
          { name: "x.json", properties: props(1) },
        ] as unknown as BlobItem[],
      },
      "",
    );
    expect(rows[0]).toMatchObject({
      name: "x.json",
      leaf: "x.json",
      isPrefix: false,
    });
  });
});

describe("mapDfsPaths", () => {
  test("direct children only, directories flagged", () => {
    const paths = [
      { name: "data/raw", isDirectory: true },
      { name: "data/file.csv", contentLength: 9 },
    ] as Path[];
    const rows = mapDfsPaths(paths, "data");
    expect(rows.map((r) => [r.leaf, r.isPrefix])).toEqual([
      ["raw", true],
      ["file.csv", false],
    ]);
  });
});

test("page size is clamped to the Azure max", () => {
  expect(clampPageSize(undefined)).toBe(MAX_LIST_PAGE);
  expect(clampPageSize(50_000)).toBe(5000);
  expect(clampPageSize(0)).toBe(MAX_LIST_PAGE);
  expect(clampPageSize(250)).toBe(250);
});
