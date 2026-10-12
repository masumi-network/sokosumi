import { describe, expect, it } from "vitest";
import {
  socialPostEngagementRate,
  socialPostInteractions,
  summarizeSocialPostEngagement,
} from "./social-post-engagement";

const empty = {
  views: null,
  impressions: null,
  likes: null,
  comments: null,
  shares: null,
  saves: null,
};

describe("social post engagement", () => {
  it("omits YouTube shares and still totals likes and comments", () => {
    expect(
      socialPostInteractions({
        provider: "youtube",
        metrics: { ...empty, views: 20, likes: 2, comments: 1 },
      }),
    ).toBe(3);
    expect(
      socialPostEngagementRate({
        provider: "youtube",
        metrics: { ...empty, views: 20, likes: 2, comments: 1 },
      }),
    ).toBe(15);
  });

  it("treats a missing share on a provider that reports shares as unavailable", () => {
    expect(
      socialPostInteractions({
        provider: "tiktok",
        metrics: { ...empty, views: 20, likes: 2, comments: 1 },
      }),
    ).toBeNull();
  });

  it("keeps a measured zero distinct from an omitted YouTube share", () => {
    expect(
      socialPostInteractions({
        provider: "youtube",
        metrics: { ...empty, likes: 0, comments: 0, shares: 0 },
      }),
    ).toBe(0);
    expect(
      summarizeSocialPostEngagement([
        {
          provider: "youtube",
          metrics: { ...empty, likes: 1, comments: 1 },
        },
        {
          provider: "x",
          metrics: { ...empty, likes: 1, comments: 1, shares: null },
          additionalMetrics: [
            { key: "quote_count", value: 1, period: "lifetime", unit: "count" },
          ],
        },
      ]),
    ).toEqual({
      postCount: 2,
      measuredInteractionCount: 1,
      interactions: 2,
      engagementRates: [null, null],
    });
  });
});
