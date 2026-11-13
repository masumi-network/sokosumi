import { describe, expect, it } from "vitest";
import { seoCsv } from "./seo-csv";

describe("seoCsv", () => {
  it("quotes fields with a comma, a quote or a line break and doubles the quotes", () => {
    expect(
      seoCsv(["query"], [["a,b"], ['say "hi"'], ["two\nlines"], ["cr\rhere"]]),
    ).toBe('query\r\n"a,b"\r\n"say ""hi"""\r\n"two\nlines"\r\n"cr\rhere"\r\n');
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

  it("keeps numbers, negative ones too, and writes a missing value as an empty cell", () => {
    expect(seoCsv(["a", "b", "c", "d"], [[-3.5, 0, null, Number.NaN]])).toBe(
      "a,b,c,d\r\n-3.5,0,,\r\n",
    );
  });

  it("quotes a neutralised formula that also holds a comma", () => {
    expect(seoCsv(["x"], [['=1,"2"']])).toBe('x\r\n"\'=1,""2"""\r\n');
  });
});
