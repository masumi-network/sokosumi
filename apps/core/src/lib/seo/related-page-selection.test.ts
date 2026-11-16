import { describe, expect, it } from "vitest";
import {
  assertSeoArtifactMatchesRequest,
  parsePublicSeoArtifact,
} from "@/helpers/project-seo-report";
import { legacyReport, siteStrategyReport } from "@/test-fixtures/project-seo";

import {
  originalSeoAuditPacket,
  selectSeoRelatedPages,
  seoPageComparisonKey,
} from "./related-page-selection";

const seed = "https://example.test/start";

describe("related-page trust boundary", () => {
  it("matches the worker's escaped URL keys without merging reserved path separators", () => {
    expect(seoPageComparisonKey("https://example.test/%70age")).toBe(
      seoPageComparisonKey("https://example.test/page"),
    );
    expect(seoPageComparisonKey("https://example.test/caf%c3%a9")).toBe(
      seoPageComparisonKey("https://example.test/caf%C3%A9"),
    );
    expect(seoPageComparisonKey("https://example.test/a%2fb")).not.toBe(
      seoPageComparisonKey("https://example.test/a/b"),
    );
    expect(
      selectSeoRelatedPages(
        ["https://example.test/%70age"],
        ["https://example.test/page", "https://example.test/other"],
      ),
    ).toEqual(["https://example.test/%70age", "https://example.test/other"]);
    expect(() =>
      selectSeoRelatedPages(
        ["https://example.test/page", "https://example.test/%70age"],
        [],
      ),
    ).toThrow("distinct");
  });
  it("keeps seeds first, strips fragments, deduplicates and retains ten pages at most", () => {
    const related = Array.from(
      { length: 9 },
      (_, index) => `https://example.test/page-${index}`,
    );
    expect(
      selectSeoRelatedPages(
        [seed],
        [related[0]!, `${related[0]}#part`, ...related.slice(1)],
      ),
    ).toEqual([seed, ...related]);
    expect(() =>
      selectSeoRelatedPages([seed], [...related, "https://example.test/extra"]),
    ).toThrow("at most ten");
    expect(() => selectSeoRelatedPages([seed, `${seed}#part`], [])).toThrow(
      "distinct",
    );
  });
  it.each([
    "https://other.test/page",
    "https://www.example.test/page",
    "https://example.test:8443/page",
    "https://user:secret@example.test/page",
    "https://example.test/account",
    "https://example.test/en/checkout",
    "https://example.test/file.pdf",
    "https://example.test/%61ccount",
    "https://example.test/a/dashboard",
    "https://example.test/auth",
    "https://example.test/settings",
    "https://example.test/a?tracking=1",
    "https://example.test/file%2Epdf",
    "https://example.test/?route=check%6fut",
    "https://example.test/?route=checkout%2Fcart",
  ])("rejects an out-of-scope or private candidate: %s", (candidate) => {
    expect(() => selectSeoRelatedPages([seed], [candidate])).toThrow();
  });
  it("rejects localhost and IP audit scopes before discovery", () => {
    expect(() =>
      selectSeoRelatedPages(["https://127.0.0.1/start"], []),
    ).toThrow("public host");
    expect(() =>
      selectSeoRelatedPages(["https://localhost/start"], []),
    ).toThrow("public host");
  });
  it("restores the original packet for price and Task input checks without widening its selection", () => {
    const original = {
      version: 1,
      discoverRelated: true,
      pageUrls: [seed],
      price: { kind: "fixed", credits: 750 },
    };
    const selected = [seed, "https://example.test/related"];
    const request = {
      ...original,
      pageUrls: selected,
      relatedPageSelection: {
        version: 1,
        seedPageUrls: [seed],
        pageUrls: selected,
      },
    };
    expect(originalSeoAuditPacket(request)).toEqual(original);
    expect(originalSeoAuditPacket(original)).toEqual(original);
    expect(() =>
      originalSeoAuditPacket({ ...request, pageUrls: [seed] }),
    ).toThrow("invalid");
    expect(() =>
      originalSeoAuditPacket({ ...request, discoverRelated: false }),
    ).toThrow("invalid");
  });
  it("imports discovered pages only after the exact page selection is frozen", () => {
    const selected = selectSeoRelatedPages(
      [seed],
      ["https://example.test/related"],
    );
    const raw = {
      ...siteStrategyReport(),
      pages: selected.map((url) => ({
        ...legacyReport(),
        request: { ...legacyReport().request, url },
      })),
    };
    const payload = parsePublicSeoArtifact(raw);
    const expected = {
      id: "audit-id",
      kind: "audit_full",
      request: { pageUrls: selected, countryCode: "US", languageCode: "en" },
    };
    expect(() =>
      assertSeoArtifactMatchesRequest(raw, payload, expected),
    ).not.toThrow();
    expect(() =>
      assertSeoArtifactMatchesRequest(raw, payload, {
        ...expected,
        request: { ...expected.request, pageUrls: [seed] },
      }),
    ).toThrow("frozen page scope");
    expect(() =>
      assertSeoArtifactMatchesRequest(
        raw,
        {
          ...payload,
          pageUrls: [...selected, "https://example.test/not-selected"],
        },
        expected,
      ),
    ).toThrow("frozen page scope");
  });
});
