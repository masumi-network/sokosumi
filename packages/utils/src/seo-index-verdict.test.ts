import { describe, expect, it } from "vitest";
import { newerSeoAuditVerdict } from "./seo-index-verdict";

describe("audit and Search Console verdict precedence", () => {
  it("treats an unavailable assessment as a dated unknown only when Core verified Google's reply", () => {
    const pageUrl = "https://example.test/guide";
    const syncedAt = "2026-11-15T08:00:00Z";
    const unavailable = {
      pageUrl,
      status: "unavailable",
      checkedAt: "2026-11-16T08:00:00Z",
    };
    for (const evidence of [
      [],
      [
        "Google URL Inspection: VERDICT_UNSPECIFIED; no coverage reason returned.",
      ],
      [
        "Google URL Inspection: VERDICT_UNSPECIFIED; Google has not crawled the page.",
      ],
    ]) {
      const bare = { ...unavailable, evidence };
      expect(newerSeoAuditVerdict(pageUrl, syncedAt, [bare])).toBeUndefined();
      const confirmed = { ...bare, googleReturnedUnknown: true as const };
      expect(
        newerSeoAuditVerdict(pageUrl, syncedAt, [confirmed]),
      ).toMatchObject({
        verdict: "VERDICT_UNSPECIFIED",
        coverageState: evidence[0]?.includes("Google has not crawled")
          ? "Google has not crawled the page"
          : null,
      });
      expect(
        newerSeoAuditVerdict(pageUrl, confirmed.checkedAt, [confirmed]),
      ).toBeUndefined();
    }
  });
  it("keeps the latest observed verdict through a later unavailable or unmeasured review", () => {
    const pageUrl = "https://example.test/guide";
    const checkedAt = "2026-11-16T08:00:00.000Z";
    const indexed = { pageUrl, checkedAt, status: "indexed" };
    const explicit = {
      ...indexed,
      status: "expected_exclusion",
      evidence: ["Google URL Inspection: NEUTRAL; Page with redirect."],
    };
    for (const status of ["unavailable", "review", "issue"]) {
      const noEvidence = {
        ...indexed,
        checkedAt: "2026-11-16T09:00:00.000Z",
        status,
      };
      for (const rows of [
        [explicit, noEvidence],
        [noEvidence, explicit],
      ]) {
        expect(
          newerSeoAuditVerdict(pageUrl, "2026-11-15T08:00:00Z", rows)?.verdict,
        ).toBe("NEUTRAL");
      }
      expect(
        newerSeoAuditVerdict(pageUrl, undefined, [noEvidence]),
      ).toBeUndefined();
    }
    for (const rows of [
      [explicit, indexed],
      [indexed, explicit],
    ]) {
      expect(newerSeoAuditVerdict(pageUrl, undefined, rows)).toBeUndefined();
    }
    expect(
      newerSeoAuditVerdict(pageUrl, new Date(checkedAt), [indexed]),
    ).toBeUndefined();
  });
});
