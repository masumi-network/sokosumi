import { beforeEach, describe, expect, it, vi } from "vitest";

type Turn = { id: string; parentTurnId: string | null; packet: unknown };
const turns: Turn[] = [];
vi.mock("@/lib/db/prisma", () => ({
  default: {
    sokoBotTurn: {
      findMany: async ({
        where,
      }: {
        where: { parentTurnId: { in: string[] }; id: { notIn: string[] } };
      }) =>
        turns.filter(
          (turn) =>
            turn.parentTurnId !== null &&
            where.parentTurnId.in.includes(turn.parentTurnId) &&
            !where.id.notIn.includes(turn.id),
        ),
    },
    sokoBotContextSnapshot: {
      findMany: async ({ where }: { where: { turnId: { in: string[] } } }) =>
        turns.filter((turn) => where.turnId.in.includes(turn.id)),
    },
  },
}));

import {
  evalInfrastructureFailure,
  organizerCaseOutcome,
  organizerFailure,
} from "./eval-infrastructure";

const organized = (jev: unknown) => ({
  workspace: { marketing: { organizer: { kind: "chat", jev } } },
});
const TIMED_OUT = organized({ ms: 4_000, asked: 4, failed: "TimeoutError" });
const PLAN = { SOKO_BOT_LOCAL_CHATGPT_PLAN: "1" };

describe("a context organizer that lost its read", () => {
  beforeEach(() => {
    turns.length = 0;
  });

  it("counts only organized turns whose Jev read failed", () => {
    expect(
      organizerFailure([organized({ ms: 900, asked: 4 }), {}, null]),
    ).toBeNull();
    expect(
      organizerFailure([organized({ ms: 900, asked: 4 }), TIMED_OUT, {}]),
    ).toMatchObject({
      code: "context_organizer_failed",
      stopsRun: false,
      detail: expect.stringContaining("1 of 2 organized turn(s)"),
    });
  });

  it("makes a plan case ERROR when a background run's read failed", async () => {
    turns.push(
      { id: "case", parentTurnId: null, packet: organized({ ms: 900 }) },
      { id: "run", parentTurnId: "case", packet: TIMED_OUT },
    );
    expect(
      await organizerCaseOutcome(["case"], { answer: "Done" }, PLAN),
    ).toMatchObject({
      status: "ERROR",
      turnIds: ["case"],
      output: {
        answer: "Done",
        infrastructure: { code: "context_organizer_failed" },
      },
    });
  });

  it("leaves a clean plan case and every gateway case scored", async () => {
    turns.push({ id: "case", parentTurnId: null, packet: TIMED_OUT });
    expect(await organizerCaseOutcome(["case"], {}, {})).toBeNull();
    turns[0].packet = organized({ ms: 30_000, asked: 4 });
    expect(await organizerCaseOutcome(["case"], {}, PLAN)).toBeNull();
  });
});

const budget = {
  status: "FAILED",
  errorKind: "GatewayInternalServerError",
  errorDetail:
    "API key budget exceeded. Current spend: $400.12, limit: $400.00.",
};

describe("typed evaluation infrastructure failures", () => {
  it("stops later eval cases for the classified budget failure", () => {
    expect(
      evalInfrastructureFailure({
        status: "FAILED",
        errorKind: "ai_budget_exceeded",
        errorDetail: "Your assistant has reached its usage limit.",
      }),
    ).toMatchObject({ code: "provider_budget_exhausted", stopsRun: true });
  });

  it("recognizes a hard provider budget cap and bounds its stored detail", () => {
    expect(evalInfrastructureFailure(budget)).toMatchObject({
      code: "provider_budget_exhausted",
      stopsRun: true,
    });
    expect(
      evalInfrastructureFailure({
        ...budget,
        errorDetail: budget.errorDetail + "x".repeat(10_000),
      })?.detail,
    ).toHaveLength(2_000);
  });

  it("keeps an unexplained runner exit separate from provider budget exhaustion", () => {
    expect(
      evalInfrastructureFailure({
        ...budget,
        errorKind: "runner_exited",
        errorDetail: "The runner ended with exit code 1",
      }),
    ).toMatchObject({
      code: "runner_exited",
      stopsRun: false,
      detail: "The runner ended with exit code 1",
    });
  });

  it("records transient provider errors without stopping later cases", () => {
    expect(
      evalInfrastructureFailure({
        ...budget,
        errorDetail: "Temporary upstream failure",
      }),
    ).toMatchObject({ code: "provider_failure", stopsRun: false });
  });

  it.each([
    { ...budget, status: "COMPLETED" },
    { ...budget, status: "RUNNING" },
    { ...budget, errorKind: "validation" },
    { ...budget, errorKind: "Error" },
    { status: "FAILED", errorKind: null, errorDetail: null },
  ])("does not disguise normal behavior or unknown failures: %j", (turn) => {
    expect(evalInfrastructureFailure(turn)).toBeNull();
  });
});
