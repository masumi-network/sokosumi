import {
  AgentStatus,
  type CreditCost,
  PricingType,
  type Prisma,
} from "@sokosumi/database";
import { describe, expect, it, vi } from "vitest";

import {
  addAgentToFavorites,
  buildAvailableAgentWhereClause,
  calculateAgentRating,
  calculateAgentRatings,
  getCreditCostsOrThrow,
  getRecentAgentReviews,
  getUserAgentReview,
  removeAgentFromFavorites,
  requireAvailableAgentOrThrow,
  upsertUserAgentReview,
} from "./agent";

function createCreditCost(unit: string): CreditCost {
  const now = new Date("2026-01-01T00:00:00.000Z");
  return {
    id: `credit-cost-${unit}`,
    createdAt: now,
    updatedAt: now,
    unit,
    centsPerUnit: BigInt(1),
  };
}

function createTransactionClient(creditCosts: CreditCost[]) {
  return {
    creditCost: {
      findMany: vi.fn().mockResolvedValue(creditCosts),
    },
  } as unknown as Prisma.TransactionClient;
}

describe("buildAvailableAgentWhereClause", () => {
  it("does not include organization allowlist or denylist filters", () => {
    const where = buildAvailableAgentWhereClause([createCreditCost("USD")]);

    expect(Object.prototype.hasOwnProperty.call(where, "OR")).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(where, "NOT")).toBe(false);
    expect(where.status).toBe(AgentStatus.ONLINE);
    expect(where.isShown).toBe(true);
  });

  it("keeps pricing validation behavior unchanged", () => {
    const where = buildAvailableAgentWhereClause([
      createCreditCost("USD"),
      createCreditCost("EUR"),
    ]);

    expect(where.pricing).toEqual({
      pricingType: { not: PricingType.UNKNOWN },
      OR: [
        { pricingType: PricingType.FREE },
        {
          pricingType: PricingType.FIXED,
          fixedPricing: {
            amounts: {
              every: {
                unit: { in: ["USD", "EUR"] },
              },
            },
          },
        },
      ],
    });
  });
});

describe("getCreditCostsOrThrow", () => {
  it("returns credit costs when available", async () => {
    const creditCosts = [createCreditCost("USD"), createCreditCost("EUR")];
    const tx = createTransactionClient(creditCosts);

    const result = await getCreditCostsOrThrow(tx);
    expect(result).toEqual(creditCosts);
  });

  it("throws when no credit costs are configured", async () => {
    const tx = createTransactionClient([]);

    await expect(getCreditCostsOrThrow(tx)).rejects.toThrow(
      "Failed to get credit information for agents",
    );
  });
});

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

describe("requireAvailableAgentOrThrow", () => {
  it("resolves when an available agent exists", async () => {
    const findFirst = vi.fn().mockResolvedValue({ id: "agent-1" });
    const tx = {
      creditCost: {
        findMany: vi.fn().mockResolvedValue([createCreditCost("USD")]),
      },
      agent: { findFirst },
    } as unknown as Prisma.TransactionClient;

    await expect(
      requireAvailableAgentOrThrow("agent-1", tx),
    ).resolves.toBeUndefined();
    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: "agent-1" }),
        select: { id: true },
      }),
    );
  });

  it("throws a 404 when no available agent matches", async () => {
    const tx = {
      creditCost: {
        findMany: vi.fn().mockResolvedValue([createCreditCost("USD")]),
      },
      agent: { findFirst: vi.fn().mockResolvedValue(null) },
    } as unknown as Prisma.TransactionClient;

    await expect(
      requireAvailableAgentOrThrow("missing", tx),
    ).rejects.toMatchObject({ status: 404 });
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

describe("addAgentToFavorites", () => {
  it("upserts the FAVORITE list and connects the agent", async () => {
    const upsert = vi.fn().mockResolvedValue({ id: "list-1" });
    const tx = {
      agentList: {
        upsert,
      },
    } as unknown as Prisma.TransactionClient;

    await addAgentToFavorites("user-1", "agent-1", tx);

    expect(upsert).toHaveBeenCalledWith({
      where: { userId_type: { userId: "user-1", type: "FAVORITE" } },
      create: {
        userId: "user-1",
        type: "FAVORITE",
        agents: { connect: { id: "agent-1" } },
      },
      update: { agents: { connect: { id: "agent-1" } } },
    });
  });
});

describe("removeAgentFromFavorites", () => {
  it("disconnects the agent when the FAVORITE list exists", async () => {
    const findUnique = vi.fn().mockResolvedValue({ id: "list-1" });
    const update = vi.fn().mockResolvedValue({ id: "list-1" });
    const tx = {
      agentList: {
        findUnique,
        update,
      },
    } as unknown as Prisma.TransactionClient;

    await removeAgentFromFavorites("user-1", "agent-1", tx);

    expect(update).toHaveBeenCalledWith({
      where: { userId_type: { userId: "user-1", type: "FAVORITE" } },
      data: { agents: { disconnect: { id: "agent-1" } } },
    });
  });

  it("is a no-op when the caller has no FAVORITE list", async () => {
    const findUnique = vi.fn().mockResolvedValue(null);
    const update = vi.fn();
    const tx = {
      agentList: {
        findUnique,
        update,
      },
    } as unknown as Prisma.TransactionClient;

    await removeAgentFromFavorites("user-1", "agent-1", tx);

    expect(update).not.toHaveBeenCalled();
  });
});
