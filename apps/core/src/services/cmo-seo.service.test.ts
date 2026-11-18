import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { publicSeoPayloadSchema } from "@/helpers/project-seo-report";
import { toKeywordIdea } from "@/lib/ads/dataforseo";
import { searchConsoleOpportunities } from "./cmo-seo.service";
import {
  auditSuggestionKey,
  cmoAuditSummary,
  pageText,
} from "./cmo-seo-audit.service";

const report = publicSeoPayloadSchema.parse(
  JSON.parse(
    readFileSync(
      new URL("../test-fixtures/cmo-seo-audit-report.json", import.meta.url),
      "utf8",
    ),
  ),
);

describe("cmoAuditSummary", () => {
  it("reads a real weekly audit in the order the owner should read it", () => {
    const summary = cmoAuditSummary(new Date(report.observedAt), report);
    expect(summary.checked).toBe(
      report.checks.filter((c) => c.result === "pass" || c.result === "fired")
        .length,
    );
    expect(summary.passed).toBeLessThan(summary.checked);
    expect(summary.issues.length).toBeGreaterThan(0);
    expect(summary.issues.length).toBeLessThanOrEqual(6);
    // Measurements and notes are not issues; one rule on two devices is one issue.
    expect(
      summary.issues.every((issue) =>
        ["major", "minor"].includes(issue.severity),
      ),
    ).toBe(true);
    expect(new Set(summary.issues.map((i) => i.title)).size).toBe(
      summary.issues.length,
    );
    expect(summary.issues[0].severity).toBe("major");
    expect(summary.fixes).toHaveLength(report.actions.length);
  });
});

describe("auditSuggestionKey", () => {
  it("is the same for the same page and rules in any order", () => {
    expect(
      auditSuggestionKey("https://Battery-Sensei.app/", [
        "SD-06",
        "SD-03",
        "SD-03",
      ]),
    ).toBe(
      auditSuggestionKey("https://battery-sensei.app/", ["SD-03", "SD-06"]),
    );
  });
});

describe("toKeywordIdea", () => {
  it("reads a DataForSEO Labs item and drops an intent it does not know", () => {
    expect(
      toKeywordIdea({
        keyword: "macbook battery health",
        keyword_info: { search_volume: 720, cpc: 0.03 },
        keyword_properties: { keyword_difficulty: 67 },
        search_intent_info: { main_intent: "informational" },
      }),
    ).toEqual({
      keyword: "macbook battery health",
      searchVolume: 720,
      difficulty: 67,
      intent: "informational",
      cpc: 0.03,
    });
    expect(
      toKeywordIdea({
        keyword: "x",
        search_intent_info: { main_intent: "local" },
      }),
    ).toMatchObject({ searchVolume: null, difficulty: null, intent: null });
  });
});

describe("searchConsoleOpportunities", () => {
  const row = (
    query: string,
    position: number,
    impressions: number,
    ctr: number,
  ) => ({
    query,
    pageUrl: "https://example.com/",
    clicks: Math.round(impressions * ctr),
    impressions,
    ctr,
    position,
  });

  it("finds searches ranked 8 to 20 and top searches few people click", () => {
    const found = searchConsoleOpportunities([
      row("near", 11.2, 300, 0.01),
      row("too far", 34, 900, 0),
      row("top, clicked", 2, 500, 0.2),
      row("top, ignored", 3, 400, 0.005),
      row("near but rare", 9, 2, 0),
    ]);
    expect(found.nearFirstPage.map((r) => r.query)).toEqual(["near"]);
    expect(found.lowClickRate.map((r) => r.query)).toEqual(["top, ignored"]);
  });
});

describe("pageText", () => {
  it("reads the title, meta description and visible text, never scripts or styles", () => {
    const text = pageText(
      `<html><head><title>Team Booking &amp; Routing | Acme</title>
        <meta name="description" content="Book a team in one link.">
        <style>.a{color:red}</style><script>var hidden = "secret";</script >
        </head><body><h1>Team   booking</h1><p>For sales &lt;teams&gt;.</p></body></html>`,
    );
    expect(text).toContain("team booking & routing | acme");
    expect(text).toContain("book a team in one link.");
    expect(text).toContain("for sales <teams>.");
    expect(text).not.toContain("secret");
    expect(text).not.toContain("color:red");
  });
});
