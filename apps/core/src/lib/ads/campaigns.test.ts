import { SOKO_BOT_TOOL_INPUT_SCHEMAS } from "@sokosumi/soko-bot";
import { describe, expect, it } from "vitest";

import { googleCampaignSpecSchema } from "@/schemas/project-ad-account.schema";
import {
  AD_RANGES,
  buildAdCampaign,
  completeDaysRange,
  fromMinorUnits,
  GOOGLE_DISPLAY_IMAGE_ROLES,
  GOOGLE_KEYWORD_MATCH_TYPES,
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

describe("Soko Bot create_ad_campaign", () => {
  const botSchema = SOKO_BOT_TOOL_INPUT_SCHEMAS.create_ad_campaign;
  const common = {
    locationIds: ["1003854"],
    languageIds: ["1001"],
    finalUrl: "https://example.com/spring",
  };
  const search = {
    type: "SEARCH",
    ...common,
    keywords: GOOGLE_KEYWORD_MATCH_TYPES.map((matchType) => ({
      text: `shoes ${matchType.toLowerCase()}`,
      matchType,
    })),
    headlines: ["Run faster", "Light shoes", "Free returns"],
    descriptions: ["Shoes that carry you.", "Order today, run tomorrow."],
    sitelinks: [{ text: "Sale", finalUrl: "https://example.com/sale" }],
    callouts: ["Free shipping"],
  };
  const display = {
    type: "DISPLAY",
    ...common,
    businessName: "Sokosumi",
    headlines: ["Run faster"],
    longHeadline: "Light shoes that carry you further",
    descriptions: ["Order today, run tomorrow."],
  };
  const fileIds = [
    "01960001-0001-7001-8001-000000000041",
    "01960001-0001-7001-8001-000000000042",
    "01960001-0001-7001-8001-000000000043",
  ];
  const base = {
    projectId: "01960001-0001-7001-8001-000000000001",
    accountId: "01960001-0001-7001-8001-000000000002",
    name: "Spring",
    dailyBudget: 25,
  };

  // The bot's contract cannot import Core, so a spec the bot accepts must
  // stay one Core accepts once the bot's file ids are resolved to Drive refs.
  it("accepts the same Search spec as Core", () => {
    expect(botSchema.safeParse({ ...base, google: search }).success).toBe(true);
    expect(googleCampaignSpecSchema.safeParse(search).success).toBe(true);
    const unknownMatch = {
      ...search,
      keywords: [{ text: "a", matchType: "FUZZY" }],
    };
    expect(botSchema.safeParse({ ...base, google: unknownMatch }).success).toBe(
      false,
    );
  });

  it("accepts the same Display spec as Core, once images are resolved", () => {
    const roles = GOOGLE_DISPLAY_IMAGE_ROLES;
    const bot = {
      ...display,
      images: roles.map((role, index) => ({ fileId: fileIds[index], role })),
    };
    const core = {
      ...display,
      images: roles.map((role, index) => ({
        pathname: `drive/users/u/${index}.png`,
        fileUrl: `https://x.public.blob.vercel-storage.com/${index}.png`,
        name: `${index}.png`,
        size: 1000,
        mimeType: "image/png",
        role,
      })),
    };
    expect(botSchema.safeParse({ ...base, google: bot }).success).toBe(true);
    expect(googleCampaignSpecSchema.safeParse(core).success).toBe(true);
  });
});
