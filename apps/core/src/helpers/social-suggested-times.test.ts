import { describe, expect, it } from "vitest";
import {
  suggestBestPostingTimes,
  suggestedTimesLookbackStart,
} from "./social-suggested-times";

const empty = {
  views: null,
  impressions: 100,
  likes: 0,
  comments: 0,
  shares: 0,
  saves: null,
};

function xPost(publishedAt: string, likes: number) {
  return {
    provider: "x" as const,
    publishedAt,
    metrics: { ...empty, likes },
    additionalMetrics: [
      { key: "quote_count", value: 0, period: null, unit: null },
    ],
  };
}

/** Eight scored posts: four at 13:00 UTC, four at 18:00 UTC. */
function enoughHistory(likesAt13: number, likesAt18: number) {
  return [
    xPost("2026-09-01T13:00:00Z", likesAt13),
    xPost("2026-09-02T13:00:00Z", likesAt13),
    xPost("2026-09-03T13:00:00Z", likesAt13),
    xPost("2026-09-04T13:00:00Z", likesAt13),
    xPost("2026-09-01T18:00:00Z", likesAt18),
    xPost("2026-09-02T18:00:00Z", likesAt18),
    xPost("2026-09-03T18:00:00Z", likesAt18),
    xPost("2026-09-04T18:00:00Z", likesAt18),
  ];
}

const now = new Date("2026-10-01T12:00:00Z");

describe("suggestedTimesLookbackStart", () => {
  it("starts 90 days before now", () => {
    expect(suggestedTimesLookbackStart(now).toISOString()).toBe(
      "2026-07-03T12:00:00.000Z",
    );
  });
});

describe("suggestBestPostingTimes", () => {
  it("returns nothing when fewer than eight scored posts exist", () => {
    expect(
      suggestBestPostingTimes({
        now,
        timezone: "UTC",
        posts: enoughHistory(10, 4).slice(0, 7),
      }),
    ).toEqual([]);
  });

  it("returns nothing when engagement is unavailable", () => {
    expect(
      suggestBestPostingTimes({
        now,
        timezone: "UTC",
        posts: enoughHistory(10, 4).map((post) => ({
          ...post,
          metrics: { ...post.metrics, shares: null },
        })),
      }),
    ).toEqual([]);
  });

  it("returns nothing when only one hour has enough posts", () => {
    expect(
      suggestBestPostingTimes({
        now,
        timezone: "UTC",
        posts: [
          xPost("2026-09-01T13:00:00Z", 10),
          xPost("2026-09-02T13:00:00Z", 10),
          xPost("2026-09-03T13:00:00Z", 10),
          xPost("2026-09-04T13:00:00Z", 10),
          xPost("2026-09-05T13:00:00Z", 10),
          xPost("2026-09-06T13:00:00Z", 10),
          xPost("2026-09-07T13:00:00Z", 10),
          xPost("2026-09-05T09:00:00Z", 50),
        ],
      }),
    ).toEqual([]);
  });

  it("ranks hours by average interactions, then post count, then hour", () => {
    expect(
      suggestBestPostingTimes({
        now,
        timezone: "UTC",
        posts: [
          ...enoughHistory(10, 4),
          xPost("2026-09-05T08:00:00Z", 20),
          xPost("2026-09-06T08:00:00Z", 20),
        ],
      }),
    ).toEqual([8, 13, 18]);
  });

  it("keeps at most three hours and reads them in the viewer timezone", () => {
    expect(
      suggestBestPostingTimes({
        now,
        timezone: "America/New_York",
        posts: [
          ...enoughHistory(3, 12),
          xPost("2026-09-05T22:00:00Z", 8),
          xPost("2026-09-06T22:00:00Z", 8),
          xPost("2026-09-05T11:00:00Z", 1),
          xPost("2026-09-06T11:00:00Z", 1),
        ],
      }),
    ).toEqual([14, 18, 9]);
  });

  it("ignores posts outside the lookback and posts without a published time", () => {
    expect(
      suggestBestPostingTimes({
        now,
        timezone: "UTC",
        posts: [
          ...enoughHistory(10, 4),
          xPost("2026-04-01T13:00:00Z", 100),
          { ...xPost("2026-09-05T13:00:00Z", 100), publishedAt: null },
        ],
      }),
    ).toEqual([13, 18]);
  });
});
