import { CMO_PRODUCTION_TURN_PREFIX } from "@sokosumi/soko-bot";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const boundary = vi.hoisted(() => ({
  advance: vi.fn(),
  strategy: vi.fn(),
  turns: vi.fn(),
  cancelPosts: vi.fn(),
}));
vi.mock("@/lib/db/prisma", () => ({
  default: {
    marketingStrategy: { findUniqueOrThrow: boundary.strategy },
    sokoBotTurn: { findMany: boundary.turns },
    socialPost: { updateMany: boundary.cancelPosts },
  },
}));
vi.mock("@/services/cmo-production.service", () => ({
  advanceCmoProduction: boundary.advance,
}));
vi.mock("@/services/cmo-cuso.service", () => ({
  findCusoForBot: vi.fn().mockResolvedValue({ id: "cuso", sokoBotId: "bot" }),
}));

import { CMO_EVAL_CASES } from "./eval-cmo-cases";
import { pollCmoCase } from "./eval-cmo-runner";
import type { EvalLaneRecord } from "./eval-lanes.service";

const approvedAt = new Date("2026-11-14T12:00:00Z");
const startedAt = new Date("2026-11-14T12:01:00Z");
const productionPrefix = `${CMO_PRODUCTION_TURN_PREFIX}bot:${approvedAt.getTime()}:`;
const lane = { cusoBotId: "bot", cusoProjectId: "project" } as EvalLaneRecord;
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
