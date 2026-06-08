import {
  AgentStatus,
  type CreditCost,
  PricingType,
  type Prisma,
} from "@sokosumi/database";
import { describe, expect, it, vi } from "vitest";

import {
  buildAvailableAgentWhereClause,
  calculateAgentRating,
  calculateAgentRatings,
  getCreditCostsOrThrow,
  getRecentAgentReviews,
  getUserAgentReview,
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
    expect(result).toEqual({
      id: "rating-1",
      rating: 4,
      comment: "Mine",
      createdAt: "2026-03-17T10:00:00.000Z",
      updatedAt: "2026-03-17T10:00:00.000Z",
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
