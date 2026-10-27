import { describe, expect, test } from "bun:test";
import { serializeTsvRow } from "./preview.ts";

describe("serializeTsvRow", () => {
  test("joins ordinary cells with tabs", () => {
    expect(serializeTsvRow(["north", "42", "ready"])).toBe("north\t42\tready");
  });

  test("quotes tabs, line breaks, and embedded quotes without data loss", () => {
    expect(
      serializeTsvRow(["north\twest", "line one\nline two", 'say "hi"']),
    ).toBe('"north\twest"\t"line one\nline two"\t"say ""hi"""');
  });
});
