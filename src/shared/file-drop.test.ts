import { describe, expect, test } from "bun:test";
import { dropTargetLabel, isFileDrag } from "./file-drop";

describe("isFileDrag", () => {
  test("detects external file drags", () => {
    expect(isFileDrag(["Files"])).toBe(true);
    expect(isFileDrag(["text/uri-list", "Files"])).toBe(true);
  });
  test("ignores text / element drags and empty input", () => {
    expect(isFileDrag(["text/plain"])).toBe(false);
    expect(isFileDrag([])).toBe(false);
    expect(isFileDrag(null)).toBe(false);
    expect(isFileDrag(undefined)).toBe(false);
  });
});

describe("dropTargetLabel", () => {
  test("container root vs folder", () => {
    expect(dropTargetLabel("logs", "")).toBe("logs");
    expect(dropTargetLabel("logs", undefined)).toBe("logs");
    expect(dropTargetLabel("logs", "2026/10/")).toBe("logs/2026/10");
  });
});
