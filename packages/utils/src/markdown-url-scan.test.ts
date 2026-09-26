import { describe, expect, it } from "vitest";

import {
  collectMarkdownUrlExcludedRanges,
  findBareHttpUrlHits,
  findHttpAutolinks,
} from "./markdown-url-scan.js";

describe("findHttpAutolinks", () => {
  it("finds a valid autolink after nested unclosed prefixes", () => {
    expect(
      findHttpAutolinks("<http://<http://<https://example.com/file.pdf>"),
    ).toEqual([
      {
        url: "https://example.com/file.pdf",
        start: 16,
        end: 46,
      },
    ]);
  });

  it("matches mixed-case schemes", () => {
    expect(findHttpAutolinks("<HtTpS://example.com>")).toEqual([
      { url: "HtTpS://example.com", start: 0, end: 21 },
    ]);
  });
});

describe("findBareHttpUrlHits", () => {
  it("strips trailing punctuation and matches mixed-case schemes", () => {
    expect(findBareHttpUrlHits("see HTTPS://example.com/x.")).toEqual([
      { url: "HTTPS://example.com/x", start: 4, end: 26 },
    ]);
  });

  it("skips markdown and autolink ranges when provided", () => {
    const markdown =
      "[x](https://example.com/a.pdf) <https://example.com/b.pdf> https://example.com/c.pdf";
    const ranges = collectMarkdownUrlExcludedRanges(markdown);
    expect(findBareHttpUrlHits(markdown, ranges).map((hit) => hit.url)).toEqual(
      ["https://example.com/c.pdf"],
    );
  });
});
