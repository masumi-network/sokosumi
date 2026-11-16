import { describe, expect, it } from "vitest";
import { seoOtherCanonical } from "./seo-index-status";

const page = {
  pageUrl: "https://example.com/a",
  verdict: "PASS" as const,
  coverageState: null,
  robotsTxtState: null,
  lastCrawlTime: null,
  googleCanonical: null,
  userCanonical: null,
};

describe("seoOtherCanonical", () => {
  it("names Google's canonical only when it differs from the one the page asks for", () => {
    const other = "https://example.com/b";
    expect(seoOtherCanonical(page)).toBeNull();
    expect(
      seoOtherCanonical({ ...page, googleCanonical: page.pageUrl }),
    ).toBeNull();
    // The page's own canonical tag points elsewhere and Google agrees.
    expect(
      seoOtherCanonical({
        ...page,
        googleCanonical: other,
        userCanonical: other,
      }),
    ).toBeNull();
    expect(seoOtherCanonical({ ...page, googleCanonical: other })).toBe(other);
  });
});
