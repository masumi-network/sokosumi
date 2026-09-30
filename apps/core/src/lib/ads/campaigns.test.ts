import { describe, expect, it } from "vitest";

import {
  buildAdCampaign,
  fromMinorUnits,
  sumAdMetrics,
  toMinorUnits,
} from "./campaigns";

describe("fromMinorUnits", () => {
  it.each([
    [2550, "USD", 25.5],
    [1000, "EUR", 10],
    [5000, "JPY", 5000],
  ])("%i %s is %d", (amount, currency, expected) => {
    expect(fromMinorUnits(amount, currency)).toBe(expected);
  });
});

describe("toMinorUnits", () => {
  it.each([
    [25.5, "USD", 2550],
    [10, "EUR", 1000],
    [5000, "JPY", 5000],
    [19.99, "USD", 1999],
    [0.29, "USD", 29],
  ])("%d %s is %i", (amount, currency, expected) => {
    expect(toMinorUnits(amount, currency)).toBe(expected);
  });
});

describe("sumAdMetrics", () => {
  it("totals rows per campaign and keeps conversions null when unreported", () => {
    const totals = sumAdMetrics([
      { campaignId: "1", spend: 1, impressions: 10, clicks: 1, conversions: 1 },
      { campaignId: "1", spend: 2, impressions: 20, clicks: 2, conversions: 2 },
      {
        campaignId: "2",
        spend: 5,
        impressions: 5,
        clicks: 0,
        conversions: null,
      },
    ]);
    expect(totals.get("1")).toEqual({
      spend: 3,
      impressions: 30,
      clicks: 3,
      conversions: 3,
    });
    expect(totals.get("2")?.conversions).toBeNull();
  });
});

describe("buildAdCampaign", () => {
  it("rounds money and leaves ctr and cpc null without impressions or clicks", () => {
    expect(
      buildAdCampaign(
        {
          id: "1",
          name: "A",
          status: "ACTIVE",
          objective: null,
          dailyBudget: 1.125,
        },
        { spend: 2.349, impressions: 0, clicks: 0, conversions: null },
      ),
    ).toMatchObject({ dailyBudget: 1.13, spend: 2.35, ctr: null, cpc: null });
  });
});
