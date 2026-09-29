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
  it("treats a blank line as a separator, not a one-field row", () => {
    // Editors and exporters routinely end a file with a blank line. Emitting
    // `[""]` for it failed the whole import on differing column counts.
    expect(parseTableCsv("A,B\n1,2\n\n")).toEqual([
      ["A", "B"],
      ["1", "2"],
    ]);
    expect(parseTableCsv("A,B\r\n1,2\r\n\r\n")).toEqual([
      ["A", "B"],
      ["1", "2"],
    ]);
    expect(parseTableCsv("A,B\n1,2\n\n3,4\n")).toEqual([
      ["A", "B"],
      ["1", "2"],
      ["3", "4"],
    ]);
    // A single-column file used to gain a spurious empty data row.
    expect(parseTableCsv("A\n1\n\n")).toEqual([["A"], ["1"]]);
  });
  it("keeps a quoted empty field as a real row", () => {
    expect(parseTableCsv('A\n""\n')).toEqual([["A"], [""]]);
    expect(parseTableCsv('A,B\n"",2\n')).toEqual([
      ["A", "B"],
      ["", "2"],
    ]);
  });
});
