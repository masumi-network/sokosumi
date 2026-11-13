import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { requestSeoAnalysisSchema } from "./project-seo.schema";

describe("SEO analysis request", () => {
  it("refuses a full-audit USD limit below one page's reserve, as the worker does", () => {
    const request = (usd: number) =>
      requestSeoAnalysisSchema.safeParse({
        kind: "audit_full",
        scopeId: randomUUID(),
        expectedScopeVersion: 1,
        countryCode: "US",
        languageCode: "en",
        idempotencyKey: "full-audit-limit-test",
        fullAuditLimits: { usd, seconds: 900 },
      }).success;
    expect(request(0.32)).toBe(false);
    expect(request(0.33)).toBe(true);
  });
});
