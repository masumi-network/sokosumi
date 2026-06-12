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

  it("getCurrentInPeriodActiveSubscriptionByReferenceId filters by period window", async () => {
    const inPeriodRow = { id: "current-period" };
    let findFirstCall: unknown;
    const now = new Date("2026-04-10T00:00:00.000Z");
    const tx = {
      subscription: {
        findFirst: async (args: unknown) => {
          findFirstCall = args;
          return inPeriodRow;
        },
      },
    } as unknown as Prisma.TransactionClient;

    const result =
      await subscriptionRepository.getCurrentInPeriodActiveSubscriptionByReferenceId(
        "reference-1",
        tx,
        now,
      );

    assert.equal(result, inPeriodRow);
    const call = findFirstCall as {
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

  it("resolveActiveSubscriptionByReferenceId prefers in-period over latest by periodEnd", async () => {
    const inPeriodRow = { id: "current-period" };
    const calls: unknown[] = [];
    const tx = {
      subscription: {
        findFirst: async (args: unknown) => {
          calls.push(args);
          if (calls.length === 1) {
            return inPeriodRow;
          }
          return { id: "should-not-be-used" };
        },
      },
    } as unknown as Prisma.TransactionClient;

    const result =
      await subscriptionRepository.resolveActiveSubscriptionByReferenceId(
        "reference-1",
        tx,
      );

    assert.equal(result, inPeriodRow);
    assert.equal(calls.length, 1);
  });

  it("getLatestStartedActiveSubscriptionByReferenceId excludes future periodStart", async () => {
    let findFirstCall: unknown;
    const now = new Date("2026-04-14T12:00:00.000Z");
    const tx = {
      subscription: {
        findFirst: async (args: unknown) => {
          findFirstCall = args;
          return null;
        },
      },
    } as unknown as Prisma.TransactionClient;

    await subscriptionRepository.getLatestStartedActiveSubscriptionByReferenceId(
      "reference-1",
      tx,
      now,
    );

    const call = findFirstCall as {
      where: {
        OR: Array<{ periodStart: null | { lte: Date } }>;
      };
    };
    assert.deepEqual(call.where.OR, [
      { periodStart: null },
      { periodStart: { lte: now } },
    ]);
  });

  it("resolveActiveSubscriptionByReferenceId falls back to latest started active when not in period", async () => {
    const fallbackRow = { id: "fallback" };
    const calls: unknown[] = [];
    const now = new Date("2026-04-14T12:00:00.000Z");
    const tx = {
      subscription: {
        findFirst: async (args: unknown) => {
          calls.push(args);
          if (calls.length === 1) {
            return null;
          }
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
});
