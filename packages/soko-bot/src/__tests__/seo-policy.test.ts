import { describe, expect, it } from "vitest";
import {
  capabilitiesForClassification,
  SOKO_BOT_BOT_TO_BOT_CAPABILITIES,
  SOKO_BOT_ROUTE_CAPABILITIES,
  SOKO_BOT_WEB_TAINTED_BLOCKED_CAPABILITIES,
} from "../policy.js";
import {
  SOKO_BOT_SEO_INPUT_SCHEMAS,
  SOKO_BOT_SEO_READ_CAPABILITIES,
  SOKO_BOT_SEO_WRITE_CAPABILITIES,
} from "../seo.js";

describe("SEO capability boundaries", () => {
  it("exposes the bounded Core Request contract and freezes saved-scope versions", () => {
    const projectId = "11111111-1111-4111-8111-111111111111";
    const scopeId = "22222222-2222-4222-8222-222222222222";
    const request = {
      projectId,
      kind: "rankings",
      countryCode: "US",
      languageCode: "en",
      keywords: ["agent payments"],
      idempotencyKey: "request-unique",
    };
    const schema = SOKO_BOT_SEO_INPUT_SCHEMAS.request_seo_analysis;
    expect(schema.safeParse(request).success).toBe(true);
    for (const changed of [
      { keywords: ["x".repeat(81)] },
      { keywords: ["keyword\ncontrol"] },
      { keywords: ['"quoted"'] },
      { keywords: Array.from({ length: 21 }, (_, n) => `keyword ${n}`) },
      { countryCode: "ZZ" },
      { languageCode: "en-US" },
      { scopeId },
      { scopeId, expectedScopeVersion: 1, pageIds: [projectId] },
    ])
      expect(schema.safeParse({ ...request, ...changed }).success).toBe(false);
    expect(
      schema.safeParse({ ...request, scopeId, expectedScopeVersion: 2 })
        .success,
    ).toBe(true);
    expect(
      schema.safeParse({
        ...request,
        kind: "audit_full",
        fullAuditLimits: { usd: 3, seconds: 1170 },
      }).success,
    ).toBe(true);
    // Below one page's reserve the worker refuses the audit, so the tool does too.
    expect(
      schema.safeParse({
        ...request,
        kind: "audit_full",
        fullAuditLimits: { usd: 0.32, seconds: 1170 },
      }).success,
    ).toBe(false);
    const stats = {
      projectId,
      provider: "ga4",
      propertyId: "properties/123",
      from: "2026-01-01",
      to: "2026-01-31",
    };
    expect(
      SOKO_BOT_SEO_INPUT_SCHEMAS.sync_seo_statistics.safeParse({
        ...stats,
        scopeId,
      }).success,
    ).toBe(false);
    expect(
      SOKO_BOT_SEO_INPUT_SCHEMAS.sync_seo_statistics.safeParse({
        ...stats,
        scopeId,
        expectedScopeVersion: 2,
      }).success,
    ).toBe(true);
    expect(
      SOKO_BOT_SEO_INPUT_SCHEMAS.sync_seo_statistics.safeParse({
        ...stats,
        to: "2026-02-31",
      }).success,
    ).toBe(false);
    expect(
      SOKO_BOT_SEO_INPUT_SCHEMAS.get_seo_workspace.safeParse({
        projectId,
        channel: "organic",
      }).success,
    ).toBe(true);
    expect(
      SOKO_BOT_SEO_INPUT_SCHEMAS.get_seo_workspace.safeParse({
        projectId,
        scopeId,
        pageId: projectId,
      }).success,
    ).toBe(false);
    expect(
      SOKO_BOT_SEO_INPUT_SCHEMAS.get_seo_workspace.safeParse({
        projectId,
        pageIds: [scopeId],
      }).success,
    ).toBe(true);
    expect(
      SOKO_BOT_SEO_INPUT_SCHEMAS.get_seo_workspace.safeParse({
        projectId,
        scopeId,
        pageIds: [scopeId],
      }).success,
    ).toBe(false);
    const change = {
      projectId,
      pageIds: [scopeId],
      occurredAt: "2026-01-01T12:00:00Z",
      title: "Updated the title",
      idempotencyKey: "change-unique",
    };
    expect(
      SOKO_BOT_SEO_INPUT_SCHEMAS.record_seo_page_change.safeParse(change)
        .success,
    ).toBe(true);
    expect(
      SOKO_BOT_SEO_INPUT_SCHEMAS.record_seo_page_change.safeParse({
        ...change,
        title: " ",
      }).success,
    ).toBe(false);
  });
  it("keeps reads available without granting writes on a direct answer or another bot's request", () => {
    for (const read of SOKO_BOT_SEO_READ_CAPABILITIES)
      expect(SOKO_BOT_ROUTE_CAPABILITIES.DIRECT_RESPONSE).toContain(read);
    for (const write of SOKO_BOT_SEO_WRITE_CAPABILITIES) {
      expect(SOKO_BOT_ROUTE_CAPABILITIES.DIRECT_RESPONSE).not.toContain(write);
      expect(SOKO_BOT_BOT_TO_BOT_CAPABILITIES).not.toContain(write);
    }
    expect(SOKO_BOT_WEB_TAINTED_BLOCKED_CAPABILITIES).toContain(
      "request_seo_analysis",
    );
  });
  it("grants SEO operations on explicit Work changes but not an email change", () => {
    const base = {
      schemaVersion: 1 as const,
      route: "MANAGE_WORK" as const,
      confidence: 1,
      rationaleSummary: "explicit",
      requestedOutcome: "save choices",
      candidateProjectIds: [],
      candidateCoworkerIds: [],
      candidateAgentIds: [],
      requiresApproval: false,
      requiresClarification: false,
    };
    const work = capabilitiesForClassification({ ...base, writeScope: "WORK" });
    const email = capabilitiesForClassification({
      ...base,
      writeScope: "INTEGRATION",
    });
    for (const write of SOKO_BOT_SEO_WRITE_CAPABILITIES) {
      expect(work).toContain(write);
      expect(email).not.toContain(write);
    }
  });
});
