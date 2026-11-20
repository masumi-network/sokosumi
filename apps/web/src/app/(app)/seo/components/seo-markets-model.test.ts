import { expect, it } from "vitest";
import { seoMarketEvidence } from "./seo-markets-model";
import { seoTestCheckedAudit } from "./seo-test-fixture";

it("joins historical country rows to the audited task and pages; excludes domestic and unobserved markets", () => {
  const data = seoTestCheckedAudit();
  data.observations[0] = {
    ...data.observations[0],
    kind: "audit_full",
    sourceTaskId: "old-audit",
  };
  const row = (key: string, impressions: number) => ({
    key,
    impressions,
    clicks: 0,
    averagePosition: 2,
    ctr: 0,
  });
  const owner = {
    taskId: "old-audit",
    propertyId: "example.com",
    pageUrls: [data.pages[0].url],
    measuredPages: [],
    from: new Date("2026-01-01"),
    to: new Date("2026-01-28"),
    opportunities: [],
    previous: null,
    queries: null,
    coverage: "complete" as const,
    impressions: 22,
    clicks: 0,
    ctr: 0,
    averagePosition: 2,
    countries: {
      rows: [row("US", 12), row("DE", 4), row("GB", 6), row("NO", 0)],
      truncated: false,
      rowLimit: 10,
    },
  };
  data.auditSearchConsole = [owner];
  expect(seoMarketEvidence(data).foreign.map((row) => row.key)).toEqual([
    "GB",
    "DE",
  ]);
  data.auditSearchConsole = [
    { ...owner, pageUrls: [data.pages[0].url, "https://elsewhere.example/"] },
  ];
  expect(seoMarketEvidence(data).evidence).toBeUndefined();
  data.auditSearchConsole = [{ ...owner, taskId: "other-audit" }];
  expect(seoMarketEvidence(data).evidence).toBeUndefined();
});
