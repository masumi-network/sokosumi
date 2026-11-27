import { randomUUID } from "node:crypto";
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

// The lanes are real; only the model, the credits and outside calls are not.
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
vi.mock("@/helpers/user", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/helpers/user")>()),
  getCredits: vi.fn(async () => 1_000_000),
}));
vi.mock("@/services/soko-bot-version.service", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@/services/soko-bot-version.service")
  >()),
  getDefaultSokoBotVersionId: vi.fn(async () => "v33"),
  isRunnableSokoBotVersionId: vi.fn(async () => true),
  resolveSokoBotVersion: vi.fn(async (id: string) => ({
    id,
    model: `model-of-${id}`,
  })),
}));
vi.mock("@/services/soko-bot-turns-sync.service", () => ({
  sokoBotTurnsSyncService: { syncActiveTurns: vi.fn(async () => undefined) },
}));
vi.mock("@/services/evals/eval-case-runner", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@/services/evals/eval-case-runner")
  >()),
  startEvalCase: vi.fn(async () => ({
    kind: "started",
    turnId: null,
    state: { started: true },
  })),
  pollEvalCase: vi.fn(async () => ({ kind: "waiting" })),
}));

import prisma from "@/lib/db/prisma";
import { OpenAPIHonoWithAuth } from "@/lib/hono";
import { pollEvalCase, startEvalCase } from "@/services/evals/eval-case-runner";
import { getEvalLane } from "@/services/evals/eval-lanes.service";
import { createEvalRun } from "@/services/evals/eval-runs.service";
import { withFixtureSchemas } from "@/test/split-layout";
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

async function runState(runId: string) {
  const run = await prisma.evalRun.findUniqueOrThrow({
    where: { id: runId },
    include: { results: true },
  });
  return {
    status: run.status,
    results: run.results.map((result) => result.status),
  };
}

describe.skipIf(!enabled)(
  "POST /admin/evals/tick on the database's lanes",
  () => {
    beforeEach(async () => {
      await prisma.evalRun.deleteMany({});
    });

    afterEach(() => {
      vi.unstubAllEnvs();
    });

    afterAll(async () => {
      await prisma.evalRun.deleteMany({});
      await prisma.$disconnect();
    });

    it("waits while another environment's run holds the lanes: its bot and turn stay as they are", async () => {
      vi.stubEnv("VERCEL_ENV", "");
      const first = await createEvalRun({ trigger: "MANUAL", caseIds: [CASE] });
      expect(first.environment).toBe("local");
      expect((await tick()).runId).toBe(first.id);
      const lane = await getEvalLane(1);
      // The case's turn, still running on the lane's bot.
      const turn = await withFixtureSchemas((tx) =>
        tx.sokoBotTurn.create({
          data: {
            sokoBotId: lane.sokoBotId,
            requestedByUserId: lane.userId,
            workspaceId: lane.workspaceId,
            source: "CHAT",
            status: "RUNNING",
            clientTurnId: randomUUID(),
            userMessage: "Lane turn",
            capabilityNames: [],
            deadlineAt: new Date(Date.now() + 600_000),
          },
        }),
      );
      try {
        vi.stubEnv("VERCEL_ENV", "preview");
        const second = await createEvalRun({
          trigger: "MANUAL",
          caseIds: [CASE],
          sokoBotVersionId: "v-under-test",
        });
        expect(second.environment).toBe("preview");
        vi.mocked(startEvalCase).mockClear();
        vi.mocked(pollEvalCase).mockClear();

        const ticked = await tick();

        const [bot, laneTurn] = await withFixtureSchemas(async (tx) => [
          await tx.sokoBot.findUniqueOrThrow({ where: { id: lane.sokoBotId } }),
          await tx.sokoBotTurn.findUniqueOrThrow({ where: { id: turn.id } }),
        ]);
        expect(bot.versionId).toBe("v33");
        expect(laneTurn).toMatchObject({ status: "RUNNING", errorKind: null });
        expect(ticked).toMatchObject({ runId: null, completed: false });
        expect(await runState(second.id)).toEqual({
          status: "QUEUED",
          results: ["PENDING"],
        });
        expect(await runState(first.id)).toEqual({
          status: "RUNNING",
          results: ["RUNNING"],
        });
        expect(startEvalCase).not.toHaveBeenCalled();
        expect(pollEvalCase).not.toHaveBeenCalled();
      } finally {
        await withFixtureSchemas((tx) =>
          tx.sokoBotTurn.delete({ where: { id: turn.id } }),
        );
      }
    });
  },
);
