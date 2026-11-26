import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ snapshot: vi.fn() }));
vi.mock("@/lib/db/prisma", () => ({
  default: {
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
});
