import { describe, expect, it } from "vitest";

import {
  socialPostMetricsSchema,
  socialPostStatisticsQuerySchema,
} from "./social-post-statistics.schema";

const metrics = {
  views: 1,
  impressions: 2,
  likes: 3,
  comments: 4,
  shares: 0,
  saves: null,
};

describe("socialPostMetricsSchema", () => {
  it("accepts measured zeros and omitted saves", () => {
    expect(socialPostMetricsSchema.parse(metrics)).toEqual(metrics);
  });

  it("rejects a negative count", () => {
    expect(
      socialPostMetricsSchema.safeParse({ ...metrics, likes: -1 }).success,
    ).toBe(false);
  });
});

describe("socialPostStatisticsQuerySchema", () => {
  it("defaults the page size", () => {
    expect(socialPostStatisticsQuerySchema.parse({})).toMatchObject({
      limit: 20,
    });
  });

  it("rejects a page larger than 100", () => {
    expect(
      socialPostStatisticsQuerySchema.safeParse({ limit: 101 }).success,
    ).toBe(false);
  });

  it("rejects an unknown provider", () => {
    expect(
      socialPostStatisticsQuerySchema.safeParse({ provider: "twitter" })
        .success,
    ).toBe(false);
  });

  it("rejects a range whose start is after its end", () => {
    expect(
      socialPostStatisticsQuerySchema.safeParse({
        publishedFrom: "2026-10-08T12:00:00.000Z",
        publishedUntil: "2026-10-08T11:59:59.000Z",
      }).success,
    ).toBe(false);
  });

  it("accepts equal publication bounds", () => {
    const at = "2026-10-08T12:00:00.000Z";
    expect(
      socialPostStatisticsQuerySchema.safeParse({
        publishedFrom: at,
        publishedUntil: at,
      }).success,
    ).toBe(true);
  });
});
