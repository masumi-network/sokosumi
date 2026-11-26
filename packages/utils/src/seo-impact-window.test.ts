import { describe, expect, it } from "vitest";
import {
  type SeoImpactSeries,
  seoActionImpact,
  seoImpactAnchor,
  seoImpactPercent,
  seoImpactTotals,
  seoImpactWindows,
} from "./seo-impact-window.js";

function shift(date: string, days: number) {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000)
    .toISOString()
    .slice(0, 10);
}

/** One row per day, with the days in `skip` left out as Search Console does for a day without impressions. */
function series(
  from: string,
  to: string,
  day: { clicks: number; impressions: number; position: number },
  skip: string[] = [],
): SeoImpactSeries {
  const days = [];
  for (let date = from; date <= to; date = shift(date, 1))
    if (!skip.includes(date)) days.push({ date, ...day });
  return { from, to, days };
}

describe("seoImpactAnchor", () => {
  it("uses the completion when the verification is earlier or missing", () => {
    expect(
      seoImpactAnchor({
        completedAt: "2026-06-10T12:00:00.000Z",
        verifiedAt: "2026-06-02T12:00:00.000Z",
      }),
    ).toEqual({ anchor: "2026-06-10", anchorKind: "completed" });
    expect(
      seoImpactAnchor({ completedAt: "2026-06-10T12:00:00.000Z" }),
    ).toEqual({ anchor: "2026-06-10", anchorKind: "completed" });
  });

  it("falls back to the verification of a fix whose Task is still open", () => {
    expect(seoImpactAnchor({ verifiedAt: "2026-06-02T12:00:00.000Z" })).toEqual(
      { anchor: "2026-06-02", anchorKind: "verified" },
    );
    expect(seoImpactAnchor({})).toBeNull();
  });

  it("dates the anchor in Search Console's Pacific calendar", () => {
    expect(
      seoImpactAnchor({ completedAt: "2026-06-10T03:00:00.000Z" })?.anchor,
    ).toBe("2026-06-09");
  });
});

describe("seoImpactWindows", () => {
  it("crosses a month and a year edge and leaves the anchor day out", () => {
    expect(seoImpactWindows("2027-01-05")).toEqual({
      before: { from: "2026-12-08", to: "2027-01-04" },
      after: { from: "2027-01-06", to: "2027-02-02" },
    });
  });

  it("counts the leap day of February", () => {
    expect(seoImpactWindows("2028-02-15").after).toEqual({
      from: "2028-02-16",
      to: "2028-03-14",
    });
  });
});

describe("seoImpactTotals", () => {
  const window = { from: "2026-12-30", to: "2027-01-02" };

  it("counts a missing day as zero and weights the position by impressions", () => {
    const totals = seoImpactTotals(
      [
        {
          from: "2026-12-01",
          to: "2027-01-31",
          days: [
            { date: "2026-12-30", clicks: 2, impressions: 10, position: 4 },
            { date: "2027-01-02", clicks: 1, impressions: 30, position: 8 },
            { date: "2027-01-03", clicks: 9, impressions: 90, position: 1 },
          ],
        },
      ],
      window,
    );
    expect(totals).toEqual({
      ...window,
      clicks: 3,
      impressions: 40,
      position: 7,
    });
  });

  it("gives no totals when a day of the window is outside every series", () => {
    expect(
      seoImpactTotals(
        [
          series("2026-12-30", "2027-01-01", {
            clicks: 1,
            impressions: 5,
            position: 3,
          }),
        ],
        window,
      ),
    ).toBeNull();
  });

  it("joins two reads and lets the newest read of a day win", () => {
    const totals = seoImpactTotals(
      [
        series("2027-01-01", "2027-01-02", {
          clicks: 5,
          impressions: 50,
          position: 2,
        }),
        series("2026-12-30", "2027-01-01", {
          clicks: 1,
          impressions: 10,
          position: 2,
        }),
      ],
      window,
    );
    expect(totals?.clicks).toBe(12);
  });
});

describe("seoImpactPercent", () => {
  it("gives no percent when either count is low", () => {
    expect(seoImpactPercent(29, 300)).toBeNull();
    expect(seoImpactPercent(300, 29)).toBeNull();
    expect(seoImpactPercent(0, 0)).toBeNull();
  });

  it("gives the rounded change at the threshold", () => {
    expect(seoImpactPercent(30, 45)).toBe(50);
    expect(seoImpactPercent(40, 30)).toBe(-25);
  });
});

describe("seoActionImpact", () => {
  const action = { completedAt: "2026-06-10T12:00:00.000Z" };
  const busy = { clicks: 3, impressions: 40, position: 5 };
  const full = [series("2026-04-01", "2026-07-31", busy)];

  it("is too early until the whole after-window is settled", () => {
    // The after-window ends on 2026-07-08; Search Console settles it 3 days later.
    const early = seoActionImpact(
      action,
      full,
      new Date("2026-07-10T23:00:00Z"),
    );
    expect(early).toMatchObject({ state: "too_early", after: null });
    expect(early?.before?.clicks).toBe(84);
    expect(
      seoActionImpact(action, full, new Date("2026-07-11T12:00:00Z"))?.state,
    ).toBe("measured");
  });

  it("uses the window length the caller asks for", () => {
    // 7 days after 2026-06-10 end on 2026-06-17 and settle on 2026-06-20, while 28 days are still open.
    const now = new Date("2026-06-21T12:00:00Z");
    expect(seoActionImpact(action, full, now, 7)).toMatchObject({
      days: 7,
      state: "measured",
      before: { from: "2026-06-03", to: "2026-06-09", clicks: 21 },
      after: { from: "2026-06-11", to: "2026-06-17", clicks: 21 },
    });
    expect(seoActionImpact(action, full, now)?.state).toBe("too_early");
  });

  it("is not measured when no read of the page covers the after-window", () => {
    expect(
      seoActionImpact(
        action,
        [series("2026-04-01", "2026-06-20", busy)],
        new Date("2026-08-01T00:00:00Z"),
      ),
    ).toMatchObject({ state: "not_measured", after: null });
  });

  it("flags low counts instead of a measured change", () => {
    const quiet = [
      series("2026-04-01", "2026-07-31", {
        clicks: 0,
        impressions: 1,
        position: 9,
      }),
    ];
    expect(
      seoActionImpact(action, quiet, new Date("2026-08-01T00:00:00Z")),
    ).toMatchObject({
      state: "low_counts",
      before: { impressions: 28 },
      after: { impressions: 28 },
    });
  });

  it("measures both windows with a day missing from the rows", () => {
    const gap = [series("2026-04-01", "2026-07-31", busy, ["2026-06-15"])];
    expect(
      seoActionImpact(action, gap, new Date("2026-08-01T00:00:00Z")),
    ).toMatchObject({
      anchor: "2026-06-10",
      days: 28,
      state: "measured",
      before: { from: "2026-05-13", to: "2026-06-09", clicks: 84 },
      after: { from: "2026-06-11", to: "2026-07-08", clicks: 81 },
    });
  });
});
