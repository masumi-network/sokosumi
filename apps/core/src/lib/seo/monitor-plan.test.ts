import { describe, expect, it } from "vitest";

import {
  hasReadableSeoMonitorPlan,
  parseSeoMonitorPlan,
  SEO_MONITOR_MARKER,
  seoMonitorDescriptionForUser,
  seoMonitorDescriptionWithRule,
} from "./monitor-plan";

const AUDIT_ID = "11111111-1111-4111-8111-111111111111";
const PAGE_ID = "22222222-2222-4222-8222-222222222222";
const plan = {
  cadence: "weekly",
  timeZone: "Europe/Oslo",
  targetRunCount: 2,
  scopeVersion: 1,
  analysis: {
    kind: "page_check",
    pageIds: [PAGE_ID],
    countryCode: "US",
    languageCode: "en",
    devices: ["desktop"],
    coworkerId: "seo-coworker",
    idempotencyKey: "monitor-template",
  },
};

function description(packet: object): string {
  return SEO_MONITOR_MARKER + JSON.stringify(packet);
}

describe("SEO monitor owner protocol", () => {
  it("retains an independent Audit identity without exposing protocol details in user copy", () => {
    const body = description({ version: 2, auditId: AUDIT_ID, ...plan });
    expect(parseSeoMonitorPlan(body)).toMatchObject({
      version: 2,
      auditId: AUDIT_ID,
      analysis: { pageIds: [PAGE_ID] },
    });
    expect(seoMonitorDescriptionForUser(body)).toBe(
      "Weekly page checks for 1 saved page. Ends after 2 scheduled runs. Time zone: Europe/Oslo.",
    );
  });

  it("keeps legacy Project packets and rejects missing or ambiguous Audit ownership", () => {
    expect(
      parseSeoMonitorPlan(description({ version: 1, ...plan })),
    ).toMatchObject({
      version: 1,
    });
    for (const owner of [
      { version: 2 },
      { version: 2, auditId: "invalid" },
      { version: 1, auditId: AUDIT_ID },
    ])
      expect(() =>
        parseSeoMonitorPlan(description({ ...owner, ...plan })),
      ).toThrow();
  });

  it("keeps Audit monitor Runs bounded to saved pages and the approved Coworker", () => {
    for (const analysis of [
      { ...plan.analysis, kind: "audit_full" },
      { ...plan.analysis, scopeId: AUDIT_ID },
      { ...plan.analysis, pageIds: [] },
      { ...plan.analysis, coworkerId: undefined },
    ])
      expect(() =>
        parseSeoMonitorPlan(
          description({
            version: 2,
            auditId: AUDIT_ID,
            ...plan,
            analysis,
          }),
        ),
      ).toThrow();
  });
});

describe("SEO monitor rule edits", () => {
  const legacy = description({ version: 1, ...plan });
  const rule = (patch: object = {}) => ({
    expr: "30 7 * * MON,THU",
    timezone: "Europe/Berlin",
    endsMode: "NEVER" as const,
    targetRunCount: null,
    ...patch,
  });

  it("rewrites only the rule and keeps the approved pages and check", () => {
    const edited = seoMonitorDescriptionWithRule(legacy, {
      expectedRevision: 3,
      rule: rule(),
    });
    expect(parseSeoMonitorPlan(edited)).toMatchObject({
      version: 1,
      rule: rule(),
      scopeVersion: 1,
      analysis: plan.analysis,
    });
    expect(parseSeoMonitorPlan(edited)?.analysis).toEqual(
      parseSeoMonitorPlan(legacy)?.analysis,
    );
    expect(seoMonitorDescriptionForUser(edited)).toBe(
      "Weekly page checks for 1 saved page. Runs until someone stops it. Time zone: Europe/Berlin.",
    );
  });

  it("reads a legacy packet as the 09:00 rule it ran on", () => {
    expect(parseSeoMonitorPlan(legacy)?.rule).toEqual({
      expr: "0 9 * * 1",
      timezone: "Europe/Oslo",
      endsMode: "AFTER",
      targetRunCount: 2,
    });
  });

  it("accepts monthly and daily rules with a run count", () => {
    for (const expr of ["0 9 31 * *", "5 23 * * *"])
      expect(
        parseSeoMonitorPlan(
          seoMonitorDescriptionWithRule(legacy, {
            expectedRevision: 0,
            rule: rule({ expr, endsMode: "AFTER", targetRunCount: 31 }),
          }),
        )?.rule.expr,
      ).toBe(expr);
  });

  it("refuses a change to the pages, name or assignee", () => {
    for (const blueprint of [
      { name: "Wider" },
      { description: "other" },
      { projectId: AUDIT_ID },
      { assigneeId: "another-coworker" },
    ])
      expect(() =>
        seoMonitorDescriptionWithRule(legacy, {
          expectedRevision: 0,
          rule: rule(),
          ...blueprint,
        }),
      ).toThrow(expect.objectContaining({ status: 409 }));
    expect(() =>
      seoMonitorDescriptionWithRule(legacy, { expectedRevision: 0 }),
    ).toThrow(expect.objectContaining({ status: 409 }));
  });

  it("refuses rules an SEO monitor may not hold", () => {
    for (const patch of [
      { expr: "*/15 * * * *" },
      { expr: "0 9 1 * MON" },
      { expr: "0 9 * 6 *" },
      { expr: "0 9 * * MON,MON" },
      { expr: "0 24 * * *" },
      { timezone: "Mars/Olympus" },
      { endsMode: "AFTER", targetRunCount: null },
      { endsMode: "AFTER", targetRunCount: 32 },
      { endsMode: "NEVER", targetRunCount: 3 },
      { endsMode: "ON", endsOn: "2027-01-01T00:00:00.000Z" },
      { intervalDays: 2, anchorAt: "2027-01-01T00:00:00.000Z" },
    ])
      expect(() =>
        seoMonitorDescriptionWithRule(legacy, {
          expectedRevision: 0,
          rule: rule(patch) as never,
        }),
      ).toThrow(expect.objectContaining({ status: 422 }));
  });

  it("keeps a broken packet closed", () => {
    expect(() =>
      seoMonitorDescriptionWithRule(`${SEO_MONITOR_MARKER}{broken`, {
        expectedRevision: 0,
        rule: rule(),
      }),
    ).toThrow(expect.objectContaining({ status: 409 }));
    expect(hasReadableSeoMonitorPlan(`${SEO_MONITOR_MARKER}{broken`)).toBe(
      false,
    );
    expect(hasReadableSeoMonitorPlan("ordinary prose")).toBe(true);
  });
});
