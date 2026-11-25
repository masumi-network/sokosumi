import { describe, expect, it } from "vitest";

import type { NativeSeoMetrics } from "@/schemas/project-seo-native-metrics.schema";

import {
  newestSeoClicksRow,
  seoClicksDrop,
} from "./project-seo-monitor-clicks";

const NOW = new Date("2026-11-25T12:00:00.000Z");

/**
 * A complete web search sync of 25 days against the 25 days before. Read on Nov 24, when Google had settled the days
 * up to Nov 21.
 */
function metrics(
  value: number | null,
  previous: { from: string; to: string; value: number | null } | undefined,
  overrides: Partial<NativeSeoMetrics> = {},
): NativeSeoMetrics {
  return {
    provider: "search_console",
    propertyId: "sc-domain:shop.example",
    pageUrls: ["https://shop.example/"],
    channel: "organic",
    from: "2026-10-27",
    to: "2026-11-20",
    timeZone: "America/Los_Angeles",
    observedAt: "2026-11-24T09:00:00.000Z",
    coverage: "complete",
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
const before = (
  value: number | null,
  from = "2026-10-02",
  to = "2026-10-26",
) => ({
  from,
  to,
  value,
});

describe("seoClicksDrop", () => {
  it("reports a fall of 30 percent with the site, both counts and the measured scope and periods", () => {
    expect(seoClicksDrop(metrics(70, before(100)), NOW)).toEqual({
      site: "shop.example",
      clicksFrom: 100,
      clicksTo: 70,
      event:
        "sc-domain:shop.example:shop.example:2026-10-02:2026-10-26:2026-10-27:2026-11-20",
    });
  });

  it("reports a fall to zero clicks", () => {
    expect(seoClicksDrop(metrics(0, before(50)), NOW)).toMatchObject({
      clicksFrom: 50,
      clicksTo: 0,
    });
  });

  it.each([
    ["a fall below 30 percent", metrics(71, before(100))],
    ["a rise", metrics(140, before(100))],
    ["an earlier period under 50 clicks", metrics(0, before(49))],
    ["partial coverage", metrics(60, before(100), { coverage: "partial" })],
    [
      "7 current days against 25 earlier days",
      metrics(60, before(100), { from: "2026-11-14" }),
    ],
    [
      "two equal periods under 7 days",
      metrics(60, before(100, "2026-11-09", "2026-11-14"), {
        from: "2026-11-15",
      }),
    ],
    [
      "a current period that ends on a day Google had not settled",
      metrics(60, before(100, "2026-10-04", "2026-10-28"), {
        from: "2026-10-29",
        to: "2026-11-22",
      }),
    ],
    [
      "a cached read that Google answered before the days were settled",
      metrics(60, before(100), { collectedAt: "2026-11-22T09:00:00.000Z" }),
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
    expect(seoClicksDrop(row, NOW)).toBeNull();
  });

  it("has no alert for a period that ended more than 10 days ago, also when it was synced today", () => {
    const row = metrics(60, before(100), {
      observedAt: "2026-12-01T09:00:00.000Z",
    });
    expect(
      seoClicksDrop(row, new Date("2026-11-30T12:00:00.000Z")),
    ).not.toBeNull();
    expect(seoClicksDrop(row, new Date("2026-12-01T12:00:00.000Z"))).toBeNull();
  });
});

describe("newestSeoClicksRow", () => {
  const web = metrics(60, before(100));
  const discover = metrics(0, before(100), { searchType: "discover" });
  const otherSite = metrics(0, before(100), {
    propertyId: "sc-domain:blog.example",
    pageUrls: ["https://blog.example/"],
  });

  it("finds the web search row behind 10 newer Discover rows", () => {
    expect(
      newestSeoClicksRow([...Array(10).fill(discover), web], "shop.example"),
    ).toEqual(web);
  });

  it("passes over a newer sync of another site of the same collection", () => {
    expect(newestSeoClicksRow([otherSite, web], "shop.example")).toEqual(web);
    expect(newestSeoClicksRow([otherSite], "shop.example")).toBeUndefined();
  });

  it("passes over a row that also measures a page of another site", () => {
    const mixed = metrics(0, before(100), {
      pageUrls: ["https://shop.example/", "https://blog.example/"],
    });
    expect(newestSeoClicksRow([mixed], "shop.example")).toBeUndefined();
  });

  it("reads the www host as the same site", () => {
    expect(newestSeoClicksRow([web], "www.shop.example")).toEqual(web);
  });

  it("keeps the event of two sites apart, so one cannot suppress the other", () => {
    expect(seoClicksDrop(web, NOW)?.event).not.toBe(
      seoClicksDrop({ ...otherSite, metrics: web.metrics }, NOW)?.event,
    );
  });
});
