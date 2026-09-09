import { describe, expect, it } from "vitest";

import {
  selectUnfurlCandidateUrls,
  unfurlCardHasPreviewContent,
} from "./unfurl-urls.js";

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

  it("handles many incomplete <http:// prefixes without hanging", () => {
    const noise = "<http://".repeat(5_000);
    expect(selectUnfurlCandidateUrls(`${noise}<https://ok.example>`)).toEqual([
      "https://ok.example",
    ]);
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

  it("strips trailing punctuation from bare URLs", () => {
    expect(
      selectUnfurlCandidateUrls("Visit https://example.com/path."),
    ).toEqual(["https://example.com/path"]);
  });

  it("strips many trailing punctuation chars without hanging", () => {
    const bangs = "!".repeat(10_000);
    expect(
      selectUnfurlCandidateUrls(`see https://example.com/x${bangs}`),
    ).toEqual(["https://example.com/x"]);
  });
});

describe("unfurlCardHasPreviewContent", () => {
  it("is false for title-only cards", () => {
    expect(
      unfurlCardHasPreviewContent({
        imageUrl: null,
        description: null,
      }),
    ).toBe(false);
    expect(
      unfurlCardHasPreviewContent({
        imageUrl: "  ",
        description: "  ",
      }),
    ).toBe(false);
  });

  it("is true when an image or description is present", () => {
    expect(
      unfurlCardHasPreviewContent({
        imageUrl: "https://cdn.example/i.png",
        description: null,
      }),
    ).toBe(true);
    expect(
      unfurlCardHasPreviewContent({
        imageUrl: null,
        description: "A short summary",
      }),
    ).toBe(true);
  });
});
