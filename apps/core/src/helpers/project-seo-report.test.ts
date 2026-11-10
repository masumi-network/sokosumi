import { describe, expect, it } from "vitest";
import {
  focusedReport,
  legacyReport,
  SEO_TEST_PAGE,
  SEO_TEST_REQUEST_ID,
} from "@/test-fixtures/project-seo";
import {
  assertSeoArtifactMatchesRequest,
  parsePublicSeoArtifact,
} from "./project-seo-report";

describe("public SEO report trust boundary", () => {
  it("keeps unrequested modules separate from individual rule check counts", () => {
    const fixture = focusedReport();
    const raw = {
      ...fixture,
      checks: ["pass", "fired", "not_checked", "blocked"].map(
        (result, index) => ({
          ...fixture.checks[0],
          id: String(index),
          result,
        }),
      ),
      coverage: {
        ...fixture.coverage,
        skipped: ["keyword.refresh", "links.refresh"],
        failed: ["page.inspect"],
        completed: [],
      },
    };

    expect(parsePublicSeoArtifact(raw).coverage).toEqual({
      checked: 2,
      skipped: 1,
      failed: 1,
      modules: {
        notRequested: 2,
        failed: 1,
        notRequestedNames: ["keyword.refresh", "links.refresh"],
        failedNames: ["page.inspect"],
      },
    });
  });

  it("retains ranked, opportunity and gap provenance without inventing rank zero", () => {
    const report = parsePublicSeoArtifact(legacyReport());
    expect(report.keywords).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          keyword: "example",
          device: "mobile",
          position: null,
          positionStatus: "not_in_range",
          checkedResults: 100,
        }),
        expect.objectContaining({
          keyword: "ranked term",
          device: null,
          position: 12,
          source: "ranked",
        }),
        expect.objectContaining({
          keyword: "gap term",
          position: null,
          positionStatus: "unavailable",
          source: "gap",
        }),
        expect.objectContaining({
          keyword: "opportunity",
          source: "opportunity",
        }),
      ]),
    );
    expect(report.actions[0].findingIds).toEqual(["finding:desktop"]);
    expect(report.competitors).toContainEqual(
      expect.objectContaining({
        role: "page",
        backlinks: 10,
        referringDomains: 4,
      }),
    );
  });

  it("refuses private Google evidence before projecting public fields, including nested site pages", () => {
    expect(() =>
      parsePublicSeoArtifact({
        ...legacyReport(),
        outcomeReading: { clicks: 3 },
      }),
    ).toThrow("Only public SEO evidence");
    expect(() =>
      parsePublicSeoArtifact({
        kind: "site",
        rulebookVersion: "test",
        pages: [
          {
            ...legacyReport(),
            request: { url: SEO_TEST_PAGE, connections: ["search_console"] },
          },
        ],
      }),
    ).toThrow("Only public SEO evidence");
    const report = legacyReport();
    expect(() =>
      parsePublicSeoArtifact({
        ...report,
        header: {
          ...report.header,
          focusKeywords: [
            { ...report.header.focusKeywords[0], searchConsole: { clicks: 1 } },
          ],
        },
      }),
    ).toThrow("Private search evidence");
  });

  it("imports a site audit whose failed page the worker names as skipped, and refuses one that drops a page silently", () => {
    const second = "https://example.test/second";
    const site = (skipped: { url: string; reason: string }[]) => ({
      kind: "site",
      rulebookVersion: "test",
      pages: [legacyReport()],
      selection: { pages: [], skipped, picked: [] },
    });
    const request = {
      id: SEO_TEST_REQUEST_ID,
      kind: "audit_full",
      request: {
        pageUrls: [SEO_TEST_PAGE, second],
        countryCode: "US",
        languageCode: "en",
      },
    };
    const partial = site([
        { url: second, reason: "the page Run failed: timeout" },
      ]),
      parsed = parsePublicSeoArtifact(partial);
    expect(parsed.pageUrls).toEqual([SEO_TEST_PAGE]);
    expect(parsed.notes).toContain(
      `Page not audited: ${second} (the page Run failed: timeout)`,
    );
    expect(() =>
      assertSeoArtifactMatchesRequest(partial, parsed, request),
    ).not.toThrow();
    const silent = site([]);
    expect(() =>
      assertSeoArtifactMatchesRequest(
        silent,
        parsePublicSeoArtifact(silent),
        request,
      ),
    ).toThrow("frozen page scope");
    for (const skipped of [
      { url: SEO_TEST_PAGE, reason: "reported too" },
      { url: "https://other.test/x", reason: "out of scope" },
    ]) {
      const odd = site([{ url: second, reason: "timeout" }, skipped]);
      expect(() =>
        assertSeoArtifactMatchesRequest(
          odd,
          parsePublicSeoArtifact(odd),
          request,
        ),
      ).toThrow("frozen page scope");
    }
  });

  it("rejects a valid result relabeled for a different Market, device, keyword or external target", () => {
    const raw = focusedReport(),
      parsed = parsePublicSeoArtifact(raw);
    const request = {
      id: SEO_TEST_REQUEST_ID,
      kind: "page_check",
      request: {
        pageUrls: [SEO_TEST_PAGE],
        keywords: [],
        countryCode: "US",
        languageCode: "en",
        devices: ["desktop"],
      },
    };
    expect(() =>
      assertSeoArtifactMatchesRequest(raw, parsed, request),
    ).not.toThrow();
    expect(() =>
      assertSeoArtifactMatchesRequest(raw, parsed, {
        ...request,
        request: { ...request.request, countryCode: "DE" },
      }),
    ).toThrow("Market");
    expect(() =>
      assertSeoArtifactMatchesRequest(raw, parsed, {
        ...request,
        request: { ...request.request, devices: ["mobile"] },
      }),
    ).toThrow("devices");
    expect(() =>
      assertSeoArtifactMatchesRequest(raw, parsed, {
        ...request,
        request: { ...request.request, keywords: ["unrequested"] },
      }),
    ).toThrow("keywords");
    expect(() =>
      assertSeoArtifactMatchesRequest(
        raw,
        {
          ...parsed,
          competitors: [
            {
              pageUrl: "https://unapproved.test/",
              role: "competitor",
              backlinks: 1,
              referringDomains: 1,
              sourceRef: "snapshot",
              observedAt: raw.observedAt,
            },
          ],
        },
        request,
      ),
    ).toThrow("unapproved link target");
  });
});
