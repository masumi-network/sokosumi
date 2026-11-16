import { describe, expect, it } from "vitest";
import { seoCsv } from "./seo-csv";

describe("seoCsv", () => {
  it("quotes fields with a comma, a quote or a line break and doubles the quotes", () => {
    expect(
      seoCsv(["query"], [["a,b"], ['say "hi"'], ["two\nlines"], ["cr\rhere"]]),
    ).toBe('query\r\n"a,b"\r\n"say ""hi"""\r\n"two\nlines"\r\n"cr\rhere"\r\n');
  });

  it("uses a semicolon and a decimal comma for German and Spanish Excel", () => {
    const rows = [
      ["a;b", 1.5],
      ["a,b", -2],
      [null, 3],
    ] as const;
    for (const locale of ["de", "es", "de-AT"])
      expect(seoCsv(["query", "value"], rows, locale)).toBe(
        'query;value\r\n"a;b";1,5\r\na,b;-2\r\n;3\r\n',
      );
    expect(seoCsv(["query", "value"], rows, "en")).toBe(
      'query,value\r\na;b,1.5\r\n"a,b",-2\r\n,3\r\n',
    );
  });

  it("neutralises text that a spreadsheet would run as a formula", () => {
    expect(
      seoCsv(
        ["cell"],
        [["=HYPERLINK(1)"], ["+1"], ["-2"], ["@SUM(A1)"], ["\tx"], ["\rx"]],
      ),
    ).toBe(
      "cell\r\n'=HYPERLINK(1)\r\n'+1\r\n'-2\r\n'@SUM(A1)\r\n'\tx\r\n\"'\rx\"\r\n",
    );
  });

  it("neutralises a formula after leading spaces and in fullwidth signs", () => {
    const cells = [
      " =1+1",
      "\u3000+1",
      "\u00A0-1",
      "\uFF1D1+1",
      "\uFF0B1",
      "\uFF0D1",
      "\uFF20A1",
    ];
    expect(
      seoCsv(
        ["cell"],
        cells.map((text) => [text]),
      ),
    ).toBe(`cell\r\n${cells.map((text) => `'${text}`).join("\r\n")}\r\n`);
    // A sign inside the text is no formula.
    expect(seoCsv(["cell"], [["a-b"], ["x = 1"]])).toBe(
      "cell\r\na-b\r\nx = 1\r\n",
    );
  });

  it("keeps numbers, negative ones too, and writes a missing value as an empty cell", () => {
    expect(seoCsv(["a", "b", "c", "d"], [[-3.5, 0, null, Number.NaN]])).toBe(
      "a,b,c,d\r\n-3.5,0,,\r\n",
    );
  });

  it("quotes a neutralised formula that also holds a comma", () => {
    expect(seoCsv(["x"], [['=1,"2"']])).toBe('x\r\n"\'=1,""2"""\r\n');
  });
});
