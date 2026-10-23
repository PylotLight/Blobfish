import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  MAX_DROPPED_PATHS,
  expandUploadRoots,
  uploadBase,
  validateLocalPaths,
} from "./upload-paths";

let root = "";

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "blobfish-drop-"));
  await writeFile(join(root, "a.txt"), "hello");
  await mkdir(join(root, "photos", "2026", "oct"), { recursive: true });
  await writeFile(join(root, "photos", "cover.png"), "12345678");
  await writeFile(join(root, "photos", "2026", "oct", "x.jpg"), "xx");
  await mkdir(join(root, "empty"));
  await symlink(join(root, "a.txt"), join(root, "photos", "link.txt"));
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("validateLocalPaths", () => {
  test("accepts existing absolute files and folders, deduped", async () => {
    const a = join(root, "a.txt");
    const dir = join(root, "photos");
    expect(await validateLocalPaths([a, dir, a, `${dir}/`])).toEqual([a, dir]);
  });

  test("rejects empty, non-array and non-string payloads", async () => {
    await expect(validateLocalPaths([])).rejects.toThrow("Nothing to upload");
    await expect(validateLocalPaths("x")).rejects.toThrow("Nothing to upload");
    await expect(validateLocalPaths([42])).rejects.toThrow("Invalid file path");
    await expect(validateLocalPaths([""])).rejects.toThrow("Invalid file path");
    await expect(validateLocalPaths([`${root}/a\0.txt`])).rejects.toThrow(
      "Invalid file path",
    );
  });

  test("rejects relative paths", async () => {
    await expect(validateLocalPaths(["a.txt"])).rejects.toThrow(
      "Not an absolute path",
    );
    await expect(validateLocalPaths(["../etc/passwd"])).rejects.toThrow(
      "Not an absolute path",
    );
  });

  test("rejects missing paths", async () => {
    await expect(validateLocalPaths([join(root, "nope.bin")])).rejects.toThrow(
      "File not found",
    );
  });

  test("caps the number of dropped roots", async () => {
    const many = Array.from({ length: MAX_DROPPED_PATHS + 1 }, () =>
      join(root, "a.txt"),
    );
    await expect(validateLocalPaths(many)).rejects.toThrow("Too many items");
  });
});

describe("expandUploadRoots", () => {
  test("a file uploads as its basename with its size", async () => {
    const out = await expandUploadRoots([join(root, "a.txt")]);
    expect(out).toEqual([{ fp: join(root, "a.txt"), rel: "a.txt", size: 5 }]);
  });

  test("a folder recurses, keeps its name + layout, skips symlinks", async () => {
    const out = await expandUploadRoots([join(root, "photos")]);
    const rels = out.map((f) => f.rel).sort();
    expect(rels).toEqual(["photos/2026/oct/x.jpg", "photos/cover.png"]);
    const cover = out.find((f) => f.rel === "photos/cover.png");
    expect(cover?.size).toBe(8);
    expect(cover?.fp).toBe(join(root, "photos", "cover.png"));
  });

  test("mixed files + folders; empty folders add nothing", async () => {
    const out = await expandUploadRoots([
      join(root, "a.txt"),
      join(root, "empty"),
      join(root, "photos", "2026"),
    ]);
    expect(out.map((f) => f.rel).sort()).toEqual(["2026/oct/x.jpg", "a.txt"]);
  });
});

describe("uploadBase", () => {
  test("unscoped accounts use the prefix as-is (trimmed)", () => {
    expect(uploadBase(undefined, undefined)).toBe("");
    expect(uploadBase("", "/logs/2026/")).toBe("logs/2026");
  });

  test("scoped prefix is not doubled when the listing prefix already has it", () => {
    expect(uploadBase("team", "team")).toBe("team");
    expect(uploadBase("team", "team/sub/")).toBe("team/sub");
    expect(uploadBase("/team/", "team/sub")).toBe("team/sub");
  });

  test("scoped prefix is prepended to a relative prefix", () => {
    expect(uploadBase("team", undefined)).toBe("team");
    expect(uploadBase("team", "sub")).toBe("team/sub");
    expect(uploadBase("team", "teamwork")).toBe("team/teamwork");
  });
});
