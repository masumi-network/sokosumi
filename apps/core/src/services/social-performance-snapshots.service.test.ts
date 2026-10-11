import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ posts: vi.fn(), snapshot: vi.fn() }));
vi.mock("@/lib/db/prisma", () => ({
  default: {
    socialAccountPost: { findMany: mocks.posts },
    socialPerformanceSnapshot: { upsert: mocks.snapshot },
  },
}));

import prisma from "@/lib/db/prisma";
import {
  listSocialPerformancePostObservations,
  readSocialPerformancePostInsights,
  recordSocialPerformanceSnapshot,
} from "./social-performance-snapshots.service";

const connectionId = "33333333-3333-4333-8333-333333333333";
const metrics = [
  { key: "followers", value: 15, unit: "count", period: "lifetime" },
];
const fetchedAt = new Date("2026-10-08T15:00:00Z");
const postRow = {
  id: "44444444-4444-4444-8444-444444444444",
  connectionId,
  externalId: "post-1",
  text: "Video",
  publishedAt: new Date("2026-10-01T12:00:00Z"),
  url: "https://www.youtube.com/watch?v=post-1",
  metrics: {
    views: 20,
    impressions: null,
    likes: 2,
    comments: 1,
    shares: null,
    saves: null,
  },
  additionalMetrics: [],
  fetchedAt,
  connection: { provider: "youtube" },
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.posts.mockResolvedValue([]);
});

describe("measured performance snapshots", () => {
  it("stores account metrics for the UTC day and never writes a postMetrics blob", async () => {
    await recordSocialPerformanceSnapshot(prisma, {
      connectionId,
      metrics,
      fetchedAt,
      profileFetchedAt: fetchedAt,
    });
    const call = mocks.snapshot.mock.calls[0][0];
    expect(call.create).toMatchObject({
      connectionId,
      date: new Date("2026-10-08T00:00:00Z"),
      metrics,
      fetchedAt,
      profileFetchedAt: fetchedAt,
    });
    expect(call.create).not.toHaveProperty("postMetrics");
    expect(call.update).not.toHaveProperty("postMetrics");
  });

  it("does not replace a measured profile with cached values during a history continuation", async () => {
    await recordSocialPerformanceSnapshot(prisma, {
      connectionId,
      metrics: null,
      fetchedAt,
      profileFetchedAt: null,
    });
    const call = mocks.snapshot.mock.calls[0][0];
    expect(call.create.metrics).toEqual([]);
    expect(call.update).not.toHaveProperty("metrics");
    expect(call.update).not.toHaveProperty("profileFetchedAt");
    expect(call.create.profileFetchedAt).toBeNull();
  });

  it("reads that day's post observations from SocialAccountPost, not a snapshot blob", async () => {
    mocks.posts.mockResolvedValue([postRow]);
    const posts = await listSocialPerformancePostObservations(prisma, {
      connectionId,
      fetchedAt,
    });
    expect(mocks.posts).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          connectionId,
          fetchedAt: {
            gte: new Date("2026-10-08T00:00:00Z"),
            lt: new Date("2026-10-09T00:00:00Z"),
          },
        },
      }),
    );
    expect(posts[0]).toMatchObject({
      externalId: "post-1",
      provider: "youtube",
      metrics: { views: 20, likes: 2, shares: null },
    });
  });

  it("computes YouTube engagement from posts without inventing shares", async () => {
    mocks.posts.mockResolvedValue([postRow]);
    const insights = await readSocialPerformancePostInsights(prisma, {
      connectionId,
      fetchedAt,
    });
    expect(insights.engagement).toEqual({
      postCount: 1,
      measuredInteractionCount: 1,
      interactions: 3,
      engagementRates: [15],
    });
  });
});
