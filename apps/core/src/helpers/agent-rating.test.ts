import type { Prisma } from "@sokosumi/database";
import { describe, expect, it, vi } from "vitest";

import {
  calculateAgentRating,
  calculateAgentRatings,
  getAgentRatingDistribution,
  getRecentAgentReviews,
  getUserAgentReview,
  upsertUserAgentReview,
} from "./agent-rating";

describe("calculateAgentRating", () => {
  it("filters hidden ratings from public aggregates", async () => {
    const aggregate = vi.fn().mockResolvedValue({
      _count: { rating: 2 },
      _avg: { rating: 4.5 },
    });
    const tx = {
      userAgentRating: {
        aggregate,
      },
    } as unknown as Prisma.TransactionClient;

    const result = await calculateAgentRating("agent-1", tx);

    expect(aggregate).toHaveBeenCalledWith({
      where: {
        agentId: "agent-1",
        isHidden: false,
      },
      _count: { rating: true },
      _avg: { rating: true },
    });
    expect(result).toEqual({
      total: 2,
      average: 4.5,
    });
  });
});
describe("calculateAgentRatings", () => {
  it("filters hidden ratings from grouped aggregates", async () => {
    const groupBy = vi.fn().mockResolvedValue([
      {
        agentId: "agent-1",
        _count: { rating: 3 },
        _avg: { rating: 4 },
      },
    ]);
    const tx = {
      userAgentRating: {
        groupBy,
      },
    } as unknown as Prisma.TransactionClient;

    const result = await calculateAgentRatings(["agent-1", "agent-2"], tx);

    expect(groupBy).toHaveBeenCalledWith({
      by: ["agentId"],
      where: {
        agentId: { in: ["agent-1", "agent-2"] },
        isHidden: false,
      },
      _count: { rating: true },
      _avg: { rating: true },
    });
    expect(result).toEqual(
      new Map([
        [
          "agent-1",
          {
            total: 3,
            average: 4,
          },
        ],
        [
          "agent-2",
          {
            total: 0,
            average: null,
          },
        ],
      ]),
    );
  });

  it("returns zero defaults when only hidden ratings exist", async () => {
    const groupBy = vi.fn().mockResolvedValue([]);
    const tx = {
      userAgentRating: {
        groupBy,
      },
    } as unknown as Prisma.TransactionClient;

    const result = await calculateAgentRatings(["agent-1"], tx);

    expect(result).toEqual(
      new Map([
        [
          "agent-1",
          {
            total: 0,
            average: null,
          },
        ],
      ]),
    );
  });
});
describe("getAgentRatingDistribution", () => {
  it("fills every bucket and filters hidden ratings", async () => {
    const groupBy = vi.fn().mockResolvedValue([
      { rating: 5, _count: { rating: 3 } },
      { rating: 2, _count: { rating: 1 } },
    ]);
    const tx = {
      userAgentRating: {
        groupBy,
      },
    } as unknown as Prisma.TransactionClient;

    const result = await getAgentRatingDistribution("agent-1", tx);

    expect(groupBy).toHaveBeenCalledWith({
      by: ["rating"],
      where: {
        agentId: "agent-1",
        isHidden: false,
      },
      _count: { rating: true },
    });
    // Buckets with no ratings still report 0 — the response shape is fixed.
    expect(result).toEqual({ "1": 0, "2": 1, "3": 0, "4": 0, "5": 3 });
  });
});

describe("getRecentAgentReviews", () => {
  it("filters out ratings without meaningful comments", async () => {
    const findMany = vi.fn().mockResolvedValue([
      {
        id: "rating-1",
        rating: 5,
        comment: "Helpful review",
        createdAt: new Date("2026-03-17T10:00:00.000Z"),
        updatedAt: new Date("2026-03-17T10:00:00.000Z"),
        user: {
          id: "user-1",
          name: "Jane Doe",
          image: "https://example.com/avatar.png",
        },
      },
    ]);
    const tx = {
      userAgentRating: {
        findMany,
      },
    } as unknown as Prisma.TransactionClient;

    const result = await getRecentAgentReviews("agent-1", 10, tx);

    expect(findMany).toHaveBeenCalledWith({
      where: {
        agentId: "agent-1",
        isHidden: false,
        AND: [{ comment: { not: null } }, { comment: { not: "" } }],
      },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            image: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
      take: 10,
      skip: 0,
    });
    expect(result).toEqual([
      {
        id: "rating-1",
        rating: 5,
        comment: "Helpful review",
        createdAt: "2026-03-17T10:00:00.000Z",
        updatedAt: "2026-03-17T10:00:00.000Z",
        user: {
          id: "user-1",
          name: "Jane Doe",
          image: "https://example.com/avatar.png",
        },
      },
    ]);
  });

  it("forwards the offset as a skip", async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const tx = {
      userAgentRating: {
        findMany,
      },
    } as unknown as Prisma.TransactionClient;

    await getRecentAgentReviews("agent-1", 5, tx, 10);

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 5, skip: 10 }),
    );
  });
});
describe("getUserAgentReview", () => {
  it("returns the caller's own rating, ignoring the hidden filter", async () => {
    const findUnique = vi.fn().mockResolvedValue({
      id: "rating-1",
      rating: 4,
      comment: "Mine",
      createdAt: new Date("2026-03-17T10:00:00.000Z"),
      updatedAt: new Date("2026-03-17T10:00:00.000Z"),
      isHidden: true,
    });
    const tx = {
      userAgentRating: {
        findUnique,
      },
    } as unknown as Prisma.TransactionClient;

    const result = await getUserAgentReview("agent-1", "user-1", tx);

    expect(findUnique).toHaveBeenCalledWith({
      where: {
        userId_agentId: {
          userId: "user-1",
          agentId: "agent-1",
        },
      },
    });
    // createdAt/updatedAt are intentionally dropped from the my-review payload
    // (see agentMyReviewSchema); the schema parse strips them.
    expect(result).toEqual({
      id: "rating-1",
      rating: 4,
      comment: "Mine",
    });
  });

  it("returns null when the caller has not rated the agent", async () => {
    const findUnique = vi.fn().mockResolvedValue(null);
    const tx = {
      userAgentRating: {
        findUnique,
      },
    } as unknown as Prisma.TransactionClient;

    const result = await getUserAgentReview("agent-1", "user-1", tx);

    expect(result).toBeNull();
  });
});
describe("upsertUserAgentReview", () => {
  it("upserts the caller's rating and returns the my-review payload", async () => {
    const upsert = vi.fn().mockResolvedValue({
      id: "rating-1",
      rating: 5,
      comment: "Great",
      createdAt: new Date("2026-03-17T10:00:00.000Z"),
      updatedAt: new Date("2026-03-17T10:00:00.000Z"),
    });
    const tx = {
      userAgentRating: {
        upsert,
      },
    } as unknown as Prisma.TransactionClient;

    const result = await upsertUserAgentReview(
      "agent-1",
      "user-1",
      5,
      "Great",
      tx,
    );

    expect(upsert).toHaveBeenCalledWith({
      where: { userId_agentId: { userId: "user-1", agentId: "agent-1" } },
      update: { rating: 5, comment: "Great" },
      create: {
        userId: "user-1",
        agentId: "agent-1",
        rating: 5,
        comment: "Great",
      },
    });
    // createdAt/updatedAt are stripped by agentMyReviewSchema.
    expect(result).toEqual({ id: "rating-1", rating: 5, comment: "Great" });
  });
});
