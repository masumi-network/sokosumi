import { beforeEach, describe, expect, it, vi } from "vitest";

type Turn = {
  id: string;
  parentTurnId: string | null;
  packet: unknown;
  /** The watch this turn's wait_for set, and the turn it woke. */
  wait?: { watchId: string; woke: string };
};
const turns: Turn[] = [];
vi.mock("@/lib/db/prisma", () => ({
  default: {
    sokoBotToolCall: {
      findMany: async ({ where }: { where: { turnId: { in: string[] } } }) =>
        turns.flatMap((turn) =>
          turn.wait && where.turnId.in.includes(turn.id)
            ? [{ result: { waiting: true, watchId: turn.wait.watchId } }]
            : [],
        ),
    },
    sokoBotWatch: {
      findMany: async ({ where }: { where: { id: { in: string[] } } }) =>
        turns.flatMap((turn) =>
          turn.wait && where.id.in.includes(turn.wait.watchId)
            ? [{ firedTurnId: turn.wait.woke }]
            : [],
        ),
    },
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

import type { CaseOutcome } from "./eval-case-runner";
import {
  evalInfrastructureFailure,
  guardOrganizer,
  judgeUnlessExcluded,
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

  it("checks every turn of a stored case, dependent turns included", async () => {
    // A strategy case: the plan turn, then two finish turns Core started
    // afterwards (no parent link). Only the second finish lost its read.
    turns.push(
      { id: "plan", parentTurnId: null, packet: organized({ ms: 900 }) },
      { id: "finish-1", parentTurnId: null, packet: organized({ ms: 800 }) },
      { id: "finish-2", parentTurnId: null, packet: TIMED_OUT },
    );
    const scored: CaseOutcome = {
      status: "PASSED",
      checks: [{ label: "Month full", pass: true, actual: "24 of 24" }],
      output: { answer: "Done" },
      turnIds: ["plan", "finish-1", "finish-2"],
    };
    expect(await guardOrganizer(scored, PLAN)).toMatchObject({
      status: "ERROR",
      checks: [],
      turnIds: ["plan", "finish-1", "finish-2"],
      output: { infrastructure: { detail: expect.stringContaining("1 of 3") } },
    });
    expect(
      await guardOrganizer({ ...scored, status: "FAILED" }, PLAN),
    ).toMatchObject({ status: "ERROR" });
    // Scored on the gateway; ERROR and SKIPPED keep their own reason.
    expect(await guardOrganizer(scored, {})).toBe(scored);
    const skipped: CaseOutcome = { ...scored, status: "SKIPPED" };
    expect(await guardOrganizer(skipped, PLAN)).toBe(skipped);
  });

  it("counts the case's own wake (a sibling), never another case's", async () => {
    // Production is a child of the chat turn; the watch it sets wakes as a
    // second child of that chat turn, and the chat turn's own wait as a third.
    turns.push(
      { id: "chat", parentTurnId: null, packet: organized({ ms: 900 }) },
      {
        id: "make",
        parentTurnId: "chat",
        packet: organized({ ms: 900 }),
        wait: { watchId: "w1", woke: "wake" },
      },
      { id: "wake", parentTurnId: "chat", packet: organized({ ms: 900 }) },
      { id: "wake-run", parentTurnId: "wake", packet: TIMED_OUT },
      { id: "other-wake", parentTurnId: "chat", packet: TIMED_OUT },
    );
    turns[0]!.wait = { watchId: "w2", woke: "other-wake" };
    // The month's case is its production run: its wake's own run timed out.
    expect(
      await guardOrganizer(
        {
          status: "FAILED",
          checks: [],
          output: {},
          turnIds: ["make"],
        },
        PLAN,
      ),
    ).toMatchObject({
      status: "ERROR",
      output: { infrastructure: { detail: expect.stringContaining("1 of 3") } },
    });
    // Without its wake's timeout, the other case's timed-out wake is not this
    // case's: it stays scored.
    turns[3]!.packet = organized({ ms: 900 });
    const scored: CaseOutcome = {
      status: "FAILED",
      checks: [],
      output: {},
      turnIds: ["make"],
    };
    expect(await guardOrganizer(scored, PLAN)).toBe(scored);
  });

  it("never asks the judge (which stores a grade) about an excluded case", async () => {
    turns.push(
      { id: "owner", parentTurnId: null, packet: organized({ ms: 900 }) },
      { id: "follow-up", parentTurnId: null, packet: TIMED_OUT },
    );
    const judge = vi.fn(async () => ({ verdict: "pass" }));
    const graded = await judgeUnlessExcluded(
      ["owner", "follow-up"],
      { answer: "Done" },
      judge,
      PLAN,
    );
    expect(judge).not.toHaveBeenCalled();
    expect(graded).toMatchObject({
      excluded: { status: "ERROR", turnIds: ["owner", "follow-up"] },
    });
    // A clean case, and any gateway case, is judged as before.
    expect(
      await judgeUnlessExcluded(["owner", "follow-up"], {}, judge, {}),
    ).toEqual({ judged: { verdict: "pass" } });
    expect(await judgeUnlessExcluded(["owner"], {}, judge, PLAN)).toEqual({
      judged: { verdict: "pass" },
    });
    expect(judge).toHaveBeenCalledTimes(2);
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
