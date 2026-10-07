import assert from "node:assert/strict";

import { describe, it } from "vitest";

import type { Prisma } from "../generated/prisma/client.js";
import { subscriptionRepository } from "./subscription.repository.js";

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

  it("resolveActiveSubscriptionByReferenceId prefers the in-period row and filters by period window", async () => {
    const inPeriodRow = { id: "current-period" };
    const calls: unknown[] = [];
    const now = new Date("2026-04-10T00:00:00.000Z");
    const tx = {
      subscription: {
        findMany: async (args: unknown) => {
          calls.push(args);
          return [inPeriodRow];
        },
        findFirst: async (args: unknown) => {
          calls.push(args);
          return { id: "should-not-be-used" };
        },
      },
    } as unknown as Prisma.TransactionClient;

    const result =
      await subscriptionRepository.resolveActiveSubscriptionByReferenceId(
        "reference-1",
        tx,
        now,
      );

    assert.equal(result, inPeriodRow);
    assert.equal(calls.length, 1);
    const call = calls[0] as {
      where: {
        periodEnd: { gt: Date };
        periodStart: { lte: Date };
        referenceId: string;
      };
    };
    assert.equal(call.where.referenceId, "reference-1");
    assert.equal(call.where.periodStart.lte, now);
    assert.equal(call.where.periodEnd.gt, now);
  });

  it("resolveActiveSubscriptionByReferenceId falls back to latest started active when not in period", async () => {
    const fallbackRow = { id: "fallback" };
    const calls: unknown[] = [];
    const now = new Date("2026-04-14T12:00:00.000Z");
    const tx = {
      subscription: {
        findMany: async (args: unknown) => {
          calls.push(args);
          return [];
        },
        findFirst: async (args: unknown) => {
          calls.push(args);
          return fallbackRow;
        },
      },
    } as unknown as Prisma.TransactionClient;

    const result =
      await subscriptionRepository.resolveActiveSubscriptionByReferenceId(
        "reference-1",
        tx,
        now,
      );

    assert.equal(result, fallbackRow);
    assert.equal(calls.length, 2);
    assert.ok(
      (calls[0] as { where: { periodEnd?: { gt: Date } } }).where.periodEnd,
    );
    assert.deepEqual((calls[1] as { where: { OR: unknown } }).where.OR, [
      { periodStart: null },
      { periodStart: { lte: now } },
    ]);
  });

  it("resolveActiveSubscriptionByReferenceId returns null when only a future period is active", async () => {
    const now = new Date("2026-04-14T12:00:00.000Z");
    const tx = {
      subscription: {
        findMany: async () => [],
        findFirst: async () => null,
      },
    } as unknown as Prisma.TransactionClient;

    const result =
      await subscriptionRepository.resolveActiveSubscriptionByReferenceId(
        "reference-1",
        tx,
        now,
      );

    assert.equal(result, null);
  });

  it("resolveActiveSubscriptionByReferenceId prefers a Stripe-backed row over a newer free row in the same period", async () => {
    const freeRow = { id: "free", stripeSubscriptionId: null };
    const paidRow = { id: "paid", stripeSubscriptionId: "sub_1" };
    const tx = {
      subscription: {
        findMany: async () => [freeRow, paidRow],
      },
    } as unknown as Prisma.TransactionClient;

    const result =
      await subscriptionRepository.resolveActiveSubscriptionByReferenceId(
        "reference-1",
        tx,
        new Date("2026-04-10T00:00:00.000Z"),
      );

    assert.equal(result, paidRow);
  });

  it("resolveActiveSubscriptionByReferenceId keeps the newest row when two Stripe-backed rows share a period", async () => {
    const newerRow = { id: "newer", stripeSubscriptionId: "sub_2" };
    const olderRow = { id: "older", stripeSubscriptionId: "sub_1" };
    const tx = {
      subscription: {
        findMany: async () => [newerRow, olderRow],
      },
    } as unknown as Prisma.TransactionClient;

    const result =
      await subscriptionRepository.resolveActiveSubscriptionByReferenceId(
        "reference-1",
        tx,
        new Date("2026-04-10T00:00:00.000Z"),
      );

    assert.equal(result, newerRow);
  });
});
