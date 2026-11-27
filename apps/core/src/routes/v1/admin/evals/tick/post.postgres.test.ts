import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

const enabled =
  process.env.RUN_DATABASE_INTEGRATION_TESTS === "true" &&
  process.env.DATABASE_URL?.startsWith("postgres");

const { env, outcomes, sendEmail } = vi.hoisted(() => ({
  /** What this Core's `getEnv()` says on top of the real values. */
  env: {} as { NETWORK?: "Mainnet" | "Preprod"; EVALS_REPORT_EMAILS?: string },
  /** Which cases have finished, per lane; a case not listed stays running. */
  outcomes: new Map<string, "PASSED" | "FAILED">(),
  sendEmail: vi.fn(async (_input: unknown) => ({ id: "email-1" })),
}));

vi.mock("@/config/env", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/config/env")>();
  return {
    ...actual,
    getEnv: () => ({ ...actual.getEnv(), ...env }),
    getWebAppBaseUrl: () => "https://app.sokosumi.test",
  };
});
vi.mock("@/clients/email.client", () => ({ sendEmail }));
vi.mock("@vercel/functions", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@vercel/functions")>()),
  waitUntil: vi.fn(),
}));
vi.mock("@/middleware/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/middleware/auth")>();
  const { stubAuthMiddleware } = await import(
    "@/test-fixtures/auth-middleware"
  );
  return { ...actual, authMiddleware: stubAuthMiddleware };
});

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

vi.mock("@/services/evals/eval-lanes.service", () => ({
  EVAL_LANE_COUNT: 3,
  ensureEvalLanes: vi.fn(async (count: number) =>
    Array.from({ length: count }, (_, index) => lane(index + 1)),
  ),
  getEvalLane: vi.fn(async (repeat: number) => lane(repeat)),
  prepareEvalLane: vi.fn(async () => undefined),
  pauseEvalLanes: vi.fn(async () => undefined),
  evalLaneBotIds: vi.fn(async () => []),
  defaultEvalVersions: vi.fn(async () => ({ sokoBot: "v33", cuso: "cmo-v1" })),
}));
vi.mock("@/services/soko-bot-version.service", () => ({
  isRunnableSokoBotVersionId: vi.fn(async () => true),
  resolveSokoBotVersion: vi.fn(async (id: string) => ({
    id,
    model: `model-of-${id}`,
  })),
}));
vi.mock("@/services/soko-bot-turns-sync.service", () => ({
  sokoBotTurnsSyncService: { syncActiveTurns: vi.fn(async () => undefined) },
}));
vi.mock("@/services/evals/eval-case-runner", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/services/evals/eval-case-runner")>();
  return {
    ...actual,
    startEvalCase: vi.fn(async () => ({
      kind: "started",
      turnId: null,
      state: { started: true },
    })),
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
            output: { answer: "answer" },
            turnIds: [],
          },
        };
      },
    ),
  };
});

import { databaseNow } from "@/lib/db/database-now";
import prisma from "@/lib/db/prisma";
import { OpenAPIHonoWithAuth } from "@/lib/hono";
import { pollEvalCase } from "@/services/evals/eval-case-runner";
import {
  createEvalRun,
  EVAL_RUN_TIMEOUT_MS,
} from "@/services/evals/eval-runs.service";
import { expectCoreLogWhys } from "@/test/core-log";
import mount from "./post";

const CASE = "ambiguous-request";

async function tick(): Promise<{ runId: string | null; completed: boolean }> {
  const app = new OpenAPIHonoWithAuth();
  mount(app);
  const response = await app.request("/tick", { method: "POST" });
  const body = await response.json();
  expect(response.status, JSON.stringify(body)).toBe(200);
  return body.data;
}

/** A run copied from production's database, as a fork holds it. */
async function copiedRun(status: "QUEUED" | "RUNNING", startedAt?: Date) {
  return prisma.evalRun.create({
    data: {
      trigger: "DAILY",
      status,
      startedAt: startedAt ?? null,
      suites: ["soko-bot"],
      caseIds: [CASE],
      repeats: 1,
      environment: "mainnet",
      results: {
        create: [
          {
            caseId: CASE,
            suite: "soko-bot",
            repeat: 1,
            position: 0,
            status: status === "RUNNING" ? "RUNNING" : "PENDING",
          },
        ],
      },
    },
  });
}

async function state(runId: string) {
  const run = await prisma.evalRun.findUniqueOrThrow({
    where: { id: runId },
    include: { results: true },
  });
  return {
    status: run.status,
    results: run.results.map((result) => result.status),
  };
}

/** Where this Core runs, as `evalEnvironment()` reads it. */
function runOn(where: "mainnet" | "preprod" | "preview" | "local") {
  vi.stubEnv(
    "VERCEL_ENV",
    where === "mainnet" || where === "preprod"
      ? "production"
      : where === "preview"
        ? "preview"
        : "",
  );
  env.NETWORK = where === "preprod" ? "Preprod" : "Mainnet";
}

describe.skipIf(!enabled)("POST /admin/evals/tick on PostgreSQL", () => {
  beforeEach(async () => {
    outcomes.clear();
    sendEmail.mockClear();
    vi.mocked(pollEvalCase).mockClear();
    for (const key of Object.keys(env)) delete env[key as keyof typeof env];
    await prisma.evalRun.deleteMany({});
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  afterAll(async () => {
    await prisma.evalRun.deleteMany({});
    await prisma.$disconnect();
  });

  it("waits while a copied run is running, times it out like any stuck run, then starts its own", async () => {
    expectCoreLogWhys("warn", "Timed out an eval run that was stuck", [
      "It was still running 24 hours after it started",
    ]);
    runOn("local");
    env.EVALS_REPORT_EMAILS = "evals@sokosumi.test";
    const running = await copiedRun("RUNNING", await databaseNow());
    const queued = await copiedRun("QUEUED");
    const own = await createEvalRun({ trigger: "MANUAL", caseIds: [CASE] });
    expect(own.environment).toBe("local");

    // The copied run holds the lanes: this Core neither advances it nor
    // starts its own run.
    expect(await tick()).toMatchObject({ runId: null, completed: false });
    expect(pollEvalCase).not.toHaveBeenCalled();
    expect(await state(running.id)).toEqual({
      status: "RUNNING",
      results: ["RUNNING"],
    });
    expect(await state(queued.id)).toEqual({
      status: "QUEUED",
      results: ["PENDING"],
    });
    expect(await state(own.id)).toEqual({
      status: "QUEUED",
      results: ["PENDING"],
    });

    // A day on, the copied run is stuck, as on any database.
    await prisma.evalRun.update({
      where: { id: running.id },
      data: {
        startedAt: new Date(
          (await databaseNow()).getTime() - EVAL_RUN_TIMEOUT_MS - 60_000,
        ),
      },
    });
    expect((await tick()).runId).toBe(own.id);
    expect(pollEvalCase).not.toHaveBeenCalled();
    expect(await state(running.id)).toEqual({
      status: "COMPLETED",
      results: ["ERROR"],
    });
    expect(await state(own.id)).toEqual({
      status: "RUNNING",
      results: ["RUNNING"],
    });
    expect(await state(queued.id)).toEqual({
      status: "QUEUED",
      results: ["PENDING"],
    });
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("starts mainnet's own queued run on mainnet's production as before", async () => {
    runOn("mainnet");
    const queued = await copiedRun("QUEUED");
    expect((await tick()).runId).toBe(queued.id);
    expect((await state(queued.id)).status).toBe("RUNNING");
  });

  it.each([
    ["preview", 0],
    ["local", 0],
    ["preprod", 0],
    ["mainnet", 1],
  ] as const)(
    "on %s, a regressed daily run sends %i regression emails",
    async (where, emails) => {
      runOn(where);
      env.EVALS_REPORT_EMAILS = "evals@sokosumi.test";
      // Two earlier weekly runs where the case passed.
      for (const daysAgo of [3, 2])
        await prisma.evalRun.create({
          data: {
            trigger: "DAILY",
            status: "COMPLETED",
            suites: ["soko-bot"],
            caseIds: [],
            repeats: 1,
            environment: "mainnet",
            createdAt: new Date(Date.now() - daysAgo * 86_400_000),
            results: {
              create: [
                {
                  caseId: CASE,
                  suite: "soko-bot",
                  repeat: 1,
                  position: 0,
                  status: "PASSED",
                },
              ],
            },
          },
        });
      const run = await createEvalRun({
        trigger: "DAILY",
        caseIds: [CASE],
        repeats: 1,
      });

      expect(await tick()).toMatchObject({ runId: run.id, completed: false });
      outcomes.set(`${CASE}:1`, "FAILED");
      expect(await tick()).toMatchObject({ runId: run.id, completed: true });

      expect(sendEmail).toHaveBeenCalledTimes(emails);
      if (emails)
        expect(sendEmail).toHaveBeenCalledWith(
          expect.objectContaining({
            to: ["evals@sokosumi.test"],
            idempotencyKey: `eval-regression:${run.id}`,
          }),
        );
    },
  );
});
