import { randomUUID } from "node:crypto";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import prisma from "@/lib/db/prisma";

const TURN_LIFETIME_MS = 60_000;

import { withEvaluationActor } from "@/lib/soko-bot/evaluation-dispatch";
import { SokoBotRefusedUnsentError } from "@/services/soko-bot-runtime.service";
import {
  currentMailboxFixture,
  prepareMailboxFixture,
  withMailboxFixturePreparation,
} from "./mailbox-binding";

vi.mock("@vercel/functions", () => ({
  attachDatabasePool: vi.fn(),
  waitUntil: vi.fn(),
}));
vi.mock("@/services/soko-bot-lab-scenario.service", async (original) => {
  const actual =
    await original<typeof import("@/services/soko-bot-lab-scenario.service")>();
  return {
    ...actual,
    startLabScenarioTurn: vi.fn(async (_scenario, owner, clientTurnId) => {
      // The model boundary reads the same scoped provider records as a real packet.
      const binding = await currentMailboxFixture(owner.bot.id);
      if (!binding)
        throw new Error("Fixture was not bound before packet construction");
      const { activeIntegrationsForBot, fetchInboxPage } = await import(
        "@/services/soko-bot-integrations.service"
      );
      const [mailbox] = await activeIntegrationsForBot(
        owner.bot.id,
        "email",
        "gmail",
      );
      if (!mailbox) throw new Error("Fixture mailbox missing");
      const page = await fetchInboxPage(mailbox, {
        limit: 1,
        unreadOnly: true,
      });
      if (!page.messages.length)
        throw new Error("Fixture did not pass real normalization");
      return (
        await prisma.sokoBotTurn.create({
          data: {
            sokoBotId: owner.bot.id,
            workspaceId: owner.workspaceId,
            requestedByUserId: owner.bot.userId,
            clientTurnId,
            source: binding.source,
            status: "RUNNING",
            userMessage: "Fixture model boundary",
            deadlineAt: new Date(Date.now() + TURN_LIFETIME_MS),
            capabilityNames: [
              "search_inbox",
              "read_email",
              "list_calendar_events",
            ],
          },
          select: { id: true },
        })
      ).id;
    }),
  };
});

const enabled =
  process.env.RUN_DATABASE_INTEGRATION_TESTS === "true" &&
  (process.env.DATABASE_URL ?? "").includes("seo_v40_mailbox_fixture");
const userId = `mailbox-owner-${randomUUID()}`;
const organizationId = randomUUID();
const workspaceId = randomUUID();
const sokoBotId = randomUUID();
const lane = { lane: 3, userId, organizationId, workspaceId, sokoBotId };
const runIds: string[] = [];

describe.runIf(enabled)(
  "persisted mailbox fixture ownership against PostgreSQL",
  () => {
    beforeAll(async () => {
      if (await prisma.evalLane.findUnique({ where: { lane: lane.lane } }))
        throw new Error(
          "Use an isolated fixture database with lane three available",
        );
      await prisma.user.create({
        data: {
          id: userId,
          name: "Mailbox fixture owner",
          email: `${userId}@example.invalid`,
          emailVerified: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      });
      await prisma.organization.create({
        data: {
          id: organizationId,
          name: "Mailbox fixture",
          slug: "sokosumi-evals-3",
          members: {
            create: { userId, role: "owner", seatAssignedAt: new Date() },
          },
        },
      });
      await prisma.workspace.create({
        data: { id: workspaceId, organizationId },
      });
      await prisma.sokoBot.create({
        data: {
          id: sokoBotId,
          userId,
          workspaceId,
          status: "RUNNING",
          proactivePaused: true,
        },
      });
      await prisma.evalLane.create({ data: { ...lane, world: {} } });
    });
    afterAll(async () => {
      await prisma.evalRun.deleteMany({ where: { id: { in: runIds } } });
      await prisma.evalLane.deleteMany({ where: { lane: lane.lane, userId } });
      await prisma.workspace.deleteMany({ where: { id: workspaceId } });
      await prisma.organization.deleteMany({ where: { id: organizationId } });
      await prisma.user.deleteMany({ where: { id: userId } });
      await prisma.$disconnect();
    });
    afterEach(async () => {
      await prisma.sokoBotTurn.updateMany({
        where: { sokoBotId },
        data: { status: "COMPLETED" },
      });
    });

    async function prepared(caseId = "inbox-summary") {
      const run = await prisma.evalRun.create({
        data: {
          trigger: "MANUAL",
          status: "RUNNING",
          suites: ["soko-bot"],
          caseIds: [caseId],
          repeats: 3,
          environment: "local",
        },
      });
      runIds.push(run.id);
      const result = await prisma.evalResult.create({
        data: {
          runId: run.id,
          suite: "soko-bot",
          caseId,
          repeat: lane.lane,
          position: 0,
        },
      });
      const binding = await prepareMailboxFixture({
        resultId: result.id,
        caseId,
        referenceTime: new Date(),
        lane,
      });
      if (!binding) throw new Error("Fixture preparation failed");
      return binding;
    }
    function asActor<T>(
      binding: Awaited<ReturnType<typeof prepared>>,
      run: () => T,
    ) {
      return withEvaluationActor(
        {
          userId,
          sokoBotId,
          clientTurnId: binding.clientTurnId,
          source: binding.source,
        },
        run,
      );
    }
    async function active(binding: Awaited<ReturnType<typeof prepared>>) {
      const turn = await prisma.sokoBotTurn.create({
        data: {
          sokoBotId,
          workspaceId,
          requestedByUserId: userId,
          clientTurnId: binding.clientTurnId,
          source: binding.source,
          status: "RUNNING",
          userMessage: "Mailbox fixture",
          deadlineAt: new Date(Date.now() + TURN_LIFETIME_MS),
          capabilityNames: [
            "search_inbox",
            "read_email",
            "list_calendar_events",
          ],
        },
      });
      return turn;
    }

    it("persists one reference clock before initial reads and denies unstarted replay", async () => {
      const binding = await prepared();
      expect(
        await withMailboxFixturePreparation(binding, () =>
          currentMailboxFixture(sokoBotId),
        ),
      ).toEqual(binding);
      expect(await currentMailboxFixture(sokoBotId)).toBeNull();
      await expect(
        asActor(binding, () => currentMailboxFixture()),
      ).rejects.toThrow("turn missing");
      const retried = await prepareMailboxFixture({
        resultId: binding.resultId,
        caseId: binding.caseId,
        referenceTime: new Date(Date.now() + 60_000),
        lane,
      });
      expect(retried?.referenceTime).toBe(binding.referenceTime);
    });

    it("permits the exact persisted startup turn while its result is still PENDING", async () => {
      const binding = await prepared();
      const turn = await active(binding);
      expect(await asActor(binding, () => currentMailboxFixture())).toEqual(
        binding,
      );
      await prisma.evalResult.update({
        where: { id: binding.resultId },
        data: { status: "RUNNING", turnId: turn.id },
      });
      expect(await asActor(binding, () => currentMailboxFixture())).toEqual(
        binding,
      );
      await expect(
        asActor(binding, () => currentMailboxFixture(randomUUID())),
      ).rejects.toThrow("actor denied");
    });

    it.each(["PASSED", "FAILED", "ERROR", "SKIPPED"] as const)(
      "denies terminal result %s",
      async (status) => {
        const binding = await prepared();
        await active(binding);
        await prisma.evalResult.update({
          where: { id: binding.resultId },
          data: { status },
        });
        await expect(
          asActor(binding, () => currentMailboxFixture()),
        ).rejects.toThrow("unavailable");
      },
    );

    it("denies cancelled runs, expired clocks, cross-lane bindings and changed case identities", async () => {
      const binding = await prepared();
      await active(binding);
      await prisma.evalRun.update({
        where: { id: binding.runId },
        data: { status: "CANCELLED" },
      });
      await expect(
        asActor(binding, () => currentMailboxFixture()),
      ).rejects.toThrow("unavailable");
      await prisma.evalRun.update({
        where: { id: binding.runId },
        data: { status: "RUNNING" },
      });
      await prisma.evalResult.update({
        where: { id: binding.resultId },
        data: {
          state: {
            mailboxFixture: {
              ...binding,
              referenceTime: "2000-01-01T00:00:00.000Z",
            },
          },
        },
      });
      await expect(
        asActor(binding, () => currentMailboxFixture()),
      ).rejects.toThrow("unavailable");
      await prisma.evalResult.update({
        where: { id: binding.resultId },
        data: {
          state: {
            mailboxFixture: { ...binding, repeat: 2 },
          },
        },
      });
      await expect(
        asActor(binding, () => currentMailboxFixture()),
      ).rejects.toThrow("unavailable");
      await prisma.evalResult.update({
        where: { id: binding.resultId },
        data: {
          caseId: "chat-post",
          state: { mailboxFixture: binding },
        },
      });
      await expect(
        asActor(binding, () => currentMailboxFixture()),
      ).rejects.toThrow("case mismatch");
    });

    it("keeps simultaneous actor contexts separate and denies foreign owner or completed turns", async () => {
      const first = await prepared();
      const second = await prepared("calendar-prep");
      await active(first);
      const secondTurn = await active(second);
      const values = await Promise.all([
        asActor(first, () => currentMailboxFixture()),
        asActor(second, () => currentMailboxFixture()),
      ]);
      expect(values.map((value) => value?.resultId)).toEqual([
        first.resultId,
        second.resultId,
      ]);
      await expect(
        withEvaluationActor(
          {
            userId: "other",
            sokoBotId,
            clientTurnId: first.clientTurnId,
            source: first.source,
          },
          () => currentMailboxFixture(),
        ),
      ).rejects.toThrow("actor denied");
      await prisma.sokoBotTurn.update({
        where: { id: secondTurn.id },
        data: { status: "COMPLETED" },
      });
      await expect(
        asActor(second, () => currentMailboxFixture()),
      ).rejects.toThrow("turn denied");
    });

    it("restores runtime identity and rejects provider writes before their dispatch", async () => {
      const binding = await prepared();
      const turn = await active(binding);
      const { withEvalScenarioTurn } = await import("./scenario-turn");
      expect(
        await withEvalScenarioTurn(
          turn.id,
          () => currentMailboxFixture(),
          "search_inbox",
        ),
      ).toEqual(binding);
      let dispatched = false;
      for (const capability of [
        "draft_email",
        "send_email_draft",
        "update_emails",
        "save_email_attachment",
        "run_integration_tool",
      ]) {
        await expect(
          withEvalScenarioTurn(
            turn.id,
            () => {
              dispatched = true;
            },
            capability,
          ),
        ).rejects.toBeInstanceOf(SokoBotRefusedUnsentError);
      }
      expect(dispatched).toBe(false);
      await prisma.evalRun.delete({ where: { id: binding.runId } });
      await expect(
        withEvalScenarioTurn(
          turn.id,
          () => {
            dispatched = true;
          },
          "search_inbox",
        ),
      ).rejects.toBeInstanceOf(SokoBotRefusedUnsentError);
      expect(dispatched).toBe(false);
    });

    it("starts the formerly skipped mailbox case with fixtures bound before the model packet", async () => {
      const binding = await prepared();
      const { startEvalCase } = await import(
        "@/services/evals/eval-case-runner"
      );
      const { evalCase } = await import("@/services/evals/eval-cases");
      const definition = evalCase(binding.caseId);
      if (!definition) throw new Error("Missing mailbox case");
      const result = await startEvalCase(
        definition,
        {
          ...lane,
          cusoBotId: randomUUID(),
          cusoProjectId: randomUUID(),
          world: {
            hannahUserId: userId,
            alexUserId: userId,
            marketingProjectId: randomUUID(),
            outreachProjectId: randomUUID(),
            roomId: randomUUID(),
          },
        },
        {
          resultId: binding.resultId,
          firstOfSuite: false,
          startedAt: new Date(),
        },
      );
      expect(result.kind).toBe("started");
      if (result.kind !== "started")
        throw new Error("Mailbox case was skipped");
      expect(result.state.mailboxFixture).toEqual(binding);
      expect(
        await prisma.sokoBotIntegration.count({ where: { sokoBotId } }),
      ).toBe(0);
      const retried = await startEvalCase(
        definition,
        {
          ...lane,
          cusoBotId: randomUUID(),
          cusoProjectId: randomUUID(),
          world: {
            hannahUserId: userId,
            alexUserId: userId,
            marketingProjectId: randomUUID(),
            outreachProjectId: randomUUID(),
            roomId: randomUUID(),
          },
        },
        {
          resultId: binding.resultId,
          firstOfSuite: false,
          startedAt: new Date(),
        },
      );
      expect(retried).toEqual(result);
      expect(
        await prisma.sokoBotTurn.count({
          where: { sokoBotId, clientTurnId: binding.clientTurnId },
        }),
      ).toBe(1);
    });
  },
);
