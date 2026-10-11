import { describe, expect, it } from "vitest";
import {
  buildSocialPerformanceHeadline,
  postInteractions,
} from "./social-performance-headline";

function post(
  overrides: Partial<
    Parameters<typeof buildSocialPerformanceHeadline>[0]["posts"][number]
  > & {
    provider?: "x" | "instagram" | "facebook";
  } = {},
) {
  return {
    provider: overrides.provider ?? "facebook",
    publishedAt: overrides.publishedAt ?? "2026-10-08T12:00:00.000Z",
    metrics: {
      views: 10,
      impressions: 20,
      likes: 2,
      comments: 1,
      shares: 1,
      saves: 0,
      ...overrides.metrics,
    },
    additionalMetrics: overrides.additionalMetrics ?? [],
  };
}

describe("postInteractions", () => {
  it("keeps a post out of the total when any numerator is missing", () => {
    expect(
      postInteractions(
        post({
          metrics: {
            likes: 2,
            comments: null,
            shares: 1,
            saves: 0,
            views: 1,
            impressions: 1,
          },
        }),
      ),
    ).toBeNull();
  });

  it("adds Instagram saves and X quotes only when every part is measured", () => {
    expect(
      postInteractions(
        post({
          provider: "instagram",
          metrics: {
            likes: 2,
            comments: 1,
            shares: 1,
            saves: 3,
            views: 1,
            impressions: 1,
          },
        }),
      ),
    ).toBe(7);
    expect(
      postInteractions(
        post({
          provider: "x",
          metrics: {
            likes: 2,
            comments: 1,
            shares: 1,
            saves: 9,
            views: 1,
            impressions: 1,
          },
          additionalMetrics: [{ key: "quotes", value: 4 }],
        }),
      ),
    ).toBe(8);
  });
});

describe("buildSocialPerformanceHeadline", () => {
  it("sums the current cohort and fills empty UTC days", () => {
    const headline = buildSocialPerformanceHeadline({
      posts: [
        post({ publishedAt: "2026-10-01T01:00:00.000Z" }),
        post({
          publishedAt: "2026-10-03T01:00:00.000Z",
          metrics: {
            views: 5,
            impressions: 5,
            likes: 1,
            comments: 0,
            shares: 0,
            saves: 0,
          },
        }),
      ],
      publishedFrom: new Date("2026-10-01T00:00:00.000Z"),
      publishedUntil: new Date("2026-10-03T23:59:59.999Z"),
    });
    expect(headline.current).toEqual({
      postCount: 2,
      views: 15,
      impressions: 25,
      interactions: 5,
    });
    expect(headline.daily.map((day) => [day.date, day.postCount])).toEqual([
      ["2026-10-01", 1],
      ["2026-10-02", 0],
      ["2026-10-03", 1],
    ]);
  });

  it("compares the equal previous window when a range is set", () => {
    const headline = buildSocialPerformanceHeadline({
      posts: [
        post({ publishedAt: "2026-10-08T12:00:00.000Z" }),
        post({
          publishedAt: "2026-10-07T12:00:00.000Z",
          metrics: {
            views: 100,
            impressions: 100,
            likes: 10,
            comments: 0,
            shares: 0,
            saves: 0,
          },
        }),
      ],
      publishedFrom: new Date("2026-10-08T00:00:00.000Z"),
      publishedUntil: new Date("2026-10-08T23:59:59.999Z"),
    });
    expect(headline.current.postCount).toBe(1);
    expect(headline.previous.postCount).toBe(1);
    expect(headline.deltas.views).toBe(-90);
  });

  it("omits deltas when the reader did not pick a publication range", () => {
    const headline = buildSocialPerformanceHeadline({
      posts: [post()],
    });
    expect(headline.current.postCount).toBe(1);
    expect(headline.deltas.views).toBeNull();
    expect(headline.previous.postCount).toBe(0);
  });
});
