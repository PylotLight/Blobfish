import { describe, expect, test } from "bun:test";
import { cleanMenu, type MenuEntry } from "./ContextMenu";

const item = (label: string): MenuEntry => ({ label, onSelect: () => {} });

describe("cleanMenu", () => {
  test("hidden items never leave stray separators", () => {
    const out = cleanMenu([
      "sep",
      item("Open"),
      false,
      "sep",
      null,
      "sep",
      item("Copy"),
      "sep",
      undefined,
      "sep",
    ]);
    expect(out.map((x) => (x === "sep" ? "-" : x.label))).toEqual([
      "Open",
      "-",
      "Copy",
    ]);
  });
});
