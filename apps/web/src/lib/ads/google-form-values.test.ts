import type { AdCampaignDetails } from "@sokosumi/core-client";
import { describe, expect, it } from "vitest";

import {
  EMPTY_GOOGLE_VALUES,
  googleFormValuesFromDetails,
} from "./google-form-values";

const TOTALS = {
  spend: 0,
  impressions: 0,
  clicks: 0,
  ctr: null,
  cpc: null,
  conversions: 0,
};

const BASE: AdCampaignDetails = {
  campaign: {
    id: "42",
    name: "Spring sale",
    status: "PAUSED",
    type: "SEARCH",
    channelType: "SEARCH",
    dailyBudget: 25.5,
    currency: "EUR",
    biddingStrategyType: "TARGET_SPEND",
    startDate: "2026-11-01",
    endDate: "2026-11-30",
    started: false,
    editable: true,
    notEditableReason: null,
  },
  targeting: {
    locations: [
      {
        id: "1003854",
        name: "Munich",
        canonicalName: "Munich,Bavaria,Germany",
        targetType: "City",
        countryCode: "DE",
      },
    ],
    languages: [{ id: "1001", code: "de", name: "German" }],
  },
  keywords: [
    {
      id: "1",
      text: "running shoes",
      matchType: "BROAD",
      status: "ENABLED",
      approvalStatus: null,
    },
    {
      id: "2",
      text: "trail shoes",
      matchType: "PHRASE",
      status: "ENABLED",
      approvalStatus: null,
    },
    {
      id: "3",
      text: "buy shoes",
      matchType: "EXACT",
      status: "ENABLED",
      approvalStatus: null,
    },
  ],
  ad: {
    id: "9",
    status: "ENABLED",
    approvalStatus: null,
    reviewStatus: null,
    adStrength: null,
    finalUrl: "https://example.com/shoes",
    search: {
      headlines: ["One", "Two", "Three"],
      descriptions: ["First line", "Second line"],
      path1: "shoes",
      path2: null,
    },
  },
  sitelinks: [
    {
      assetId: "s1",
      text: "Sale",
      finalUrl: "https://example.com/sale",
      description1: "Up to 50% off",
      description2: null,
      approvalStatus: null,
    },
  ],
  callouts: [{ assetId: "c1", text: "Free delivery", approvalStatus: null }],
  performance: { totals: TOTALS, daily: [] },
};

describe("googleFormValuesFromDetails", () => {
  it("fills a Search campaign: Google keyword syntax, sitelinks and callouts", () => {
    expect(googleFormValuesFromDetails(BASE)).toEqual({
      ...EMPTY_GOOGLE_VALUES,
      type: "SEARCH",
      name: "Spring sale",
      dailyBudget: "25.5",
      startDate: "2026-11-01",
      endDate: "2026-11-30",
      locations: [
        { id: "1003854", name: "Munich", detail: "Munich, Bavaria, Germany" },
      ],
      languages: [{ id: "1001", name: "German" }],
      finalUrl: "https://example.com/shoes",
      keywords: 'running shoes\n"trail shoes"\n[buy shoes]',
      path1: "shoes",
      path2: "",
      headlines: ["One", "Two", "Three"],
      descriptions: ["First line", "Second line"],
      sitelinks: [
        {
          text: "Sale",
          finalUrl: "https://example.com/sale",
          description1: "Up to 50% off",
          description2: "",
        },
      ],
      callouts: ["Free delivery"],
    });
  });

  it("turns unset dates and targeting into empty fields", () => {
    const values = googleFormValuesFromDetails({
      ...BASE,
      campaign: { ...BASE.campaign, startDate: null, endDate: null },
      targeting: { locations: [], languages: [] },
    });

    expect(values.startDate).toBe("");
    expect(values.endDate).toBe("");
    expect(values.locations).toEqual([]);
    expect(values.languages).toEqual([]);
  });

  it("fills a Display campaign with its images kept", () => {
    const values = googleFormValuesFromDetails({
      ...BASE,
      campaign: { ...BASE.campaign, type: "DISPLAY", channelType: "DISPLAY" },
      keywords: [],
      sitelinks: [],
      callouts: [],
      ad: {
        id: "10",
        status: "ENABLED",
        approvalStatus: null,
        reviewStatus: null,
        adStrength: null,
        finalUrl: "https://example.com/shoes",
        display: {
          businessName: "Shoe Shop",
          headlines: ["Run further"],
          longHeadline: "Run further in shoes made for the trail",
          descriptions: ["Find your next pair."],
          images: [
            {
              assetId: "a1",
              role: "LANDSCAPE",
              url: "https://tpc.googlesyndication.com/a1.png",
              width: 1200,
              height: 628,
            },
          ],
        },
      },
    });

    expect(values).toMatchObject({
      type: "DISPLAY",
      finalUrl: "https://example.com/shoes",
      businessName: "Shoe Shop",
      displayHeadlines: ["Run further"],
      longHeadline: "Run further in shoes made for the trail",
      displayDescriptions: ["Find your next pair."],
      images: [
        {
          assetId: "a1",
          role: "LANDSCAPE",
          url: "https://tpc.googlesyndication.com/a1.png",
        },
      ],
      keywords: "",
    });
  });

  it("starts from the empty form when the campaign has no ad", () => {
    const values = googleFormValuesFromDetails({ ...BASE, ad: null });

    expect(values.finalUrl).toBe("");
    expect(values.headlines).toEqual(EMPTY_GOOGLE_VALUES.headlines);
  });
});
