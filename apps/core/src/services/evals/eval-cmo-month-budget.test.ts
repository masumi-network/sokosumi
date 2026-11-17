import { CMO_PRODUCTION_TURN_PREFIX } from "@sokosumi/soko-bot";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { expectCoreLogWhys } from "@/test/core-log";

const boundary = vi.hoisted(() => ({
  advance: vi.fn(),
  strategy: vi.fn(),
  turns: vi.fn(),
  cancelPosts: vi.fn(),
  expire: vi.fn(),
  lane: vi.fn(),
  run: vi.fn(),
  result: vi.fn(),
  resultCount: vi.fn(),
  finish: vi.fn(),
  finishRun: vi.fn(),
}));
vi.mock("@/lib/db/prisma", () => ({
  default: {
    marketingStrategy: { findUniqueOrThrow: boundary.strategy },
    sokoBotTurn: { findMany: boundary.turns },
    socialPost: { updateMany: boundary.cancelPosts },
    evalLane: { findUniqueOrThrow: boundary.lane },
    evalRun: { findFirst: boundary.run, update: boundary.finishRun },
    evalResult: {
      findFirst: boundary.result,
      count: boundary.resultCount,
      update: boundary.finish,
    },
  },
}));
vi.mock("@/services/cmo-production.service", () => ({
  advanceCmoProduction: boundary.advance,
}));
vi.mock("@/services/cmo-cuso.service", () => ({
  findCusoForBot: vi.fn().mockResolvedValue({ id: "cuso", sokoBotId: "bot" }),
}));
vi.mock(
  "@/services/soko-bot-control-plane.service",
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import("@/services/soko-bot-control-plane.service")
    >()),
    sokoBotControlPlane: { expireTurn: boundary.expire },
  }),
);

import { CMO_EVAL_CASES } from "./eval-cmo-cases";
import { pollCmoCase } from "./eval-cmo-runner";
import type { EvalLaneRecord } from "./eval-lanes.service";
import { tickEvalRuns } from "./eval-runs.service";

const approvedAt = new Date("2026-11-14T12:00:00Z");
const startedAt = new Date("2026-11-14T12:01:00Z");
const productionPrefix = `${CMO_PRODUCTION_TURN_PREFIX}bot:${approvedAt.getTime()}:`;
const lane: EvalLaneRecord = {
  lane: 1,
  userId: "owner",
  organizationId: "organization",
  workspaceId: "workspace",
  sokoBotId: "soko",
  cusoBotId: "bot",
  cusoProjectId: "project",
  world: {
    hannahUserId: "hannah",
    alexUserId: "alex",
    marketingProjectId: "marketing",
    outreachProjectId: "outreach",
    roomId: "room",
  },
};
const month = CMO_EVAL_CASES.find((entry) => entry.kind === "cmo-month")!;
const context = { resultId: "result", firstOfSuite: false, startedAt };

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-14T12:02:00Z"));
  vi.clearAllMocks();
  boundary.strategy.mockResolvedValue({
    approvedAt,
    plan: null,
    monthReview: null,
  });
  boundary.advance.mockResolvedValue({ state: "working", ready: 0, total: 1 });
  boundary.cancelPosts.mockResolvedValue({ count: 1 });
  boundary.turns.mockResolvedValue([]);
  boundary.expire.mockResolvedValue(true);
  boundary.lane.mockResolvedValue(lane);
  boundary.run.mockResolvedValue({ id: "run", repeats: 1, trigger: "MANUAL" });
  boundary.result.mockResolvedValue(null);
  boundary.resultCount.mockResolvedValue(1);
  boundary.finish.mockResolvedValue({});
  boundary.finishRun.mockResolvedValue({});
});
afterEach(() => vi.useRealTimers());

async function poll() {
  return pollCmoCase(
    month,
    lane,
    { turnId: null, state: { strategyId: "strategy" } },
    context,
  );
}

describe("monthly eval hard-budget guard", () => {
  it("stops before advancing paid production and cancels only unsent month posts", async () => {
    boundary.turns.mockResolvedValueOnce([
      {
        id: "earlier-production",
        status: "COMPLETED",
        errorKind: null,
        errorDetail: null,
      },
      {
        id: "failed-production",
        status: "FAILED",
        errorKind: "GatewayInternalServerError",
        errorDetail:
          "API key budget exceeded. Current spend: $400.12, limit: $400.00.",
      },
    ]);
    expect(await poll()).toMatchObject({
      kind: "done",
      outcome: {
        status: "ERROR",
        checks: [],
        turnIds: ["earlier-production", "failed-production"],
        output: { infrastructure: { code: "provider_budget_exhausted" } },
      },
    });
    expect(boundary.advance).not.toHaveBeenCalled();
    expect(boundary.turns).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          sokoBotId: lane.cusoBotId,
          source: "EVENT",
          createdAt: { gte: startedAt },
          clientTurnId: { startsWith: productionPrefix },
        },
      }),
    );
    expect(boundary.cancelPosts).toHaveBeenCalledWith({
      where: {
        marketingStrategyId: "strategy",
        status: { in: ["DRAFT", "NEEDS_APPROVAL", "SCHEDULED"] },
      },
      data: {
        status: "CANCELED",
        canceledAt: new Date("2026-11-14T12:02:00Z"),
        revision: { increment: 1 },
      },
    });
  });

  it("lets already active production settle without starting another attempt", async () => {
    boundary.turns.mockResolvedValueOnce([
      { id: "active", status: "RUNNING", errorKind: null, errorDetail: null },
      {
        id: "budget-failure",
        status: "FAILED",
        errorKind: "GatewayInternalServerError",
        errorDetail:
          "API key budget exceeded. Current spend: $400.12, limit: $400.00.",
      },
    ]);
    expect(await poll()).toEqual({ kind: "waiting" });
    expect(boundary.advance).not.toHaveBeenCalled();
    expect(boundary.cancelPosts).not.toHaveBeenCalled();
  });

  it("finds a budget failure in a bound watch descendant and retains every turn's costs", async () => {
    boundary.turns
      .mockResolvedValueOnce([
        { id: "root", status: "COMPLETED", errorKind: null, errorDetail: null },
      ])
      .mockResolvedValueOnce([
        {
          id: "watch",
          status: "COMPLETED",
          errorKind: null,
          errorDetail: null,
        },
      ])
      .mockResolvedValueOnce([
        {
          id: "watch-child",
          status: "FAILED",
          errorKind: "GatewayInternalServerError",
          errorDetail:
            "API key budget exceeded. Current spend: $400.12, limit: $400.00.",
        },
      ]);
    expect(await poll()).toMatchObject({
      kind: "done",
      outcome: {
        status: "ERROR",
        turnIds: ["root", "watch", "watch-child"],
        output: { infrastructure: { code: "provider_budget_exhausted" } },
      },
    });
    expect(boundary.turns).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: {
          sokoBotId: lane.cusoBotId,
          createdAt: { gte: startedAt },
          parentTurnId: { in: ["root"] },
        },
      }),
    );
    expect(boundary.turns).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({
        where: {
          sokoBotId: lane.cusoBotId,
          createdAt: { gte: startedAt },
          parentTurnId: { in: ["watch"] },
        },
      }),
    );
    expect(boundary.advance).not.toHaveBeenCalled();
  });

  it("waits for an active watch descendant after a root budget failure", async () => {
    boundary.turns
      .mockResolvedValueOnce([
        {
          id: "root",
          status: "FAILED",
          errorKind: "GatewayInternalServerError",
          errorDetail:
            "API key budget exceeded. Current spend: $400.12, limit: $400.00.",
        },
      ])
      .mockResolvedValueOnce([
        {
          id: "active-watch",
          status: "RUNNING",
          errorKind: null,
          errorDetail: null,
        },
      ]);
    expect(await poll()).toEqual({ kind: "waiting" });
    expect(boundary.advance).not.toHaveBeenCalled();
    expect(boundary.cancelPosts).not.toHaveBeenCalled();
  });

  it("ends only bound active production after the month deadline and retains its costs", async () => {
    vi.setSystemTime(new Date(startedAt.getTime() + 3 * 60 * 60_000));
    boundary.turns
      .mockResolvedValueOnce([
        {
          id: "root",
          status: "FAILED",
          errorKind: "GatewayInternalServerError",
          errorDetail:
            "API key budget exceeded. Current spend: $400.12, limit: $400.00.",
        },
      ])
      .mockResolvedValueOnce([
        {
          id: "active-watch",
          status: "RUNNING",
          errorKind: null,
          errorDetail: null,
        },
      ]);
    expect(await poll()).toMatchObject({
      kind: "done",
      outcome: {
        status: "ERROR",
        turnIds: ["root", "active-watch"],
        output: { infrastructure: { code: "provider_budget_exhausted" } },
      },
    });
    expect(boundary.expire).toHaveBeenCalledExactlyOnceWith("active-watch");
    expect(boundary.cancelPosts).toHaveBeenCalledOnce();
    expect(boundary.advance).not.toHaveBeenCalled();
  });

  it("does not finish a budget-blocked month if expiring its active descendant fails", async () => {
    vi.setSystemTime(new Date(startedAt.getTime() + 3 * 60 * 60_000));
    boundary.turns
      .mockResolvedValueOnce([
        {
          id: "root",
          status: "FAILED",
          errorKind: "GatewayInternalServerError",
          errorDetail:
            "API key budget exceeded. Current spend: $400.12, limit: $400.00.",
        },
      ])
      .mockResolvedValueOnce([
        {
          id: "active-watch",
          status: "RUNNING",
          errorKind: null,
          errorDetail: null,
        },
      ]);
    boundary.expire.mockRejectedValueOnce(new Error("Database unavailable"));
    expect(await poll()).toEqual({ kind: "waiting" });
    expect(boundary.cancelPosts).not.toHaveBeenCalled();
    expect(boundary.advance).not.toHaveBeenCalled();
  });

  it("lists every failed lane on one error, without the lanes' error text", async () => {
    const errors = expectCoreLogWhys(
      "error",
      "Could not move an eval run's lanes on",
      ["A lane's step threw"],
    );
    boundary.run.mockResolvedValue({
      id: "run",
      repeats: 2,
      trigger: "MANUAL",
    });
    // A lane runs a Soko Bot turn, and its error can quote the prompt.
    boundary.lane.mockRejectedValue(
      new Error('prompt "Confidential merger with Acme" sk_live_abc123'),
    );

    expect(await tickEvalRuns()).toEqual({ runId: "run", completed: false });

    expect(errors[0]?.event).toMatchObject({
      operation: "eval_tick",
      evalRun: { id: "run" },
      evalLaneFailures: [
        { lane: 1, errorName: "Error" },
        { lane: 2, errorName: "Error" },
      ],
    });
    const drained = JSON.stringify(errors[0]?.event);
    expect(drained).not.toContain("Confidential merger");
    expect(drained).not.toContain("sk_live");
  });

  it.each(["expiry", "post cleanup"] as const)(
    "keeps the real runner on the same month when %s fails",
    async (failure) => {
      vi.setSystemTime(new Date(startedAt.getTime() + 3 * 60 * 60_000));
      boundary.result.mockResolvedValueOnce({
        id: "result",
        caseId: month.id,
        turnId: null,
        state: { strategyId: "strategy" },
        startedAt,
        createdAt: startedAt,
      });
      boundary.turns
        .mockResolvedValueOnce([
          {
            id: "root",
            status: "FAILED",
            errorKind: "GatewayInternalServerError",
            errorDetail:
              "API key budget exceeded. Current spend: $400.12, limit: $400.00.",
          },
        ])
        .mockResolvedValueOnce([
          {
            id: "active-watch",
            status: "RUNNING",
            errorKind: null,
            errorDetail: null,
          },
        ]);
      if (failure === "expiry")
        boundary.expire.mockRejectedValueOnce(
          new Error("Database unavailable"),
        );
      else
        boundary.cancelPosts.mockRejectedValueOnce(
          new Error("Database unavailable"),
        );
      expect(await tickEvalRuns()).toEqual({ runId: "run", completed: false });
      expect(boundary.finish).not.toHaveBeenCalled();
      expect(boundary.finishRun).not.toHaveBeenCalled();
      expect(boundary.result).toHaveBeenCalledExactlyOnceWith({
        where: { runId: "run", repeat: 1, status: "RUNNING" },
      });
      expect(boundary.advance).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["runner_exited", "The runner ended with exit code 1"],
    ["GatewayInternalServerError", "Temporary upstream failure"],
  ])("preserves monthly recovery for %s", async (errorKind, errorDetail) => {
    boundary.turns.mockResolvedValueOnce([
      { id: "retryable", status: "FAILED", errorKind, errorDetail },
    ]);
    expect(await poll()).toEqual({ kind: "waiting" });
    expect(boundary.advance).toHaveBeenCalledOnce();
    expect(boundary.cancelPosts).not.toHaveBeenCalled();
  });
});
