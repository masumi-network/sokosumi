import { describe, expect, it } from "vitest";
import { buildSocialPerformanceConsistency } from "./social-performance-consistency";

const metrics = {
  views: null,
  impressions: 10,
  likes: 1,
  comments: 1,
  shares: 1,
  saves: null,
};

describe("social performance consistency", () => {
  it("starts at the first published UTC day and fills gaps through today", () => {
    const result = buildSocialPerformanceConsistency({
      now: new Date("2026-10-04T15:00:00Z"),
      posts: [
        {
          provider: "x",
          publishedAt: "2026-10-01T12:00:00Z",
          metrics,
          additionalMetrics: [
            { key: "quotes", value: 1, period: null, unit: null },
          ],
        },
        {
          provider: "x",
          publishedAt: "2026-10-03T08:00:00Z",
          metrics,
          additionalMetrics: [
            { key: "quotes", value: 0, period: null, unit: null },
          ],
        },
      ],
    });
    expect(result.from).toBe("2026-10-01");
    expect(result.until).toBe("2026-10-04");
    expect(result.daily.map((day) => day.date)).toEqual([
      "2026-10-01",
      "2026-10-02",
      "2026-10-03",
      "2026-10-04",
    ]);
    expect(result.daily[0]).toMatchObject({ postCount: 1, interactions: 4 });
    expect(result.daily[1]).toMatchObject({ postCount: 0, interactions: 0 });
    expect(result.daily[2]).toMatchObject({ postCount: 1, interactions: 3 });
  });

  it("keeps an unmeasured day as null engagement, not zero", () => {
    const result = buildSocialPerformanceConsistency({
      now: new Date("2026-10-01T12:00:00Z"),
      posts: [
        {
          provider: "instagram",
          publishedAt: "2026-10-01T08:00:00Z",
          metrics: { ...metrics, saves: null },
        },
      ],
    });
    expect(result.daily[0]?.interactions).toBeNull();
  });

  it("returns an empty series when nothing is published in the window", () => {
    expect(
      buildSocialPerformanceConsistency({
        now: new Date("2026-10-10T00:00:00Z"),
        posts: [
          {
            provider: "x",
            publishedAt: "2024-01-01T00:00:00Z",
            metrics,
          },
        ],
      }),
    ).toEqual({ from: null, until: null, daily: [] });
  });
});
