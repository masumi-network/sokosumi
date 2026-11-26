import { describe, expect, it } from "vitest";

import {
  getCmoCompetitorsForProjectResponseTransformer,
  getProjectsByIdAdsAccountsByAccountIdCampaignsByCampaignIdResponseTransformer,
  getProjectsByIdAdsMarketAdsResponseTransformer,
  getProjectsByIdAdsMarketResponseTransformer,
  getProjectsByIdCalendarResponseTransformer,
  getProjectsByIdSocialPostsByPostIdResponseTransformer,
  getSeoAuditWorkspaceResponseTransformer,
  getStudioComparePairResponseTransformer,
  getWorkspacesCalendarResponseTransformer,
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
  it("Studio compare: an exhausted batch keeps its pair null", async () => {
    const result = await getStudioComparePairResponseTransformer({
      data: { pair: null },
      meta,
    });

    expect(result.data.pair).toBeNull();
    expect(result.meta.timestamp).toBeInstanceOf(Date);
  });

  it("Studio compare: a pair revives both asset dates", async () => {
    const result = await getStudioComparePairResponseTransformer({
      data: {
        pair: {
          a: { createdAt: meta.timestamp, sourceJob: null },
          b: { createdAt: meta.timestamp, sourceJob: null },
        },
      },
      meta,
    });

    expect(result.data.pair?.a.createdAt).toBeInstanceOf(Date);
    expect(result.data.pair?.b.createdAt).toBeInstanceOf(Date);
  });

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

it.each([null, { observedAt: meta.timestamp, rows: [] }])(
  "keeps an SEO workspace without saved query rows readable (%j)",
  async (searchQueries) => {
    const empty = {
      pages: [],
      observations: [],
      keywords: [],
      competitors: [],
      findings: [],
      actions: [],
      metrics: [],
      timeline: [],
      analyses: [],
      monitors: [],
    };
    const result = await getSeoAuditWorkspaceResponseTransformer({
      // The speed table is a nullable object with a date as well.
      // Its own object: the search queries' transformer changes its object in place.
      data: {
        ...empty,
        searchQueries,
        siteSpeed: searchQueries && { ...searchQueries },
      },
      meta: { ...meta },
    });
    expect(result.data.siteSpeed?.observedAt ?? null).toEqual(
      searchQueries && new Date(meta.timestamp),
    );
    if (searchQueries)
      expect(result.data.searchQueries?.observedAt).toEqual(
        new Date(meta.timestamp),
      );
    else expect(result.data.searchQueries).toBeNull();
  },
);

it.each([
  getWorkspacesCalendarResponseTransformer,
  getProjectsByIdCalendarResponseTransformer,
])(
  "revives a Soko Bot run's originalAt on the Calendar (%#)",
  async (transform) => {
    const result = await transform({
      data: [
        {
          kind: "sokoBotRun",
          scheduledAt: "2030-01-03T14:00:00.000Z",
          originalAt: "2030-01-04T09:00:00.000Z",
        },
      ],
      meta: { ...meta },
    });
    expect(result.data[0]?.scheduledAt).toEqual(
      new Date("2030-01-03T14:00:00.000Z"),
    );
    expect(result.data[0]?.originalAt).toEqual(
      new Date("2030-01-04T09:00:00.000Z"),
    );
  },
);

it("keeps a scoreboard cell without data null and revives the rest of the Competitors page", async () => {
  const cell = {
    value: 12,
    sourceUrl: "https://www.instagram.com/calendly/",
    observedAt: meta.timestamp,
  };
  const row = {
    competitorId: null,
    name: "cal.com",
    postsPerWeek: null,
    engagementPerPost: null,
    followers: null,
    followerGrowth: null,
  };
  const result = await getCmoCompetitorsForProjectResponseTransformer({
    data: {
      competitors: [],
      feed: null,
      limit: 5,
      signals: [],
      scoreboard: [row, { ...row, name: "Calendly", followers: cell }],
      topPosts: [],
      check: { lastCheckedAt: null, nextCheckAt: null },
    },
    meta: { ...meta },
  });
  expect(result.data.feed).toBeNull();
  expect(result.data.scoreboard[0]?.followers).toBeNull();
  expect(result.data.scoreboard[1]?.followers?.observedAt).toEqual(
    new Date(meta.timestamp),
  );
  expect(result.data.check.lastCheckedAt).toBeNull();
});
