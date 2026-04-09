import assert from "node:assert/strict";

import { describe, it } from "vitest";

import type { Prisma } from "../../generated/prisma/client.js";
import { subscriptionRepository } from "../subscription.repository.js";

describe("subscriptionRepository", () => {
  it("orders latest subscriptions with null period ends last", async () => {
    let findFirstCall: unknown;
    const tx = {
      subscription: {
        findFirst: async (args: unknown) => {
          findFirstCall = args;
          return null;
        },
      },
    } as unknown as Prisma.TransactionClient;

    await subscriptionRepository.getLatestSubscriptionByReferenceId(
      "reference-1",
      tx,
    );

    assert.deepEqual(findFirstCall, {
      where: {
        referenceId: "reference-1",
      },
      orderBy: [
        { periodEnd: { sort: "desc", nulls: "last" } },
        { updatedAt: "desc" },
      ],
    });
  });

  it("orders latest active subscriptions with null period ends last", async () => {
    let findFirstCall: unknown;
    const tx = {
      subscription: {
        findFirst: async (args: unknown) => {
          findFirstCall = args;
          return null;
        },
      },
    } as unknown as Prisma.TransactionClient;

    await subscriptionRepository.getLatestActiveSubscriptionByReferenceId(
      "reference-1",
      tx,
    );

    assert.deepEqual(findFirstCall, {
      where: {
        referenceId: "reference-1",
        status: {
          in: ["active", "trialing", "past_due", "unpaid"],
        },
      },
      orderBy: [
        { periodEnd: { sort: "desc", nulls: "last" } },
        { updatedAt: "desc" },
      ],
    });
  });
});
