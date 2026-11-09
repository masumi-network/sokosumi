import type { ProjectSeoMetric } from "@sokosumi/core-client";
import { describe, expect, it } from "vitest";
import {
  seoPeriodChange,
  seoRarelyShown,
  seoWeekOverWeek,
} from "./seo-performance-model";

function metric(
  key: string,
  unit: ProjectSeoMetric["unit"],
  values: (number | null)[],
): ProjectSeoMetric {
  return {
    id: key,
    key,
    label: key,
    unit,
    source: "search_console",
    propertyId: "sc-domain:example.com",
    channel: "organic",
    value: null,
    from: "2026-10-01",
    to: "2026-10-14",
    timeZone: "America/Los_Angeles",
    observedAt: new Date("2026-10-15T00:00:00Z"),
    coverage: "partial",
    notes: [],
    points: values.map((value, index) => ({
      date: `2026-10-${String(index + 1).padStart(2, "0")}`,
      value,
    })),
  };
}

const twoWeeks = (week1: number, week2: number) => [
  ...Array(7).fill(week1),
  ...Array(7).fill(week2),
];

describe("seoWeekOverWeek", () => {
  it("compares the last 7 reported days with the 7 before", () => {
    const result = seoWeekOverWeek([
      metric("clicks", "count", twoWeeks(1, 2)),
      metric("impressions", "count", twoWeeks(10, 10)),
    ]);
    expect(result?.current).toEqual({ from: "2026-10-08", to: "2026-10-14" });
    expect(result?.values.clicks).toEqual({ current: 14, previous: 7 });
    expect(result?.values.impressions).toEqual({ current: 70, previous: 70 });
  });

  it("weights position by impressions and derives CTR from the sums", () => {
    const impressions = [...Array(7).fill(0), 9, 1, ...Array(5).fill(0)];
    const position = [...Array(7).fill(null), 2, 12, ...Array(5).fill(null)];
    const clicks = [...Array(7).fill(0), 1, 0, ...Array(5).fill(0)];
    const result = seoWeekOverWeek([
      metric("clicks", "count", clicks),
      metric("impressions", "count", impressions),
      metric(
        "ctr",
        "ratio",
        clicks.map(() => 0),
      ),
      metric("position", "position", position),
    ]);
    expect(result?.values.position?.current).toBeCloseTo(3);
    expect(result?.values.position?.previous).toBeNull();
    expect(result?.values.ctr).toEqual({ current: 0.1, previous: null });
  });

  it("leaves the earlier window unmeasured with fewer than 14 reported days", () => {
    expect(
      seoWeekOverWeek([metric("clicks", "count", Array(13).fill(1))])?.values
        .clicks,
    ).toEqual({ current: 7, previous: null });
    expect(seoWeekOverWeek([])).toBeNull();
  });

  it("does not compare a span with unreported days in it", () => {
    const sparse = Array(14).fill(null);
    sparse[0] = 5;
    sparse[13] = 5;
    expect(seoWeekOverWeek([metric("clicks", "count", sparse)])).toBeNull();
  });

  it("leaves a window with a missing day unmeasured instead of summing it lower", () => {
    const gap = twoWeeks(10, 10);
    gap[9] = null;
    gap[10] = null;
    const result = seoWeekOverWeek([metric("clicks", "count", gap)]);
    expect(result?.values.clicks).toEqual({ current: null, previous: 70 });
  });
});

describe("seoRarelyShown", () => {
  it("scales the weekly minimum with the period, never below one week", () => {
    const month = { from: "2026-10-12", to: "2026-11-07" };
    // 27 days need about 386 impressions.
    expect(seoRarelyShown(35, month)).toBe(true);
    expect(seoRarelyShown(300, month)).toBe(true);
    expect(seoRarelyShown(400, month)).toBe(false);
    // Two days still need one week's 100.
    const twoDays = { from: "2026-11-06", to: "2026-11-07" };
    expect(seoRarelyShown(99, twoDays)).toBe(true);
    expect(seoRarelyShown(100, twoDays)).toBe(false);
  });
});

describe("seoPeriodChange", () => {
  const totals = (
    key: string,
    unit: ProjectSeoMetric["unit"],
    value: number | null,
    previous: number | null | undefined,
  ): ProjectSeoMetric => ({
    ...metric(key, unit, []),
    value,
    ...(previous === undefined
      ? {}
      : {
          previous: { from: "2026-09-17", to: "2026-09-30", value: previous },
        }),
  });

  it("compares each total with the window before and names its length", () => {
    const changes = seoPeriodChange([
      totals("clicks", "count", 30, 12),
      totals("impressions", "count", 900, 400),
      totals("position", "position", 4.2, 6.1),
    ]);
    expect(changes.get("clicks")).toEqual({ previous: 12, days: 14 });
    expect(changes.get("position")).toEqual({ previous: 6.1, days: 14 });
  });

  it("drops the rate and position when either window had too few impressions", () => {
    const changes = seoPeriodChange([
      totals("clicks", "count", 3, 1),
      // 2 weeks need 200 impressions; the earlier window has 150.
      totals("impressions", "count", 900, 150),
      totals("ctr", "ratio", 0.01, 0.02),
      totals("position", "position", 4.2, 6.1),
    ]);
    expect([...changes.keys()]).toEqual(["clicks", "impressions"]);
  });

  it("gives no comparison when a side is missing or unmeasured", () => {
    const changes = seoPeriodChange([
      totals("clicks", "count", 30, undefined),
      totals("impressions", "count", 900, null),
      totals("sessions", "count", null, 4),
    ]);
    expect(changes.size).toBe(0);
  });
});
