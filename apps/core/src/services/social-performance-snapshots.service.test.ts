import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ posts: vi.fn(), snapshot: vi.fn() }));
vi.mock("@/lib/db/prisma", () => ({
  default: {
    socialAccountPost: { findMany: mocks.posts },
    socialPerformanceSnapshot: { upsert: mocks.snapshot },
  },
}));

import prisma from "@/lib/db/prisma";
import { recordSocialPerformanceSnapshot } from "./social-performance-snapshots.service";

const connectionId = "33333333-3333-4333-8333-333333333333";
const metrics = [
  { key: "followers", value: 15, unit: "count", period: "lifetime" },
];
const fetchedAt = new Date("2026-10-08T15:00:00Z");
beforeEach(() => {
  vi.clearAllMocks();
  mocks.posts.mockResolvedValue([]);
});
describe("measured performance snapshots", () => {
  it("keeps measured zero and missing counters distinct and captures only observations from that UTC day", async () => {
    mocks.posts.mockResolvedValue([
      {
        externalId: "post-1",
        metrics: {
          views: null,
          impressions: 20,
          likes: 0,
          comments: 0,
          shares: 0,
          saves: null,
        },
        additionalMetrics: [],
        fetchedAt,
      },
    ]);
    await recordSocialPerformanceSnapshot(prisma, {
      connectionId,
      metrics,
      fetchedAt,
      profileFetchedAt: fetchedAt,
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
    expect(mocks.snapshot.mock.calls[0][0].create).toMatchObject({
      metrics,
      postMetrics: [
        {
          externalId: "post-1",
          metrics: { views: null, likes: 0 },
          fetchedAt: fetchedAt.toISOString(),
        },
      ],
    });
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
});
