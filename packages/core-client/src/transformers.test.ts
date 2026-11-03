import { describe, expect, it } from "vitest";

import {
  getProjectsByIdAdsAccountsByAccountIdCampaignsByCampaignIdResponseTransformer,
  getProjectsByIdAdsMarketAdsResponseTransformer,
  getProjectsByIdAdsMarketResponseTransformer,
  getProjectsByIdSocialPostsByPostIdResponseTransformer,
  postProjectsByIdAdsConnectionsFinalizeResponseTransformer,
} from "./generated/transformers.gen.js";

const meta = { timestamp: "2026-10-01T00:00:00.000Z" };

it.each([null, { scheduledAt: meta.timestamp, account: null }])(
  "revives quote dates and keeps nullable quotes/accounts safe (%j)",
  async (quotedPost) => {
    const result = await getProjectsByIdSocialPostsByPostIdResponseTransformer({
      data: {
        createdAt: meta.timestamp,
        updatedAt: meta.timestamp,
        socialConnection: null,
        lastAttempt: null,
        threadParts: [],
        quotedPost,
      },
      meta: { ...meta },
    });
    expect(result.data.socialConnection).toBeNull();
    if (quotedPost) {
      expect(result.data.quotedPost?.scheduledAt).toEqual(
        new Date(meta.timestamp),
      );
      expect(result.data.quotedPost?.account).toBeNull();
    } else {
      expect(result.data.quotedPost).toBeNull();
    }
  },
);

it("revives X thread part dates and preserves unpublished parts", async () => {
  const result = await getProjectsByIdSocialPostsByPostIdResponseTransformer({
    data: {
      createdAt: meta.timestamp,
      updatedAt: meta.timestamp,
      socialConnection: null,
      lastAttempt: null,
      threadParts: [
        {
          position: 2,
          externalPostId: "1908",
          publishedAt: meta.timestamp,
          error: null,
        },
        {
          position: 3,
          externalPostId: null,
          publishedAt: null,
          error: "Rejected",
        },
      ],
    },
    meta,
  });
  expect(result.data.threadParts[0].publishedAt).toBeInstanceOf(Date);
  expect(result.data.threadParts[1]).toMatchObject({
    publishedAt: null,
    externalPostId: null,
    error: "Rejected",
  });
});

describe("generated response transformers keep nullable objects null-safe", () => {
  it("finalize ad connection: connection null (account reaches no ad accounts)", async () => {
    const result =
      await postProjectsByIdAdsConnectionsFinalizeResponseTransformer({
        data: { connection: null, availableAccounts: [] },
        meta,
      });

    expect(result.data.connection).toBeNull();
    expect(result.meta.timestamp).toBeInstanceOf(Date);
  });

  it("finalize ad connection: connection present has its date revived", async () => {
    const result =
      await postProjectsByIdAdsConnectionsFinalizeResponseTransformer({
        data: {
          connection: {
            id: "cccccccc-cccc-4ccc-cccc-cccccccccccc",
            provider: "google_ads",
            status: "active",
            createdAt: "2026-10-01T00:00:00.000Z",
          },
          availableAccounts: [],
        },
        meta,
      });

    expect(result.data.connection?.createdAt).toBeInstanceOf(Date);
  });

  it("ad market: profile null (nothing saved yet)", async () => {
    const result = await getProjectsByIdAdsMarketResponseTransformer({
      data: { profile: null },
      meta,
    });

    expect(result.data.profile).toBeNull();
  });

  it("ad market: profile present has its date revived", async () => {
    const result = await getProjectsByIdAdsMarketResponseTransformer({
      data: {
        profile: {
          keywords: ["shoes"],
          countryCode: "US",
          languageCode: "en",
          updatedAt: "2026-10-01T00:00:00.000Z",
        },
      },
      meta,
    });

    expect(result.data.profile?.updatedAt).toBeInstanceOf(Date);
  });

  it("ad market ads: fetchedAt null (no snapshot yet)", async () => {
    const result = await getProjectsByIdAdsMarketAdsResponseTransformer({
      data: { status: "gathering", ads: [], fetchedAt: null },
      meta,
    });

    expect(result.data.fetchedAt).toBeNull();
  });

  it("ad market ads: fetchedAt present has its date revived", async () => {
    const result = await getProjectsByIdAdsMarketAdsResponseTransformer({
      data: {
        status: "ready",
        ads: [],
        fetchedAt: "2026-10-01T11:00:00.000Z",
      },
      meta,
    });

    expect(result.data.fetchedAt).toBeInstanceOf(Date);
  });

  it("campaign details: ad null (none or several) stays null", async () => {
    const result =
      await getProjectsByIdAdsAccountsByAccountIdCampaignsByCampaignIdResponseTransformer(
        {
          data: {
            campaign: {
              id: "42",
              name: "Brand",
              status: "ACTIVE",
              type: "SEARCH",
              channelType: "SEARCH",
              dailyBudget: 1,
              currency: "EUR",
              biddingStrategyType: "MAXIMIZE_CLICKS",
              startDate: null,
              endDate: null,
              started: false,
              editable: false,
              notEditableReason: "AD_TYPE",
            },
            targeting: { locations: [], languages: [] },
            keywords: [],
            ad: null,
            sitelinks: [],
            callouts: [],
            performance: {
              totals: {
                spend: 0,
                impressions: 0,
                clicks: 0,
                conversions: 0,
              },
              daily: [],
            },
          },
          meta,
        },
      );

    expect(result.data.ad).toBeNull();
  });
});
