import { describe, expect, it } from "vitest";

import {
  gscInspectionArguments,
  normalizeGscInspection,
} from "./native-gsc-inspection";

const page = "https://example.test/a";

describe("normalizeGscInspection", () => {
  it("keeps Google's verdict and words and leaves omitted fields null", () => {
    expect(
      normalizeGscInspection(page, {
        inspectionResult: {
          inspectionResultLink: "https://search.google.com/x",
          indexStatusResult: {
            verdict: "FAIL",
            coverageState: "Crawled - currently not indexed",
            lastCrawlTime: "2026-10-30T08:15:00Z",
            googleCanonical: "https://example.test/b",
          },
        },
      }),
    ).toEqual({
      pageUrl: page,
      verdict: "FAIL",
      coverageState: "Crawled - currently not indexed",
      robotsTxtState: null,
      lastCrawlTime: "2026-10-30T08:15:00Z",
      googleCanonical: "https://example.test/b",
      userCanonical: null,
    });
  });

  it("refuses an answer without an index result or with an unknown verdict", () => {
    expect(() =>
      normalizeGscInspection(page, { inspectionResult: {} }),
    ).toThrow();
    expect(() =>
      normalizeGscInspection(page, {
        inspectionResult: { indexStatusResult: { verdict: "MAYBE" } },
      }),
    ).toThrow();
  });

  it("keeps a canonical only when it is an http(s) address", () => {
    const answer = (googleCanonical: string) =>
      normalizeGscInspection(page, {
        inspectionResult: {
          indexStatusResult: { verdict: "PASS", googleCanonical },
        },
      }).googleCanonical;
    expect(answer("javascript:alert(1)")).toBeNull();
    expect(answer(`https://example.test/${"a".repeat(2100)}`)).toBeNull();
    expect(answer("https://example.test/b")).toBe("https://example.test/b");
  });

  it("asks about one page under the property", () => {
    expect(gscInspectionArguments("sc-domain:example.test", page)).toEqual({
      site_url: "sc-domain:example.test",
      inspection_url: page,
    });
  });
});
