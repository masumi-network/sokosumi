import { SOKO_BOT_TOOL_INPUT_SCHEMAS } from "@sokosumi/soko-bot";
import { describe, expect, it } from "vitest";

import {
  AD_RANGES,
  buildAdCampaign,
  completeDaysRange,
  fromMinorUnits,
  sumAdMetrics,
} from "./campaigns";

describe("completeDaysRange", () => {
  it("returns the last N complete UTC days, excluding today", () => {
    const now = new Date("2026-10-13T15:30:00.000Z");
    expect(completeDaysRange("LAST_7_DAYS", now)).toEqual({
      since: "2026-10-06",
      until: "2026-10-12",
    });
    expect(completeDaysRange("LAST_30_DAYS", now)).toEqual({
      since: "2026-09-13",
      until: "2026-10-12",
    });
  });
});

describe("fromMinorUnits", () => {
  it.each([
    [2550, "USD", 25.5],
    [1000, "EUR", 10],
    [5000, "JPY", 5000],
  ])("%i %s is %d", (amount, currency, expected) => {
    expect(fromMinorUnits(amount, currency)).toBe(expected);
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

describe("Soko Bot list_ad_campaigns", () => {
  // The bot's contract cannot import Core, so it lists the ranges itself.
  it.each(AD_RANGES)("accepts the %s range", (range) => {
    expect(
      SOKO_BOT_TOOL_INPUT_SCHEMAS.list_ad_campaigns.safeParse({
        projectId: "01960001-0001-7001-8001-000000000001",
        accountId: "01960001-0001-7001-8001-000000000002",
        range,
      }).success,
    ).toBe(true);
  });
});
