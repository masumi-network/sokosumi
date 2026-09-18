import { describe, expect, it } from "vitest";
import { encodeTableCsv, parseTableCsv } from "./table-csv";

describe("table CSV", () => {
  it("reads BOM, CRLF, escaped quotes and embedded newlines", () =>
    expect(
      parseTableCsv('\uFEFFName,Notes\r\n"A, B","Said ""yes""\nNext line"\r\n'),
    ).toEqual([
      ["Name", "Notes"],
      ["A, B", 'Said "yes"\nNext line'],
    ]));
  it("rejects malformed CSV rather than silently dropping values", () => {
    for (const csv of [
      "Name,\nA,B",
      'Name\n"unclosed',
      'Name\n"a"oops',
      "A,B\n1",
    ])
      expect(() => parseTableCsv(csv)).toThrow();
  });
  it("preserves empty fields and neutralizes spreadsheet formulas", () => {
    expect(parseTableCsv("A,B\n,")).toEqual([
      ["A", "B"],
      ["", ""],
    ]);
    expect(encodeTableCsv([['=HYPERLINK("x")', null]])).toBe(
      '"\'=HYPERLINK(""x"")",""',
    );
  });
  it("preserves numeric negatives while escaping string formulas", () => {
    expect(
      parseTableCsv(
        encodeTableCsv([
          ["Price", "Text"],
          [-42, "-SUM(A1)"],
        ]),
      )[1],
    ).toEqual(["-42", "'-SUM(A1)"]);
  });
});
