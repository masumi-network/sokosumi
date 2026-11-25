import { describe, expect, it } from "vitest";

import type { NativeSeoMetrics } from "@/schemas/project-seo-native-metrics.schema";

import { seoClicksDrop } from "./project-seo-monitor-clicks";

/** A 28-day web search sync whose earlier period has 25 final days. */
function metrics(
  value: number | null,
  previous: { from: string; to: string; value: number | null } | undefined,
  overrides: Partial<NativeSeoMetrics> = {},
): NativeSeoMetrics {
  return {
    provider: "search_console",
    propertyId: "sc-domain:shop.example",
    pageUrls: ["https://shop.example/"],
    channel: "organic_search",
    from: "2026-10-27",
    to: "2026-11-23",
    timeZone: "America/Los_Angeles",
    observedAt: "2026-11-24T09:00:00.000Z",
    coverage: "partial",
    notes: [],
    metrics: [
      {
        key: "impressions",
        label: "Search impressions",
        unit: "count",
        value: 1,
        points: [],
        previous: { from: "2026-10-02", to: "2026-10-26", value: 9000 },
      },
      {
        key: "clicks",
        label: "Search clicks",
        unit: "count",
        value,
        points: [],
        ...(previous && { previous }),
      },
    ],
    ...overrides,
  } as NativeSeoMetrics;
}
const before = (value: number | null, to = "2026-10-26") => ({
  from: "2026-10-02",
  to,
  value,
});

describe("seoClicksDrop", () => {
  it("reports a fall of 30 percent with the site, both counts and the period pair", () => {
    expect(seoClicksDrop(metrics(70, before(100)))).toEqual({
      site: "shop.example",
      clicksFrom: 100,
      clicksTo: 70,
      periods: "2026-10-02:2026-10-26:2026-10-27:2026-11-23",
    });
  });

  it("reports a fall to zero clicks", () => {
    expect(seoClicksDrop(metrics(0, before(50)))).toMatchObject({
      clicksFrom: 50,
      clicksTo: 0,
    });
  });

  it.each([
    ["a fall below 30 percent", metrics(71, before(100))],
    ["a rise", metrics(140, before(100))],
    ["an earlier period under 50 clicks", metrics(0, before(49))],
    [
      "an earlier period under 7 final days",
      metrics(0, before(100, "2026-10-07")),
    ],
    ["no earlier period", metrics(0, undefined)],
    ["an earlier period with no value", metrics(0, before(null))],
    ["clicks that were not read", metrics(null, before(100))],
    [
      "a read that returned no rows",
      metrics(0, before(100), { coverage: "unavailable" }),
    ],
    ["a Discover sync", metrics(0, before(100), { searchType: "discover" })],
    ["Google Analytics", metrics(0, before(100), { provider: "ga4" })],
  ])("has no alert for %s", (_, row) => {
    expect(seoClicksDrop(row)).toBeNull();
  });
});
