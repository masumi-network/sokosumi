import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import type { CaseOutcome } from "./eval-case-runner";
import { infrastructureCaseOutcome } from "./eval-infrastructure";

const enabled =
  process.env.RUN_DATABASE_INTEGRATION_TESTS === "true" &&
  process.env.DATABASE_URL?.startsWith("postgres");

const lane = (repeat: number) => ({
  lane: repeat,
  userId: `user-${repeat}`,
  organizationId: `org-${repeat}`,
  workspaceId: `00000000-0000-4000-8000-00000000000${repeat}`,
  sokoBotId: `00000000-0000-4000-8000-00000000010${repeat}`,
  cusoBotId: `00000000-0000-4000-8000-00000000020${repeat}`,
  cusoProjectId: `00000000-0000-4000-8000-00000000030${repeat}`,
  world: {
    hannahUserId: "h",
    alexUserId: "a",
    marketingProjectId: "m",
    outreachProjectId: "o",
    roomId: "r",
  },
});

vi.mock("./eval-lanes.service", () => ({
  EVAL_LANE_COUNT: 3,
  ensureEvalLanes: vi.fn(async (count: number) =>
    Array.from({ length: count }, (_, index) => lane(index + 1)),
  ),
  getEvalLane: vi.fn(async (repeat: number) => lane(repeat)),
  prepareEvalLane: vi.fn(async () => undefined),
  pauseEvalLanes: vi.fn(async () => undefined),
  defaultEvalVersions: vi.fn(async () => ({ sokoBot: "v33", cuso: "cmo-v1" })),
}));

vi.mock("@/services/soko-bot-version.service", () => ({
  isRunnableSokoBotVersionId: vi.fn(async (id: string) => id !== "nope"),
  resolveSokoBotVersion: vi.fn(async (id: string) => ({
    id,
    model: `model-of-${id}`,
  })),
}));

/** Which cases pass, per repeat; a case not listed stays running. */
const outcomes = new Map<string, "PASSED" | "FAILED">();
const busy = new Set<number>();
const infrastructureOutcomes = new Map<string, CaseOutcome>();

vi.mock("./eval-case-runner", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./eval-case-runner")>();
  return {
    ...actual,
    startEvalCase: vi.fn(
      async (
        evalCase: { id: string; requires?: string },
        evalLane: { lane: number },
      ) => {
        if (busy.has(evalLane.lane)) return { kind: "busy" };
        if (evalCase.requires === "mailbox")
          return { kind: "done", outcome: actual.skipped("no mailbox") };
        return { kind: "started", turnId: null, state: { started: true } };
      },
    ),
    pollEvalCase: vi.fn(
      async (evalCase: { id: string }, evalLane: { lane: number }) => {
        const infrastructure = infrastructureOutcomes.get(
          `${evalCase.id}:${evalLane.lane}`,
        );
        if (infrastructure) return { kind: "done", outcome: infrastructure };
        const status = outcomes.get(`${evalCase.id}:${evalLane.lane}`);
        if (!status) return { kind: "waiting" };
        return {
          kind: "done",
          outcome: {
            status,
            checks: [
              { label: "Completed", pass: status === "PASSED", actual: "x" },
            ],
            output: { answer: `answer of ${evalCase.id}` },
            turnIds: [],
          },
        };
      },
    ),
  };
});

import { databaseNow } from "@/lib/db/database-now";
import prisma from "@/lib/db/prisma";
import { expectCoreLogWhys } from "@/test/core-log";
import { CMO_EVAL_CASES } from "./eval-cmo-cases";
import {
  cancelEvalRun,
  createEvalRun,
  createWeeklyEvalRun,
  EVAL_RUN_TIMEOUT_MS,
  evalWeekStart,
  getEvalRunReport,
  listEvalRuns,
  tickEvalRuns,
  WEEKLY_JUDGE_MODEL,
} from "./eval-runs.service";

const CASES = ["ambiguous-request", "inbox-summary", "chat-post"];

async function resultStates(runId: string) {
  const results = await prisma.evalResult.findMany({
    where: { runId },
    orderBy: [{ repeat: "asc" }, { position: "asc" }],
  });
  return results.map(
    (result) => `${result.repeat}:${result.caseId}=${result.status}`,
  );
}

describe.skipIf(!enabled)("eval runs", () => {
  beforeEach(async () => {
    outcomes.clear();
    infrastructureOutcomes.clear();
    busy.clear();
    await prisma.evalRun.deleteMany({});
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("starts a month result on PostgreSQL time so its turns fall inside the result window", async () => {
    const month = CMO_EVAL_CASES.find((item) => item.kind === "cmo-month");
    if (!month) throw new Error("Missing month eval fixture");
    const run = await createEvalRun({ trigger: "MANUAL", caseIds: [month.id] });
    const before = await databaseNow();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(before.getTime() + 60 * 60_000);

    await tickEvalRuns();

    const [{ startedAt }] = await prisma.evalResult.findMany({
      where: { runId: run.id },
    });
    expect(startedAt?.getTime()).toBeGreaterThanOrEqual(before.getTime());
    expect(startedAt?.getTime()).toBeLessThanOrEqual(
      (await databaseNow()).getTime(),
    );
  });

  afterAll(async () => {
    await prisma.evalRun.deleteMany({});
    await prisma.$disconnect();
  });

  it("creates one result per case and repeat, in run order, on the versions in use", async () => {
    const run = await createEvalRun({
      trigger: "MANUAL",
      caseIds: CASES,
      repeats: 2,
      commit: { sha: "abcdef1", message: "feat: x (#42)" },
    });
    expect(run.status).toBe("QUEUED");
    expect(run.suites).toEqual(["soko-bot"]);
    expect(run.environment).toBe("local");
    expect(run.prNumber).toBe(42);
    expect(run.models).toEqual({
      sokoBotVersionId: "v33",
      cusoVersionId: "cmo-v1",
    });
    expect(await resultStates(run.id)).toEqual([
      "1:ambiguous-request=PENDING",
      "1:inbox-summary=PENDING",
      "1:chat-post=PENDING",
      "2:ambiguous-request=PENDING",
      "2:inbox-summary=PENDING",
      "2:chat-post=PENDING",
    ]);
  });

  it("runs the weekly run once a week, two lanes; a started run defaults to one", async () => {
    const weekly = await createWeeklyEvalRun();
    expect(weekly?.repeats).toBe(2);
    expect(weekly?.trigger).toBe("DAILY");
    expect(await createWeeklyEvalRun()).toBeNull();
    const manual = await createEvalRun({
      trigger: "MANUAL",
      caseIds: ["ambiguous-request"],
    });
    expect(manual.repeats).toBe(1);
  });

  it("starts the eval week on Monday 00:00 UTC", () => {
    const monday = new Date("2026-11-16T00:00:00.000Z");
    expect(evalWeekStart(new Date("2026-11-16T00:00:00.000Z"))).toEqual(monday);
    expect(evalWeekStart(new Date("2026-11-19T12:00:00.000Z"))).toEqual(monday);
    expect(evalWeekStart(new Date("2026-11-22T23:59:00.000Z"))).toEqual(monday);
  });

  it("refuses unknown cases, bad repeats and unknown versions", async () => {
    await expect(
      createEvalRun({ trigger: "MANUAL", caseIds: ["no-such-case"] }),
    ).rejects.toThrow("Unknown eval case: no-such-case");
    await expect(
      createEvalRun({ trigger: "MANUAL", caseIds: CASES, repeats: 4 }),
    ).rejects.toThrow("Repeats must be 1 to 3");
    await expect(
      createEvalRun({
        trigger: "MANUAL",
        caseIds: CASES,
        sokoBotVersionId: "nope",
      }),
    ).rejects.toThrow("Unknown or unapproved version: nope");
  });

  it("runs lanes side by side, settles skips at once and completes", async () => {
    const run = await createEvalRun({
      trigger: "MANUAL",
      caseIds: CASES,
      repeats: 2,
    });
    await tickEvalRuns();
    const started = await prisma.evalRun.findUniqueOrThrow({
      where: { id: run.id },
    });
    expect(started.status).toBe("RUNNING");
    expect(started.models).toMatchObject({
      sokoBotVersionId: "v33",
      sokoBotModel: "model-of-v33",
    });
    expect(await resultStates(run.id)).toEqual([
      "1:ambiguous-request=RUNNING",
      "1:inbox-summary=PENDING",
      "1:chat-post=PENDING",
      "2:ambiguous-request=RUNNING",
      "2:inbox-summary=PENDING",
      "2:chat-post=PENDING",
    ]);

    // Still running: nothing moves.
    await tickEvalRuns();
    expect((await resultStates(run.id))[0]).toBe("1:ambiguous-request=RUNNING");

    outcomes.set("ambiguous-request:1", "PASSED");
    outcomes.set("ambiguous-request:2", "FAILED");
    busy.add(2);
    await tickEvalRuns();
    // Lane 1 skips the mailbox case at once and starts the next; lane 2's bot is busy.
    expect(await resultStates(run.id)).toEqual([
      "1:ambiguous-request=PASSED",
      "1:inbox-summary=SKIPPED",
      "1:chat-post=RUNNING",
      "2:ambiguous-request=FAILED",
      "2:inbox-summary=PENDING",
      "2:chat-post=PENDING",
    ]);

    busy.clear();
    outcomes.set("chat-post:1", "PASSED");
    outcomes.set("chat-post:2", "PASSED");
    await tickEvalRuns();
    await tickEvalRuns();
    const done = await prisma.evalRun.findUniqueOrThrow({
      where: { id: run.id },
    });
    expect(done.status).toBe("COMPLETED");
    expect(done.finishedAt).not.toBeNull();
    const { pauseEvalLanes } = await import("./eval-lanes.service");
    expect(pauseEvalLanes).toHaveBeenCalledWith(2);
  });

  it("stops unstarted cases after a confirmed budget cap and lets active work settle", async () => {
    const run = await createEvalRun({
      trigger: "MANUAL",
      caseIds: CASES,
      repeats: 2,
    });
    const queued = await createEvalRun({
      trigger: "MANUAL",
      caseIds: ["chat-post"],
      repeats: 1,
    });
    await tickEvalRuns();
    const { startEvalCase } = await import("./eval-case-runner");
    const startedCount = vi.mocked(startEvalCase).mock.calls.length;
    infrastructureOutcomes.set("ambiguous-request:1", {
      ...infrastructureCaseOutcome(
        "turn-budget",
        {
          status: "FAILED",
          errorKind: "GatewayInternalServerError",
          errorDetail:
            "API key budget exceeded. Current spend: $400.12, limit: $400.00.",
        },
        {},
      )!,
      turnIds: [],
    });
    await tickEvalRuns();
    expect(await resultStates(run.id)).toEqual([
      "1:ambiguous-request=ERROR",
      "1:inbox-summary=ERROR",
      "1:chat-post=ERROR",
      "2:ambiguous-request=RUNNING",
      "2:inbox-summary=PENDING",
      "2:chat-post=PENDING",
    ]);
    expect(vi.mocked(startEvalCase).mock.calls).toHaveLength(startedCount);
    const notExecuted = await prisma.evalResult.findMany({
      where: {
        runId: run.id,
        status: "ERROR",
        turnId: null,
        caseId: { not: "ambiguous-request" },
      },
    });
    expect(notExecuted).toHaveLength(2);
    expect(
      notExecuted.every(
        (row) =>
          row.error?.startsWith("Not executed:") &&
          (row.output as { notExecuted?: boolean }).notExecuted,
      ),
    ).toBe(true);
    expect(
      (await prisma.evalRun.findUniqueOrThrow({ where: { id: queued.id } }))
        .status,
    ).toBe("QUEUED");
    outcomes.set("ambiguous-request:2", "PASSED");
    expect(await tickEvalRuns()).toEqual({ runId: run.id, completed: true });
    expect(
      await prisma.evalResult.count({
        where: {
          runId: run.id,
          status: "ERROR",
          caseId: { not: "ambiguous-request" },
        },
      }),
    ).toBe(4);
    expect(vi.mocked(startEvalCase).mock.calls).toHaveLength(startedCount);
    expect(
      (await prisma.evalRun.findUniqueOrThrow({ where: { id: queued.id } }))
        .status,
    ).toBe("QUEUED");
  });

  it.each([
    ["runner_exited", "The runner ended with exit code 1"],
    ["GatewayInternalServerError", "Temporary upstream failure"],
  ])(
    "continues the lane after a nonfatal %s execution error",
    async (errorKind, errorDetail) => {
      const run = await createEvalRun({
        trigger: "MANUAL",
        caseIds: CASES,
        repeats: 1,
      });
      await tickEvalRuns();
      infrastructureOutcomes.set("ambiguous-request:1", {
        ...infrastructureCaseOutcome(
          "turn-transient",
          { status: "FAILED", errorKind, errorDetail },
          {},
        )!,
        turnIds: [],
      });
      await tickEvalRuns();
      expect(await resultStates(run.id)).toEqual([
        "1:ambiguous-request=ERROR",
        "1:inbox-summary=SKIPPED",
        "1:chat-post=RUNNING",
      ]);
    },
  );

  it("queues a second run until the first is done", async () => {
    const first = await createEvalRun({
      trigger: "MANUAL",
      caseIds: ["ambiguous-request"],
      repeats: 1,
    });
    const second = await createEvalRun({
      trigger: "MANUAL",
      caseIds: ["chat-post"],
      repeats: 1,
    });
    expect((await tickEvalRuns()).runId).toBe(first.id);
    expect(
      (await prisma.evalRun.findUniqueOrThrow({ where: { id: second.id } }))
        .status,
    ).toBe("QUEUED");
    outcomes.set("ambiguous-request:1", "PASSED");
    expect(await tickEvalRuns()).toEqual({ runId: first.id, completed: true });
    expect((await tickEvalRuns()).runId).toBe(second.id);
  });

  it("compares with earlier daily runs: regressed, fixed, flaky, failing", async () => {
    // Two earlier daily runs on main.
    for (const [index, states] of [
      { regress: "PASSED", fix: "FAILED", flaky: "FAILED", fail: "FAILED" },
      { regress: "PASSED", fix: "FAILED", flaky: "PASSED", fail: "FAILED" },
    ].entries()) {
      await prisma.evalRun.create({
        data: {
          trigger: "DAILY",
          status: "COMPLETED",
          suites: ["soko-bot"],
          caseIds: [],
          repeats: 1,
          environment: "mainnet",
          prNumber: 100 + index,
          createdAt: new Date(Date.now() - (3 - index) * 86_400_000),
          results: {
            create: [
              {
                caseId: "ambiguous-request",
                suite: "soko-bot",
                repeat: 1,
                position: 0,
                status: states.regress as "PASSED",
              },
              {
                caseId: "chat-post",
                suite: "soko-bot",
                repeat: 1,
                position: 1,
                status: states.fix as "FAILED",
              },
              {
                caseId: "chat-catch-up",
                suite: "soko-bot",
                repeat: 1,
                position: 2,
                status: states.flaky as "FAILED",
              },
              {
                caseId: "files-review",
                suite: "soko-bot",
                repeat: 1,
                position: 3,
                status: states.fail as "FAILED",
              },
            ],
          },
        },
      });
    }
    const run = await prisma.evalRun.create({
      data: {
        trigger: "MANUAL",
        status: "COMPLETED",
        suites: ["soko-bot"],
        caseIds: [],
        repeats: 2,
        environment: "mainnet",
        results: {
          create: [
            {
              caseId: "ambiguous-request",
              suite: "soko-bot",
              repeat: 1,
              position: 0,
              status: "FAILED",
            },
            {
              caseId: "ambiguous-request",
              suite: "soko-bot",
              repeat: 2,
              position: 0,
              status: "FAILED",
            },
            {
              caseId: "chat-post",
              suite: "soko-bot",
              repeat: 1,
              position: 1,
              status: "PASSED",
            },
            {
              caseId: "chat-post",
              suite: "soko-bot",
              repeat: 2,
              position: 1,
              status: "PASSED",
            },
            {
              caseId: "chat-catch-up",
              suite: "soko-bot",
              repeat: 1,
              position: 2,
              status: "FAILED",
            },
            {
              caseId: "chat-catch-up",
              suite: "soko-bot",
              repeat: 2,
              position: 2,
              status: "PASSED",
            },
            {
              caseId: "files-review",
              suite: "soko-bot",
              repeat: 1,
              position: 3,
              status: "FAILED",
            },
            {
              caseId: "files-review",
              suite: "soko-bot",
              repeat: 2,
              position: 3,
              status: "FAILED",
            },
          ],
        },
      },
    });
    const report = await getEvalRunReport(run.id);
    const byCase = Object.fromEntries(
      report.cases.map((evalCase) => [evalCase.caseId, evalCase]),
    );
    expect(report.baseline?.prNumber).toBe(101);
    expect(byCase["ambiguous-request"]?.outcome).toBe("regressed");
    expect(byCase["chat-post"]?.outcome).toBe("fixed");
    expect(byCase["chat-catch-up"]?.outcome).toBe("flaky");
    expect(byCase["files-review"]?.outcome).toBe("failing");
    expect(byCase["ambiguous-request"]?.history).toEqual([1, 1]);
    expect(byCase["ambiguous-request"]?.area).toBe("Judgment");
    expect(report.summary.counts).toMatchObject({
      regressed: 1,
      fixed: 1,
      flaky: 1,
      failing: 1,
    });

    const listed = await listEvalRuns(10);
    expect(listed[0]?.id).toBe(run.id);
    expect(listed[0]?.scores["soko-bot"]).toMatchObject({
      passed: 3,
      scored: 8,
      passRate: 0.375,
    });
  });

  it("flags a case that costs more than 1.3 times its usual weekly cost", async () => {
    for (let index = 0; index < 3; index += 1)
      await prisma.evalRun.create({
        data: {
          trigger: "DAILY",
          status: "COMPLETED",
          suites: ["soko-bot"],
          caseIds: [],
          repeats: 1,
          environment: "mainnet",
          createdAt: new Date(Date.now() - (4 - index) * 86_400_000),
          results: {
            create: [
              {
                caseId: "chat-post",
                suite: "soko-bot",
                repeat: 1,
                position: 0,
                status: "PASSED",
                costUsdMicros: BigInt(100_000 + index * 10_000),
                durationMs: 60_000,
              },
              {
                caseId: "ambiguous-request",
                suite: "soko-bot",
                repeat: 1,
                position: 1,
                status: "PASSED",
                costUsdMicros: BigInt(100_000),
                durationMs: 60_000,
              },
            ],
          },
        },
      });
    const run = await prisma.evalRun.create({
      data: {
        trigger: "MANUAL",
        status: "COMPLETED",
        suites: ["soko-bot"],
        caseIds: [],
        repeats: 1,
        environment: "mainnet",
        results: {
          create: [
            {
              caseId: "chat-post",
              suite: "soko-bot",
              repeat: 1,
              position: 0,
              status: "PASSED",
              costUsdMicros: BigInt(200_000),
              durationMs: 60_000,
            },
            {
              caseId: "ambiguous-request",
              suite: "soko-bot",
              repeat: 1,
              position: 1,
              status: "PASSED",
              costUsdMicros: BigInt(110_000),
              durationMs: 200_000,
            },
          ],
        },
      },
    });
    const report = await getEvalRunReport(run.id);
    const byCase = Object.fromEntries(
      report.cases.map((evalCase) => [evalCase.caseId, evalCase]),
    );
    expect(byCase["chat-post"]).toMatchObject({
      costUsd: 0.2,
      usualCostUsd: 0.11,
      costlier: true,
      slower: false,
    });
    expect(byCase["ambiguous-request"]).toMatchObject({
      costlier: false,
      durationMs: 200_000,
      usualDurationMs: 60_000,
      slower: true,
    });
    expect(report.summary).toMatchObject({ costlier: 1, slower: 1 });
  });

  it("keeps errors, stale weeks and extra repeats out of the comparison", async () => {
    const weekly = (
      index: number,
      rows: {
        caseId: string;
        status: "PASSED" | "FAILED" | "ERROR";
        cost?: number;
      }[],
    ) =>
      prisma.evalRun.create({
        data: {
          trigger: "DAILY",
          status: "COMPLETED",
          suites: ["soko-bot"],
          caseIds: [],
          repeats: 1,
          environment: "mainnet",
          createdAt: new Date(Date.now() - (10 - index) * 86_400_000),
          results: {
            create: rows.map((row, position) => ({
              caseId: row.caseId,
              suite: "soko-bot",
              repeat: 1,
              position,
              status: row.status,
              costUsdMicros:
                row.cost === undefined ? null : BigInt(row.cost * 1e6),
              durationMs: row.cost === undefined ? null : 60_000,
            })),
          },
        },
      });
    // Weeks 6–8 (oldest) measured chat-post; the five recent weeks could
    // only error, so they have no cost and no verdict.
    for (let index = 0; index < 8; index += 1)
      await weekly(
        index,
        index < 3
          ? [{ caseId: "chat-post", status: "PASSED", cost: 1 }]
          : [{ caseId: "chat-post", status: "ERROR" }],
      );
    const run = await prisma.evalRun.create({
      data: {
        trigger: "MANUAL",
        status: "COMPLETED",
        suites: ["soko-bot"],
        caseIds: [],
        repeats: 2,
        environment: "mainnet",
        results: {
          create: [
            {
              caseId: "chat-post",
              suite: "soko-bot",
              repeat: 1,
              position: 0,
              status: "PASSED",
              costUsdMicros: BigInt(4_000_000),
              durationMs: 240_000,
            },
            {
              caseId: "chat-post",
              suite: "soko-bot",
              repeat: 2,
              position: 0,
              status: "PASSED",
              costUsdMicros: BigInt(4_000_000),
              durationMs: 240_000,
            },
            {
              caseId: "files-review",
              suite: "soko-bot",
              repeat: 1,
              position: 1,
              status: "FAILED",
            },
          ],
        },
      },
    });
    const report = await getEvalRunReport(run.id);
    const chatPost = report.cases.find(
      (evalCase) => evalCase.caseId === "chat-post",
    );
    expect(chatPost).toMatchObject({
      outcome: "passing",
      usualCostUsd: null,
      costlier: false,
      slower: false,
    });
    expect(chatPost?.history.slice(0, 5)).toEqual([
      null,
      null,
      null,
      null,
      null,
    ]);
    expect(report.summary.passRate).toBe(0.5);
    const listed = await listEvalRuns(1);
    expect(listed[0]?.id).toBe(run.id);
    expect(listed[0]?.scores["soko-bot"]?.passRate).toBe(0.5);
  });

  it("compares with the last week that gave a verdict, past a week of errors only", async () => {
    // Codex round 9: weeks at 100%, then an error-only week, then a failure.
    for (const [index, status] of (
      ["PASSED", "PASSED", "PASSED", "ERROR"] as const
    ).entries())
      await prisma.evalRun.create({
        data: {
          trigger: "DAILY",
          status: "COMPLETED",
          suites: ["soko-bot"],
          caseIds: [],
          repeats: 1,
          environment: "mainnet",
          createdAt: new Date(Date.now() - (5 - index) * 86_400_000),
          results: {
            create: [
              {
                caseId: "chat-post",
                suite: "soko-bot",
                repeat: 1,
                position: 0,
                status,
              },
            ],
          },
        },
      });
    const run = await prisma.evalRun.create({
      data: {
        trigger: "MANUAL",
        status: "COMPLETED",
        suites: ["soko-bot"],
        caseIds: [],
        repeats: 1,
        environment: "mainnet",
        results: {
          create: [
            {
              caseId: "chat-post",
              suite: "soko-bot",
              repeat: 1,
              position: 0,
              status: "FAILED",
            },
          ],
        },
      },
    });
    const report = await getEvalRunReport(run.id);
    expect(report.cases[0]).toMatchObject({
      caseId: "chat-post",
      outcome: "regressed",
      passRate: 0,
      baselinePassRate: 1,
    });
    expect(report.cases[0]?.history.slice(0, 2)).toEqual([null, 1]);
  });

  it("gives judged cases a second repeat in the weekly run, judged by the cheaper model", async () => {
    const weekly = await createWeeklyEvalRun();
    if (!weekly) throw new Error("No weekly run");
    expect(weekly.repeats).toBe(2);
    const results = await prisma.evalResult.findMany({
      where: { runId: weekly.id },
      select: { caseId: true, repeat: true },
    });
    const { evalCase, isJudgedEvalCase } = await import("./eval-cases");
    const second = results.filter((result) => result.repeat === 2);
    expect(second.length).toBeGreaterThan(0);
    expect(
      second.every((result) => {
        const found = evalCase(result.caseId);
        return found !== undefined && isJudgedEvalCase(found);
      }),
    ).toBe(true);
    expect(
      results.filter((result) => result.repeat === 1).length,
    ).toBeGreaterThan(second.length);

    const { pollEvalCase } = await import("./eval-case-runner");
    vi.mocked(pollEvalCase).mockClear();
    await tickEvalRuns();
    await tickEvalRuns();
    const contexts = vi
      .mocked(pollEvalCase)
      .mock.calls.map((call) => call[3]?.judgeModel);
    expect(contexts.length).toBeGreaterThan(0);
    expect(new Set(contexts)).toEqual(new Set([WEEKLY_JUDGE_MODEL]));
  });

  it("times out a run stuck for a day so the next run starts", async () => {
    expectCoreLogWhys("warn", "Timed out an eval run that was stuck", [
      "It was still running 24 hours after it started",
    ]);
    const stuck = await createEvalRun({
      trigger: "MANUAL",
      caseIds: ["ambiguous-request", "chat-post"],
      repeats: 1,
    });
    const next = await createEvalRun({
      trigger: "MANUAL",
      caseIds: ["chat-post"],
      repeats: 1,
    });
    await tickEvalRuns();
    await prisma.evalRun.update({
      where: { id: stuck.id },
      data: {
        startedAt: new Date(
          (await databaseNow()).getTime() - EVAL_RUN_TIMEOUT_MS - 60_000,
        ),
      },
    });
    expect((await tickEvalRuns()).runId).toBe(next.id);
    const ended = await prisma.evalRun.findUniqueOrThrow({
      where: { id: stuck.id },
    });
    expect(ended.status).toBe("COMPLETED");
    expect(await resultStates(stuck.id)).toEqual([
      "1:ambiguous-request=ERROR",
      "1:chat-post=ERROR",
    ]);
  });

  it("cancels a run: what had not finished is skipped", async () => {
    const run = await createEvalRun({
      trigger: "MANUAL",
      caseIds: ["ambiguous-request", "chat-post"],
      repeats: 1,
    });
    await tickEvalRuns();
    const cancelled = await cancelEvalRun(run.id);
    expect(cancelled.status).toBe("CANCELLED");
    expect(await resultStates(run.id)).toEqual([
      "1:ambiguous-request=SKIPPED",
      "1:chat-post=SKIPPED",
    ]);
    expect(await tickEvalRuns()).toEqual({ runId: null, completed: false });
  });
});
