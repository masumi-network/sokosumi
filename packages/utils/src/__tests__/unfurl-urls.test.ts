import { describe, expect, it } from "vitest";

import {
  extractBareHttpUrls,
  selectUnfurlCandidateUrls,
} from "../unfurl-urls.js";

describe("extractBareHttpUrls", () => {
  it("finds bare http(s) URLs in prose", () => {
    expect(
      extractBareHttpUrls("see https://example.com/a and http://foo.test/b"),
    ).toEqual(["https://example.com/a", "http://foo.test/b"]);
  });

  it("strips trailing punctuation", () => {
    expect(extractBareHttpUrls("Visit https://example.com/path.")).toEqual([
      "https://example.com/path",
    ]);
  });

  it("strips many trailing punctuation chars without hanging", () => {
    const bangs = "!".repeat(10_000);
    expect(
      extractBareHttpUrls(`see https://example.com/x${bangs}`),
    ).toEqual(["https://example.com/x"]);
  });

  it("dedupes identical bare URLs", () => {
    expect(
      extractBareHttpUrls("https://example.com https://example.com"),
    ).toEqual(["https://example.com"]);
  });
});

describe("selectUnfurlCandidateUrls", () => {
  it("collects markdown links, autolinks, and bare URLs in first-appearance order", () => {
    expect(
      selectUnfurlCandidateUrls(
        "bare https://a.example first [md](https://b.example) then <https://c.example>",
      ),
    ).toEqual(["https://a.example", "https://b.example", "https://c.example"]);
  });

  it("excludes file-like URLs", () => {
    expect(
      selectUnfurlCandidateUrls(
        "https://cdn.example/doc.pdf and https://example.com/page",
      ),
    ).toEqual(["https://example.com/page"]);
  });

  it("caps at 3 unique URLs", () => {
    expect(
      selectUnfurlCandidateUrls(
        "https://1.example https://2.example https://3.example https://4.example",
      ),
    ).toEqual(["https://1.example", "https://2.example", "https://3.example"]);
  });

  it("dedupes across markdown and bare forms", () => {
    expect(
      selectUnfurlCandidateUrls(
        "[x](https://example.com/x) https://example.com/x https://other.example",
      ),
    ).toEqual(["https://example.com/x", "https://other.example"]);
  });

  it("returns empty when only file-like or no urls", () => {
    expect(selectUnfurlCandidateUrls("no links here")).toEqual([]);
    expect(selectUnfurlCandidateUrls("https://cdn.example/shot.png")).toEqual(
      [],
    );
  });
});
