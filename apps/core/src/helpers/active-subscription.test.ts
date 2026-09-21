import type { Prisma } from "@sokosumi/database";
import { describe, expect, it } from "vitest";

import { findActiveSubscriptionByReferenceId } from "./active-subscription";

describe("findActiveSubscriptionByReferenceId", () => {
  it("prefers the in-period row and skips the fallback query", async () => {
    const inPeriodRow = { id: "current-period" };
    const calls: unknown[] = [];
    const now = new Date("2026-04-10T00:00:00.000Z");
    const tx = {
      subscription: {
        findFirst: async (args: unknown) => {
          calls.push(args);
          return calls.length === 1
            ? inPeriodRow
            : { id: "should-not-be-used" };
        },
      },
    } as unknown as Prisma.TransactionClient;

    const result = await findActiveSubscriptionByReferenceId(
      "reference-1",
      tx,
      now,
    );

    expect(result).toBe(inPeriodRow);
    expect(calls).toHaveLength(1);
    const call = calls[0] as {
      where: {
        periodEnd: { gt: Date };
        periodStart: { lte: Date };
        referenceId: string;
      };
    };
    expect(call.where.referenceId).toBe("reference-1");
    expect(call.where.periodStart.lte).toBe(now);
    expect(call.where.periodEnd.gt).toBe(now);
  });

  it("falls back to the latest started active row when none is in period", async () => {
    const fallbackRow = { id: "fallback" };
    const calls: unknown[] = [];
    const now = new Date("2026-04-14T12:00:00.000Z");
    const tx = {
      subscription: {
        findFirst: async (args: unknown) => {
          calls.push(args);
          return calls.length === 1 ? null : fallbackRow;
        },
      },
    } as unknown as Prisma.TransactionClient;

    const result = await findActiveSubscriptionByReferenceId(
      "reference-1",
      tx,
      now,
    );

    expect(result).toBe(fallbackRow);
    expect(calls).toHaveLength(2);
    expect(
      (calls[0] as { where: { periodEnd?: { gt: Date } } }).where.periodEnd,
    ).toBeDefined();
    expect((calls[1] as { where: { OR: unknown } }).where.OR).toEqual([
      { periodStart: null },
      { periodStart: { lte: now } },
    ]);
  });

  it("returns null when no started active row exists", async () => {
    const tx = {
      subscription: {
        findFirst: async () => null,
      },
    } as unknown as Prisma.TransactionClient;

    await expect(
      findActiveSubscriptionByReferenceId(
        "reference-1",
        tx,
        new Date("2026-04-14T12:00:00.000Z"),
      ),
    ).resolves.toBeNull();
  });
});
