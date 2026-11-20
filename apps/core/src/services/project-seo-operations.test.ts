import { describe, expect, it } from "vitest";

import { requestSeoAnalysisSchema } from "@/schemas/project-seo.schema";
import { SEO_MAX_PACKET_CHARS } from "@/schemas/seo-task-pages.schema";
import {
  seoTaskPacket,
  validateSeoAnalysis,
} from "./project-seo-operations.service";

const page = "https://example.test/page";
const request = () =>
  requestSeoAnalysisSchema.parse({
    kind: "audit_lite",
    countryCode: "US",
    languageCode: "en",
    keywords: ["ordinary search"],
    analyses: ["keyword.refresh"],
    devices: ["desktop"],
    idempotencyKey: "request-test-key",
  });

describe("SEO worker request compatibility before Task dispatch", () => {
  it("keeps submitted sitemaps private to a connected full audit and accepts legacy requests", () => {
    const base = { ...request(), kind: "audit_full", analyses: undefined };
    expect(requestSeoAnalysisSchema.parse(base)).not.toHaveProperty(
      "includeSitemaps",
    );
    const approved = requestSeoAnalysisSchema.parse({
      ...base,
      includeSitemaps: true,
    });
    expect(seoTaskPacket(approved, [page], "audit-id")).not.toHaveProperty(
      "includeSitemaps",
    );
    for (const request of [
      { ...approved, allowLimitedAudit: true },
      { ...approved, kind: "page_check" },
    ])
      expect(requestSeoAnalysisSchema.safeParse(request).success).toBe(false);
  });
  it("freezes the customer's cost-plus terms independently of the worker data budget", () => {
    const fullAuditPrice = {
      kind: "cost_plus",
      version: 1,
      minimumCredits: 750,
      markupPercent: 50,
    };
    const terms = { ...request(), kind: "audit_full", fullAuditPrice };
    const input = requestSeoAnalysisSchema.parse(terms);
    expect(seoTaskPacket(input, [page], "audit-id")).toMatchObject({
      price: fullAuditPrice,
      inspectRelated: true,
    });
    for (const invalid of [
      { ...terms, fullAuditCredits: 750 },
      { ...terms, fullAuditPrice: { ...fullAuditPrice, maxCredits: 749 } },
      { ...terms, fullAuditPrice: { ...fullAuditPrice, markupPercent: 0 } },
      { ...terms, fullAuditPrice: { ...fullAuditPrice, totalMicroUsd: 1 } },
    ])
      expect(requestSeoAnalysisSchema.safeParse(invalid).success).toBe(false);
    expect(() =>
      validateSeoAnalysis(
        {
          ...input,
          analyses: undefined,
          devices: ["mobile", "desktop"],
          fullAuditLimits: { usd: 6, seconds: 300 },
        },
        [page, page + "/two"],
      ),
    ).toThrow(/data budget/);
  });
  it("rejects equivalent encoded seed URLs before emitting a fixed-price worker packet", () => {
    expect(() =>
      seoTaskPacket(
        { ...request(), kind: "audit_full", fullAuditCredits: 750 },
        [page, "https://example.test/%70age"],
        "audit-id",
      ),
    ).toThrow("each audit page once");
  });
  it("rejects keyword operators, normalized duplicates and duplicate analyses before worker intake", () => {
    const base = request();
    expect(() =>
      validateSeoAnalysis({ ...base, keywords: ["site:example.test"] }, [page]),
    ).toThrow("search operator");
    expect(() =>
      validateSeoAnalysis(
        { ...base, keywords: ["ordinary search", "ordinary  search"] },
        [page],
      ),
    ).toThrow("each keyword once");
    expect(() =>
      validateSeoAnalysis(
        { ...base, analyses: ["keyword.refresh", "keyword.refresh"] },
        [page],
      ),
    ).toThrow("each analysis once");
  });
  it("rejects duplicate external targets and budget fields that the selected worker path cannot enforce", () => {
    const base = request();
    expect(() =>
      validateSeoAnalysis(
        {
          ...base,
          kind: "links",
          analyses: undefined,
          competitorUrls: [
            "https://competitor.test",
            "https://competitor.test/",
          ],
        },
        [page],
      ),
    ).toThrow("each competitor once");
    expect(() =>
      validateSeoAnalysis(
        { ...base, fullAuditLimits: { usd: 1, seconds: 120 } },
        [page],
      ),
    ).toThrow("Full-audit limits");
    expect(() =>
      validateSeoAnalysis(
        {
          ...base,
          kind: "audit_full",
          devices: ["desktop", "mobile"],
          keywords: [],
          competitorUrls: ["https://competitor.test/"],
        },
        [page],
      ),
    ).toThrow("Full audits cannot use focused analysis options");
  });
  it("freezes the fixed full-audit price without changing focused pricing", () => {
    const base = request();
    const full = seoTaskPacket(
      { ...base, kind: "audit_full", fullAuditCredits: 750 },
      [page],
      "01951111-1111-7111-8111-111111111111",
    );
    expect(full.price).toEqual({ kind: "fixed", credits: 750 });
    expect(full.inspectRelated).toBe(true);
    expect(
      seoTaskPacket(
        { ...base, kind: "audit_full" },
        [page],
        "01951111-1111-7111-8111-111111111111",
      ).inspectRelated,
    ).toBeUndefined();
    expect(
      seoTaskPacket(base, [page], "01951111-1111-7111-8111-111111111111").price,
    ).toBeUndefined();
  });
  it("rejects a provider budget above the fixed audit allowance but retains legacy limits", () => {
    const base = {
      ...request(),
      kind: "audit_full" as const,
      analyses: undefined,
      keywords: [],
      devices: ["mobile", "desktop"] as ("mobile" | "desktop")[],
      fullAuditLimits: { usd: 5.01, seconds: 900 },
    };
    expect(() =>
      validateSeoAnalysis({ ...base, fullAuditCredits: 750 }, [
        page,
        `${page}/next`,
      ]),
    ).toThrow("provider allowance");
    expect(() =>
      validateSeoAnalysis(base, [page, `${page}/next`]),
    ).not.toThrow();
  });
  it("refuses a Task packet the worker would refuse for its length, before dispatch", () => {
    const longUrl = (n: number) =>
      `https://example.test/${n}/${"a".repeat(4000)}`;
    const pages = Array.from({ length: 10 }, (_, n) => longUrl(n));
    const links = {
      ...request(),
      kind: "links" as const,
      analyses: undefined,
      keywords: [],
      competitorUrls: Array.from({ length: 10 }, (_, n) =>
        longUrl(n).replace("example", "competitor"),
      ),
    };
    expect(() =>
      seoTaskPacket(links, pages, "01951111-1111-7111-8111-111111111111"),
    ).toThrow("too long for the worker");
    const packet = seoTaskPacket(
      request(),
      [page],
      "01951111-1111-7111-8111-111111111111",
    );
    expect(JSON.stringify(packet).length).toBeLessThan(SEO_MAX_PACKET_CHARS);
  });
});

it("retains approved same-origin sitemap hints and refuses off-site or private inputs before dispatch", () => {
  const base = {
    ...request(),
    kind: "audit_full" as const,
    analyses: undefined,
    devices: ["desktop", "mobile"] as ("desktop" | "mobile")[],
    fullAuditCredits: 750 as const,
  };
  const inputs = {
    publicSitemapUrl: "https://example.test/maps/custom.xml",
    sitemapPageHints: ["https://example.test/topic"],
  };
  expect(
    seoTaskPacket({ ...base, ...inputs }, [page], "audit-id"),
  ).toMatchObject({ ...inputs, inspectRelated: true, pageUrls: [page] });
  for (const rejected of [
    { ...base, publicSitemapUrl: "https://other.test/sitemap.xml" },
    { ...base, publicSitemapUrl: "https://example.test/private/map.xml" },
    { ...base, sitemapPageHints: [page + "?token=x"] },
    { ...base, fullAuditCredits: undefined, ...inputs },
    { ...base, kind: "page_check" as const, ...inputs },
  ])
    expect(() => validateSeoAnalysis(rejected, [page])).toThrow();
});
