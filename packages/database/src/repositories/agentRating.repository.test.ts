import assert from "node:assert/strict";

import { describe, it } from "vitest";

import type { Prisma } from "../generated/prisma/client.js";
import { agentRatingRepository } from "./agentRating.repository.js";

function createTransactionClient() {
  const groupByCalls: unknown[] = [];
  const findManyCalls: unknown[] = [];
  const aggregateCalls: unknown[] = [];
  const findUniqueCalls: unknown[] = [];
  const upsertCalls: unknown[] = [];

  const tx = {
    userAgentRating: {
      upsert: async (args: unknown) => {
        upsertCalls.push(args);
        return {};
      },
      findUnique: async (args: unknown) => {
        findUniqueCalls.push(args);
        return {
          id: "rating-hidden",
          userId: "user-1",
          agentId: "agent-1",
          rating: 4,
          comment: "Hidden comment",
          isHidden: true,
        };
      },
      groupBy: async (args: unknown) => {
        groupByCalls.push(args);

        const where = (args as { where?: { agentId?: string } }).where;
        if (where?.agentId === "agent-1") {
          return [
            { rating: 5, _count: { rating: 2 } },
            { rating: 3, _count: { rating: 1 } },
          ];
        }

        return [
          {
            agentId: "agent-1",
            _count: { rating: 2 },
            _avg: { rating: 4.5 },
          },
        ];
      },
      findMany: async (args: unknown) => {
        findManyCalls.push(args);
        return [
          {
            id: "rating-1",
            rating: 5,
            comment: "Visible review",
            createdAt: new Date("2026-03-09T10:00:00.000Z"),
            updatedAt: new Date("2026-03-09T10:00:00.000Z"),
            user: {
              id: "user-1",
              name: "Ada Lovelace",
              image: null,
            },
          },
        ];
      },
      aggregate: async (args: unknown) => {
        aggregateCalls.push(args);
        return {
          _count: { rating: 2 },
          _avg: { rating: 4.5 },
        };
      },
    },
  } as unknown as Prisma.TransactionClient;

  return {
    tx,
    groupByCalls,
    findManyCalls,
    aggregateCalls,
    findUniqueCalls,
    upsertCalls,
  };
}

describe("agentRatingRepository.upsertRating", () => {
  it("does not overwrite isHidden when a user updates a rating", async () => {
    const { tx, upsertCalls } = createTransactionClient();

    await agentRatingRepository.upsertRating(
      "user-1",
      "agent-1",
      5,
      "Updated review",
      tx,
    );

    assert.equal(upsertCalls.length, 1);

    const args = upsertCalls[0] as {
      update: Record<string, unknown>;
      create: Record<string, unknown>;
    };

    assert.deepEqual(args.update, {
      rating: 5,
      comment: "Updated review",
    });
    assert.deepEqual(args.create, {
      userId: "user-1",
      agentId: "agent-1",
      rating: 5,
      comment: "Updated review",
    });
    assert.equal("isHidden" in args.update, false);
    assert.equal("isHidden" in args.create, false);
  });
});

describe("agentRatingRepository.getUserRatingForAgent", () => {
  it("keeps the user lookup unfiltered so hidden ratings remain editable", async () => {
    const { tx, findUniqueCalls } = createTransactionClient();

    const result = await agentRatingRepository.getUserRatingForAgent(
      "user-1",
      "agent-1",
      tx,
    );

    assert.equal(result?.isHidden, true);
    assert.deepEqual(findUniqueCalls[0], {
      where: {
        userId_agentId: {
          userId: "user-1",
          agentId: "agent-1",
        },
      },
    });
  });
});

describe("agentRatingRepository public reads", () => {
  it("filters hidden ratings out of the rating distribution", async () => {
    const { tx, groupByCalls } = createTransactionClient();

    const distribution = await agentRatingRepository.getRatingDistribution(
      "agent-1",
      tx,
    );

    assert.deepEqual(groupByCalls[0], {
      by: ["rating"],
      where: {
        agentId: "agent-1",
        isHidden: false,
      },
      _count: { rating: true },
    });
    assert.deepEqual(distribution, {
      1: 0,
      2: 0,
      3: 1,
      4: 0,
      5: 2,
    });
  });

  it("filters hidden ratings out of the visible review list", async () => {
    const { tx, findManyCalls } = createTransactionClient();

    const ratings = await agentRatingRepository.getRatingsByAgentId(
      "agent-1",
      10,
      0,
      true,
      tx,
    );

    assert.deepEqual(findManyCalls[0], {
      where: {
        agentId: "agent-1",
        isHidden: false,
        comment: { not: null },
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
    assert.deepEqual(ratings, [
      {
        id: "rating-1",
        rating: 5,
        comment: "Visible review",
        createdAt: new Date("2026-03-09T10:00:00.000Z"),
        updatedAt: new Date("2026-03-09T10:00:00.000Z"),
        user: {
          id: "user-1",
          name: "Ada Lovelace",
          image: null,
        },
      },
    ]);
  });

  it("filters hidden ratings out of multi-agent aggregates and preserves zero defaults", async () => {
    const { tx, groupByCalls } = createTransactionClient();

    const stats = await agentRatingRepository.getAgentsRatingStats(
      ["agent-1", "agent-2"],
      tx,
    );

    assert.deepEqual(groupByCalls[0], {
      by: ["agentId"],
      where: {
        agentId: { in: ["agent-1", "agent-2"] },
        isHidden: false,
      },
      _count: { rating: true },
      _avg: { rating: true },
    });
    assert.deepEqual(stats, {
      "agent-1": {
        totalRatings: 2,
        averageRating: 4.5,
      },
      "agent-2": {
        totalRatings: 0,
        averageRating: 0,
      },
    });
  });

  it("filters hidden ratings out of single-agent aggregates", async () => {
    const { tx, aggregateCalls } = createTransactionClient();

    const stats = await agentRatingRepository.getAgentRatingStats(
      "agent-1",
      tx,
    );

    assert.deepEqual(aggregateCalls[0], {
      where: {
        agentId: "agent-1",
        isHidden: false,
      },
      _count: { rating: true },
      _avg: { rating: true },
    });
    assert.deepEqual(stats, {
      totalRatings: 2,
      averageRating: 4.5,
    });
  });
});
