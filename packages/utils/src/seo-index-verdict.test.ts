import { describe, expect, it } from "vitest";
import { newerSeoAuditVerdict } from "./seo-index-verdict";

describe("audit and Search Console verdict precedence", () => {
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
