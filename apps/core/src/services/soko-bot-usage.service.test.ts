import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  queryRawMock,
  usageAggregateMock,
  delegationFindManyMock,
  taskEventFindManyMock,
} = vi.hoisted(() => ({
  queryRawMock: vi.fn(),
  usageAggregateMock: vi.fn(),
  delegationFindManyMock: vi.fn(),
  taskEventFindManyMock: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    $queryRaw: queryRawMock,
    sokoBotUsage: { aggregate: usageAggregateMock },
    sokoBotDelegation: { findMany: delegationFindManyMock },
    taskEvent: { findMany: taskEventFindManyMock },
  },
}));

import { sokoBotUsageTotals } from "@/services/soko-bot-usage.service";

describe("sokoBotUsageTotals", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delegationFindManyMock.mockResolvedValue([]);
    taskEventFindManyMock.mockResolvedValue([]);
  });

  it("reports every token and separates cost from what was charged", async () => {
    // The classifier and the judge are not billed, so the model cost is
    // higher than the billable share while credits follow their own floor.
    queryRawMock.mockResolvedValue([
      {
        turns: 12n,
        inputTokens: 40_000n,
        outputTokens: 6_000n,
        cacheReadTokens: 1_500n,
        cacheWriteTokens: 500n,
        costUsdMicros: 120_000n,
        overheadCostUsdMicros: 30_000n,
      },
    ]);
    // 10^10 cents is one credit; the API must never carry the stored unit.
    usageAggregateMock.mockResolvedValue({ _sum: { cents: 25_000_000_000n } });

    const totals = await sokoBotUsageTotals("bot_1");

    expect(totals).toEqual({
      turns: 12,
      inputTokens: 40_000,
      outputTokens: 6_000,
      cacheReadTokens: 1_500,
      cacheWriteTokens: 500,
      totalTokens: 48_000,
      costUsd: 0.15,
      billableCostUsd: 0.12,
      credits: 2.5,
      delegatedCredits: 0,
      totalCredits: 2.5,
    });
  });

  it("adds what its Coworker Tasks and Agent jobs charged to its own turns", async () => {
    queryRawMock.mockResolvedValue([
      {
        turns: 3n,
        inputTokens: 1_000n,
        outputTokens: 100n,
        cacheReadTokens: 0n,
        cacheWriteTokens: 0n,
        costUsdMicros: 10_000n,
        overheadCostUsdMicros: 0n,
      },
    ]);
    // 2 credits for its own turns.
    usageAggregateMock.mockResolvedValue({ _sum: { cents: 20_000_000_000n } });
    delegationFindManyMock.mockResolvedValue([
      { taskId: "task-1", job: null },
      // Created and then assigned: the same Task counts once.
      { taskId: "task-1", job: null },
      {
        taskId: null,
        // 30 credits charged, 5 refunded.
        job: {
          transaction: { amount: -300_000_000_000n },
          refundedTransaction: { amount: 50_000_000_000n },
        },
      },
    ]);
    // 116 credits charged on the Coworker Task.
    taskEventFindManyMock.mockResolvedValue([
      { taskId: "task-1", transaction: { amount: -1_160_000_000_000n } },
    ]);

    const totals = await sokoBotUsageTotals("bot_1");

    expect(totals.credits).toBe(2);
    expect(totals.delegatedCredits).toBe(141);
    expect(totals.totalCredits).toBe(143);
    expect(delegationFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ turn: { sokoBotId: "bot_1" } }),
      }),
    );
  });

  it("reads a bot that has never run as zero, not as missing", async () => {
    // SUM over no rows is NULL in Postgres, and a null total on a usage page
    // reads as a bug rather than as a bot that has not started.
    queryRawMock.mockResolvedValue([
      {
        turns: 0n,
        inputTokens: null,
        outputTokens: null,
        cacheReadTokens: null,
        cacheWriteTokens: null,
        costUsdMicros: null,
        overheadCostUsdMicros: null,
      },
    ]);
    usageAggregateMock.mockResolvedValue({ _sum: { cents: null } });

    const totals = await sokoBotUsageTotals("bot_new");

    expect(totals.turns).toBe(0);
    expect(totals.totalTokens).toBe(0);
    expect(totals.costUsd).toBe(0);
    expect(totals.credits).toBe(0);
  });
});
