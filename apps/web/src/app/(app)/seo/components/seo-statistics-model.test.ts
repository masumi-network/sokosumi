import type { ProjectSeoMetric } from "@sokosumi/core-client";
import { describe, expect, it } from "vitest";
import {
  invalidSeoStatisticsPeriod,
  latestSeoMeasurements,
  savedSeoStatistics,
  seoStatisticsPeriod,
} from "./seo-statistics-model";

function metric(change: Partial<ProjectSeoMetric> = {}): ProjectSeoMetric {
  return {
    id: "views",
    key: "page_views",
    label: "Page views",
    unit: "count",
    source: "ga4",
    propertyId: "properties/123",
    value: 100,
    from: "2026-10-01",
    to: "2026-10-28",
    timeZone: "UTC",
    channel: "all",
    observedAt: new Date("2026-10-29T10:00:00Z"),
    coverage: "complete",
    points: [],
    notes: [],
    ...change,
  };
}

describe("SEO statistics presentation", () => {
  it("keeps one source snapshot without mixing old periods, properties or organic totals", () => {
    const latest = metric();
    const users = metric({ id: "users", key: "active_users" });
    const otherSource = metric({
      id: "clicks",
      source: "search_console",
      propertyId: "sc-domain:example.com",
    });
    expect(
      latestSeoMeasurements([
        metric({
          id: "old-period",
          observedAt: new Date("2026-10-28T10:00:00Z"),
          from: "2026-09-01",
        }),
        latest,
        users,
        otherSource,
        metric({ id: "other-property", propertyId: "properties/456" }),
        metric({ id: "organic", channel: "organic" }),
      ]).map((item) => item.id),
    ).toEqual(["views", "users", "clicks"]);
    expect(savedSeoStatistics([latest])).toMatchObject({
      source: "ga4",
      propertyId: "properties/123",
    });
  });

  it("returns complete UTC days across month and leap-day boundaries", () => {
    expect(seoStatisticsPeriod(7, new Date("2024-03-02T00:01:00Z"))).toEqual({
      from: "2024-02-24",
      to: "2024-03-01",
    });
    expect(invalidSeoStatisticsPeriod("2026-11-05", "2026-11-04")).toBe(true);
    expect(invalidSeoStatisticsPeriod("bad-date", "2026-11-04")).toBe(true);
    expect(invalidSeoStatisticsPeriod("2026-11-04", "2026-11-04")).toBe(false);
  });
});
