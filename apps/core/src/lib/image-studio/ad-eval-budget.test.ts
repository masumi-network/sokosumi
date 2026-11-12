import { beforeEach, describe, expect, it, vi } from "vitest";

import { finalizeAdEval, reserveAdEval } from "./ad-eval-budget";
import { AD_EVAL_RESERVATION_USD_MICROS } from "./ad-eval-judge";

const { tx, transactionMock } = vi.hoisted(() => ({
  tx: {
    adEval: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    adEvalDailyBudget: {
      upsert: vi.fn(),
      update: vi.fn(),
    },
  },
  transactionMock: vi.fn(),
}));

vi.mock("@/lib/db/transaction", () => ({
  serializableTransaction: transactionMock,
}));
vi.mock("./ad-eval-judge", () => ({
  AD_EVAL_RESERVATION_USD_MICROS: 250_000n,
}));

const INPUT = {
  assetId: "asset-1",
  workspaceId: "workspace-1",
  rubricVersion: "ad-eval-v1",
  workspaceDailyLimit: 100,
  globalDailyUsd: 25,
  now: new Date("2026-11-12T23:59:59.999Z"),
};

describe("reserveAdEval", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    transactionMock.mockImplementation(
      (callback: (client: typeof tx) => Promise<unknown>) => callback(tx),
    );
    tx.adEval.findUnique.mockResolvedValue(null);
    tx.adEvalDailyBudget.upsert.mockResolvedValue({
      calls: 0,
      costUsdMicros: 0n,
    });
    tx.adEval.create.mockResolvedValue({ id: "eval-1" });
  });

  it("reserves spend before any model call and pins it to the UTC admission day", async () => {
    await expect(reserveAdEval(INPUT)).resolves.toBe("eval-1");

    const day = new Date("2026-11-12T00:00:00.000Z");
    for (const scope of ["global", INPUT.workspaceId]) {
      expect(tx.adEvalDailyBudget.update).toHaveBeenCalledWith({
        where: { day_scope: { day, scope } },
        data: {
          calls: { increment: 1 },
          costUsdMicros: { increment: AD_EVAL_RESERVATION_USD_MICROS },
        },
      });
    }
    expect(tx.adEval.create).toHaveBeenCalledWith({
      data: {
        assetId: INPUT.assetId,
        workspaceId: INPUT.workspaceId,
        rubricVersion: INPUT.rubricVersion,
        checks: [],
        costUsdMicros: AD_EVAL_RESERVATION_USD_MICROS,
        createdAt: INPUT.now,
      },
      select: { id: true },
    });
  });

  it("does not run the same asset and rubric twice", async () => {
    tx.adEval.findUnique.mockResolvedValue({ id: "existing" });
    await expect(reserveAdEval(INPUT)).resolves.toBeNull();
    expect(tx.adEvalDailyBudget.upsert).not.toHaveBeenCalled();
    expect(tx.adEval.create).not.toHaveBeenCalled();
  });

  it("refuses when the workspace daily count is spent", async () => {
    tx.adEvalDailyBudget.upsert
      .mockResolvedValueOnce({ calls: 0, costUsdMicros: 0n })
      .mockResolvedValueOnce({ calls: 100, costUsdMicros: 1n });
    await expect(reserveAdEval(INPUT)).resolves.toBeNull();
    expect(tx.adEvalDailyBudget.update).not.toHaveBeenCalled();
    expect(tx.adEval.create).not.toHaveBeenCalled();
  });

  it("includes pending reservations in the global daily cap", async () => {
    tx.adEvalDailyBudget.upsert.mockResolvedValue({
      costUsdMicros: 24_750_001n,
    });
    await expect(reserveAdEval(INPUT)).resolves.toBeNull();
    expect(tx.adEval.create).not.toHaveBeenCalled();
  });

  it("admits a reservation that exactly fills the global cap", async () => {
    tx.adEvalDailyBudget.upsert
      .mockResolvedValueOnce({ costUsdMicros: 24_750_000n })
      .mockResolvedValueOnce({ calls: 0 });
    await expect(reserveAdEval(INPUT)).resolves.toBe("eval-1");
  });

  it.each([
    { workspaceDailyLimit: 0 },
    { workspaceDailyLimit: -1 },
    { workspaceDailyLimit: 1.5 },
    { globalDailyUsd: 0 },
    { globalDailyUsd: -1 },
    { globalDailyUsd: Number.NaN },
    { globalDailyUsd: Number.POSITIVE_INFINITY },
  ])("fails closed for an invalid or zero budget: %j", async (overrides) => {
    await expect(reserveAdEval({ ...INPUT, ...overrides })).resolves.toBeNull();
    expect(transactionMock).not.toHaveBeenCalled();
  });

  it("treats a competing unique insert as already admitted", async () => {
    tx.adEval.create.mockRejectedValueOnce(
      Object.assign(new Error("Duplicate asset/rubric"), { code: "P2002" }),
    );
    await expect(reserveAdEval(INPUT)).resolves.toBeNull();
  });

  it("lets the worker handle infrastructure errors", async () => {
    const error = new Error("Database unavailable");
    transactionMock.mockRejectedValueOnce(error);
    await expect(reserveAdEval(INPUT)).rejects.toBe(error);
  });
});

describe("finalizeAdEval", () => {
  const input = {
    id: "eval-1",
    checks: [],
    judge: { overall: 4 },
    judgeModel: "judge",
    overall: 4,
    costUsdMicros: 10_000n,
    latencyMs: 100,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    transactionMock.mockImplementation(
      (callback: (client: typeof tx) => Promise<unknown>) => callback(tx),
    );
    tx.adEval.findUnique.mockResolvedValue({
      workspaceId: INPUT.workspaceId,
      createdAt: INPUT.now,
      costUsdMicros: AD_EVAL_RESERVATION_USD_MICROS,
    });
  });

  it("reconciles both ledgers on the admission day and writes the result atomically", async () => {
    await finalizeAdEval(input);
    for (const scope of ["global", INPUT.workspaceId]) {
      expect(tx.adEvalDailyBudget.update).toHaveBeenCalledWith({
        where: {
          day_scope: { day: new Date("2026-11-12T00:00:00Z"), scope },
        },
        data: { costUsdMicros: { increment: -240_000n } },
      });
    }
    const { id, ...data } = input;
    expect(tx.adEval.update).toHaveBeenCalledWith({ where: { id }, data });
  });

  it("retains reservations when provider cost is unknown", async () => {
    await finalizeAdEval({ ...input, costUsdMicros: null });
    expect(tx.adEvalDailyBudget.update).not.toHaveBeenCalled();
    expect(tx.adEval.update.mock.calls[0][0].data).not.toHaveProperty(
      "costUsdMicros",
    );
  });

  it("keeps a deleted asset's conservative reservation", async () => {
    tx.adEval.findUnique.mockResolvedValue(null);
    await finalizeAdEval(input);
    expect(tx.adEvalDailyBudget.update).not.toHaveBeenCalled();
    expect(tx.adEval.update).not.toHaveBeenCalled();
  });

  it("does not refund a known cost twice", async () => {
    tx.adEval.findUnique.mockResolvedValue({
      workspaceId: INPUT.workspaceId,
      createdAt: INPUT.now,
      costUsdMicros: input.costUsdMicros,
    });
    await finalizeAdEval(input);
    expect(tx.adEvalDailyBudget.update).not.toHaveBeenCalled();
  });

  it("rejects negative costs before changing the ledger", async () => {
    await expect(
      finalizeAdEval({ ...input, costUsdMicros: -1n }),
    ).rejects.toThrow("Ad eval cost is negative");
    expect(tx.adEvalDailyBudget.update).not.toHaveBeenCalled();
    expect(tx.adEval.update).not.toHaveBeenCalled();
  });
});
