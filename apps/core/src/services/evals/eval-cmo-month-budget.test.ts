import { CMO_PRODUCTION_TURN_PREFIX } from "@sokosumi/soko-bot";
import { Hono } from "hono";
import { requestId } from "hono/request-id";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { errorHandler } from "@/helpers/error-handler";
import { coreEvlogMiddleware, runAsBackgroundWork } from "@/lib/evlog";
import { expectCoreLogWhys } from "@/test/core-log";
import { inRequest } from "@/test/in-request";

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
  email: vi.fn(),
}));
vi.mock("@/lib/db/prisma", () => ({
  default: {
    marketingStrategy: { findUniqueOrThrow: boundary.strategy },
    sokoBotTurn: { findMany: boundary.turns },
    socialPost: { updateMany: boundary.cancelPosts },
    evalLane: {
      findUniqueOrThrow: boundary.lane,
      findMany: vi.fn().mockResolvedValue([]),
    },
    sokoBot: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
    evalRun: { findFirst: boundary.run, update: boundary.finishRun },
    evalResult: {
      findFirst: boundary.result,
      count: boundary.resultCount,
      update: boundary.finish,
    },
  },
}));
vi.mock("./eval-report-email", () => ({
  sendEvalRegressionEmail: boundary.email,
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
          parentTurnId: { in: ["root"] },
        },
      }),
    );
    expect(boundary.turns).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({
        where: {
          sokoBotId: lane.cusoBotId,
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

  describe("a daily run's regression email", () => {
    const EMAIL_WHY = "Sending the report email failed";

    beforeEach(() => {
      boundary.run.mockResolvedValue({
        id: "run",
        repeats: 1,
        trigger: "DAILY",
      });
      boundary.resultCount.mockResolvedValue(0);
      // A mail error can quote the report: prompts and model output.
      boundary.email.mockRejectedValue(
        new Error('report "Confidential merger with Acme" sk_live_abc123'),
      );
    });

    it("logs a failed send once from the cron, without the report", async () => {
      const errors = expectCoreLogWhys(
        "error",
        "Could not send the daily eval regression email",
        [EMAIL_WHY],
      );

      expect(await runAsBackgroundWork(() => tickEvalRuns())).toEqual({
        runId: "run",
        completed: true,
      });

      expect(errors[0]?.event).toMatchObject({
        operation: "eval_tick",
        evalRun: { id: "run" },
        evalRegressionEmailFailure: { errorName: "Error" },
      });
      expect(errors[0]?.cause).toBeUndefined();
      const drained = JSON.stringify(errors[0]?.event);
      expect(drained).not.toContain("Confidential merger");
      expect(drained).not.toContain("sk_live");
    });

    it("logs a failed send on the admin tick's request event", async () => {
      const errors = expectCoreLogWhys(
        "error",
        "Could not send the daily eval regression email",
        [EMAIL_WHY],
      );

      await inRequest(() => tickEvalRuns());

      // The request's own event: no standalone operation, the route's method.
      expect(errors[0]?.event.operation).toBeUndefined();
      expect(errors[0]?.event).toMatchObject({
        method: "GET",
        evalRegressionEmailFailure: { errorName: "Error" },
      });
    });

    it("keeps a lane failure and the email failure on one error", async () => {
      const errors = expectCoreLogWhys(
        "error",
        "Could not move an eval run's lanes on",
        ["A lane's step threw"],
      );
      boundary.lane.mockRejectedValue(new Error("lane down"));

      await inRequest(() => tickEvalRuns());

      expect(errors[0]?.event).toMatchObject({
        evalLaneFailures: [{ lane: 1, errorName: "Error" }],
        evalRegressionEmailFailure: { errorName: "Error" },
      });
      expect(errors[0]?.fix).toContain("regression email failed too");
    });
  });

  it("keeps a lane failure a standalone error in the cron when completing the run throws", async () => {
    const errors = expectCoreLogWhys(
      "error",
      "Could not move an eval run's lanes on",
      ["A lane's step threw"],
    );
    boundary.lane.mockRejectedValue(new Error("lane down"));
    boundary.resultCount.mockRejectedValue(new Error("count failed"));

    // No request event carries the thrown error here, so nothing to make room for.
    await expect(runAsBackgroundWork(() => tickEvalRuns())).rejects.toThrow(
      "count failed",
    );

    expect(errors[0]?.event).toMatchObject({
      operation: "eval_tick",
      evalLaneFailures: [{ lane: 1, errorName: "Error" }],
    });
  });

  it("keeps a lane failure beside an error thrown while completing the run", async () => {
    const warnings = expectCoreLogWhys(
      "warn",
      "Could not move an eval run's lanes on",
      ["A lane's step threw"],
    );
    // The admin tick's request error, recorded by the real error handler.
    const requestErrors = expectCoreLogWhys(
      "error",
      "A request failed with an unexpected error",
      ["The route threw an error it did not handle"],
    );
    boundary.lane.mockRejectedValue(new Error("lane down"));
    boundary.resultCount.mockRejectedValue(new Error("count failed"));
    const app = new Hono();
    app.use(requestId());
    app.use(coreEvlogMiddleware());
    app.onError(errorHandler);
    app.post("/v1/admin/evals/tick", async (c) => c.json(await tickEvalRuns()));

    const response = await app.request("http://localhost/v1/admin/evals/tick", {
      method: "POST",
    });

    expect(response.status).toBe(500);
    // Both on the request's one event: the lane warning survives the error.
    expect(warnings[0]?.event).toBe(requestErrors[0]?.event);
    expect(warnings[0]?.event).toMatchObject({
      evalLaneFailures: [{ lane: 1, errorName: "Error" }],
    });
    expect(warnings[0]?.fix).toContain("evalLaneFailures");
    // The handler keeps the error's text out: Sentry has it.
    expect(JSON.stringify(requestErrors[0]?.event)).not.toContain(
      "count failed",
    );
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
