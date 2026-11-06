import { describe, expect, it } from "vitest";

import {
  parseSeoMonitorPlan,
  SEO_MONITOR_MARKER,
  seoMonitorDescriptionForUser,
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
