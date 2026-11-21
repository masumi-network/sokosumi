import { describe, expect, it } from "vitest";

import { gscPropertyCovers } from "./native-gsc-property";
import {
  normalizeGscTaskInspection,
  unavailableGscTaskInspection,
} from "./native-gsc-task-inspection";

const pageUrl = "https://example.test/a";

describe("Task-bound URL Inspection normalization", () => {
  it("retains Google's noindex and fetch causes without accepting raw provider fields", () => {
    const result = normalizeGscTaskInspection(pageUrl, {
      access_token: "never retained",
      inspectionResult: {
        inspectionResultLink: "https://search.google.com/private",
        indexStatusResult: {
          verdict: "NEUTRAL",
          coverageState: "Excluded by noindex",
          indexingState: "BLOCKED_BY_META_TAG",
          pageFetchState: "SUCCESSFUL",
          googleCanonical: "https://example.test/a",
          secret: "never retained",
        },
      },
    });
    expect(result).toEqual({
      ...unavailableGscTaskInspection(pageUrl),
      verdict: "NEUTRAL",
      coverageState: "Excluded by noindex",
      indexingState: "BLOCKED_BY_META_TAG",
      pageFetchState: "SUCCESSFUL",
      googleCanonical: pageUrl,
    });
  });

  it("does not turn missing, invalid, or oversized inspection data into an indexed page", () => {
    for (const indexStatusResult of [
      {},
      { verdict: "PASS", indexingState: 1 },
      { verdict: "FAIL", pageFetchState: "a".repeat(101) },
      { verdict: "PASS", lastCrawlTime: "not a time" },
    ])
      expect(() =>
        normalizeGscTaskInspection(pageUrl, {
          inspectionResult: { indexStatusResult },
        }),
      ).toThrow();
    expect(unavailableGscTaskInspection(pageUrl).verdict).toBe(
      "VERDICT_UNSPECIFIED",
    );
    expect(unavailableGscTaskInspection(pageUrl).lastCrawlTime).toBeNull();
  });

  it("requires one property to cover all primary and related pages", () => {
    expect(
      gscPropertyCovers("sc-domain:example.test", [
        pageUrl,
        "https://www.example.test/b",
      ]),
    ).toBe(true);
    expect(
      gscPropertyCovers("sc-domain:example.test", [
        pageUrl,
        "https://notexample.test/b",
      ]),
    ).toBe(false);
    expect(
      gscPropertyCovers("https://example.test/a", [
        pageUrl,
        "https://example.test/b",
      ]),
    ).toBe(false);
    expect(
      gscPropertyCovers("https://example.test/", [
        pageUrl,
        "http://example.test/b",
      ]),
    ).toBe(false);
  });

  it("does not forward credentials embedded in a provider canonical URL", () => {
    const result = normalizeGscTaskInspection(pageUrl, {
      inspectionResult: {
        indexStatusResult: {
          verdict: "PASS",
          googleCanonical: "https://user:secret@example.test/a",
          userCanonical: "https://user@example.test/a",
        },
      },
    });
    expect(result.googleCanonical).toBeNull();
    expect(result.userCanonical).toBeNull();
  });
});
