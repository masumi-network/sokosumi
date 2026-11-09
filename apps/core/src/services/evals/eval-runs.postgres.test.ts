import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

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

import prisma from "@/lib/db/prisma";
import {
  cancelEvalRun,
  createDailyEvalRun,
  createEvalRun,
  getEvalRunReport,
  listEvalRuns,
  tickEvalRuns,
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
    busy.clear();
    await prisma.evalRun.deleteMany({});
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

  it("runs the daily run once a day, one repeat; a started run defaults to one too", async () => {
    const daily = await createDailyEvalRun();
    expect(daily?.repeats).toBe(1);
    expect(daily?.trigger).toBe("DAILY");
    expect(await createDailyEvalRun()).toBeNull();
    const manual = await createEvalRun({
      trigger: "MANUAL",
      caseIds: ["ambiguous-request"],
    });
    expect(manual.repeats).toBe(1);
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
              status: "PASSED",
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
      passed: 4,
      scored: 8,
      passRate: 0.5,
    });
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
