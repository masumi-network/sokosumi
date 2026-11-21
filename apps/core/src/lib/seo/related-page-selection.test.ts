import { describe, expect, it } from "vitest";
import {
  assertSeoArtifactMatchesRequest,
  parsePublicSeoArtifact,
} from "@/helpers/project-seo-report";
import { seoAuditInspectionPages } from "@/services/seo-audit-related-pages";
import { legacyReport } from "@/test-fixtures/project-seo";

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
  it("keeps the private www alias on save and replay only under frozen domain access", () => {
    const access = {
      propertyId: "sc-domain:example.test",
      connectionVersion: "a".repeat(64),
    };
    const alias = "https://www.example.test/guide";
    for (const [first, next] of [
      [seed, alias],
      [alias, seed],
    ] as const) {
      const packet = { inspectRelated: true, pageUrls: [first] };
      const saved = {
        ...packet,
        searchConsoleAccess: access,
        relatedIndexingSelection: {
          version: 1,
          seedPageUrls: [first],
          relatedPageUrls: [next],
        },
      };
      expect(selectSeoRelatedPages([first], [next], access)).toEqual([
        first,
        next,
      ]);
      expect(originalSeoAuditPacket(saved)).toEqual(packet);
      expect(seoAuditInspectionPages(saved, [first])).toEqual([first, next]);
      for (const invalid of [
        null,
        {},
        { ...access, connectionVersion: "invalid" },
        { ...access, propertyId: "https://example.test/" },
        { ...access, propertyId: "sc-domain:elsewhere.test" },
      ]) {
        expect(() =>
          originalSeoAuditPacket({ ...saved, searchConsoleAccess: invalid }),
        ).toThrow();
        expect(() =>
          seoAuditInspectionPages({ ...saved, searchConsoleAccess: invalid }, [
            first,
          ]),
        ).toThrow();
      }
    }
    expect(
      selectSeoRelatedPages([seed.replace("https:", "http:")], [alias], access),
    ).toEqual([seed.replace("https:", "http:"), alias]);
    expect(() =>
      selectSeoRelatedPages(
        ["https://shop.example.test/start"],
        ["https://www.shop.example.test/p"],
        access,
      ),
    ).toThrow();
    for (const forbidden of [
      "https://shop.example.test/p",
      "https://www.example.test:444/p",
      "https://www.example.test/private.pdf",
      "https://www.example.test/settings",
      "https://www.example.test/p?session=x",
      "https://www.example.test.evil.test/p",
      "http://www.example.test/p",
    ]) {
      expect(() =>
        selectSeoRelatedPages([seed], [forbidden], access),
      ).toThrow();
    }
    expect(() => selectSeoRelatedPages([seed, alias], [], access)).toThrow();
  });
  it("rejects localhost and IP audit scopes before discovery", () => {
    expect(() =>
      selectSeoRelatedPages(["https://127.0.0.1/start"], []),
    ).toThrow("public host");
    expect(() =>
      selectSeoRelatedPages(["https://localhost/start"], []),
    ).toThrow("public host");
  });
  it("strips only validated indexing metadata while preserving the original packet and scope", () => {
    const original = {
      version: 1,
      inspectRelated: true,
      pageUrls: [seed],
      price: { kind: "fixed", credits: 750 },
    };
    const selected = [seed, "https://example.test/related"];
    const request = {
      ...original,
      relatedIndexingSelection: {
        version: 1,
        seedPageUrls: [seed],
        relatedPageUrls: selected.slice(1),
      },
    };
    expect(originalSeoAuditPacket(request)).toEqual(original);
    expect(originalSeoAuditPacket(original)).toEqual(original);
    expect(() =>
      originalSeoAuditPacket({ ...request, pageUrls: selected }),
    ).toThrow("invalid");
    expect(() =>
      originalSeoAuditPacket({ ...request, inspectRelated: false }),
    ).toThrow("invalid");
  });
  it("returns only validated related inspection URLs and keeps a legacy audit unchanged", () => {
    const original = { inspectRelated: true, pageUrls: [seed] };
    expect(seoAuditInspectionPages({ pageUrls: [seed] }, [seed])).toEqual([
      seed,
    ]);
    expect(() => seoAuditInspectionPages(original, [seed])).toThrow("Prepare");
    const metadata = {
      version: 1,
      seedPageUrls: [seed],
      relatedPageUrls: ["https://example.test/related"],
    };
    expect(
      seoAuditInspectionPages(
        { ...original, relatedIndexingSelection: metadata },
        [seed],
      ),
    ).toEqual([seed, "https://example.test/related"]);
    expect(() =>
      seoAuditInspectionPages(
        { ...original, relatedIndexingSelection: metadata },
        ["https://example.test/changed"],
      ),
    ).toThrow("changed");
    expect(() =>
      seoAuditInspectionPages(
        {
          ...original,
          relatedIndexingSelection: {
            ...metadata,
            relatedPageUrls: ["https://foreign.test/page"],
          },
        },
        [seed],
      ),
    ).toThrow("exact public host");
  });
  it("keeps extra indexing URLs outside the full report scope", () => {
    const related = "https://example.test/related";
    const original = {
      version: 1,
      inspectRelated: true,
      pageUrls: [seed],
      price: { kind: "fixed", credits: 750 },
      countryCode: "US",
      languageCode: "en",
    };
    const request = {
      ...original,
      relatedIndexingSelection: {
        version: 1,
        seedPageUrls: [seed],
        relatedPageUrls: [related],
      },
    };
    const raw = {
      ...legacyReport(),
      request: { ...legacyReport().request, url: seed },
    };
    const payload = parsePublicSeoArtifact(raw);
    const expected = { id: "audit-id", kind: "audit_full", request };
    expect(() =>
      assertSeoArtifactMatchesRequest(raw, payload, expected),
    ).not.toThrow();
    expect(() =>
      assertSeoArtifactMatchesRequest(
        raw,
        { ...payload, pageUrls: [seed, related] },
        expected,
      ),
    ).toThrow("frozen page scope");
    expect(originalSeoAuditPacket(request)).toEqual(original);
  });
});
