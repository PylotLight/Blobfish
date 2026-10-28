import { describe, expect, test } from "bun:test";
import {
  detectDelimiter,
  displayableCsvRows,
  looksBinary,
  looksTexty,
  parseCsv,
  serializeTsvRow,
  sliceTextChunk,
  suggestFlavor,
} from "./preview.ts";

describe("CSV and TSV preview", () => {
  test("detects semicolons without counting delimiters inside quoted fields", () => {
    expect(
      detectDelimiter(["name;description;count", '"north;west";"a, b";2']),
    ).toBe(";");
  });

  test("preserves quoted delimiters, escaped quotes, embedded newlines, and ragged rows", () => {
    const parsed = parseCsv(
      'name,note,count\r\n"Harbor, east","She said ""go""\nnow",2\r\nshort,7\r\n',
      ",",
    );
    expect(parsed).toEqual({
      rows: [
        ["name", "note", "count"],
        ["Harbor, east", 'She said "go"\nnow', "2"],
        ["short", "7"],
      ],
      complete: true,
    });
    expect(displayableCsvRows(parsed, true)).toEqual({
      rows: parsed.rows,
      pending: false,
    });
  });

  test("holds an unfinished final row until the next preview page arrives", () => {
    const partial = parseCsv('id,name\n1,ready\n2,"in prog', ",");
    expect(partial.complete).toBe(false);
    expect(displayableCsvRows(partial, false)).toEqual({
      rows: [
        ["id", "name"],
        ["1", "ready"],
      ],
      pending: true,
    });
    const complete = parseCsv('id,name\n1,ready\n2,"in progress"', ",");
    expect(displayableCsvRows(complete, true).rows.at(-1)).toEqual([
      "2",
      "in progress",
    ]);
  });

  test("quotes tabs, line breaks, and embedded quotes without data loss", () => {
    expect(
      serializeTsvRow(["north\twest", "line one\nline two", 'say "hi"']),
    ).toBe('"north\twest"\t"line one\nline two"\t"say ""hi"""');
  });

  test("joins ordinary cells with tabs", () => {
    expect(serializeTsvRow(["north", "42", "ready"])).toBe("north\t42\tready");
  });
});

describe("text preview paging", () => {
  test("defers a split UTF-8 character and rejoins the long line losslessly", () => {
    const content = `${"x".repeat(20)}€tail\nlast`;
    const bytes = Buffer.from(content, "utf8");
    const euroOffset = Buffer.byteLength("x".repeat(20));
    const first = sliceTextChunk(
      bytes.subarray(0, euroOffset + 2),
      bytes.length,
      0,
      300,
    );
    const second = sliceTextChunk(
      bytes.subarray(first.nextOffset),
      bytes.length,
      first.nextOffset,
      300,
    );
    expect(first).toMatchObject({
      text: "x".repeat(20),
      nextOffset: euroOffset,
      eof: false,
      cutMidLine: true,
    });
    expect(first.text + second.text).toBe(content);
    expect(second.eof).toBe(true);
  });

  test("distinguishes text, CSV, and binary content for the preview", () => {
    expect(
      suggestFlavor("folder/records.CSV", "application/octet-stream"),
    ).toBe("csv");
    expect(looksTexty("unknown.dat", "application/json")).toBe(true);
    expect(looksBinary(Uint8Array.from([65, 0, 66]))).toBe(true);
    expect(looksBinary(Uint8Array.from([65, 10, 66]))).toBe(false);
  });
});
