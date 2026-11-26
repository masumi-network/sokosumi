/**
 * Soko Bot follow-ups end to end against a disposable PostgreSQL database:
 * plans on delegated work run exactly once, schedule runs manage only their
 * own schedule, and nothing the scheduler is done with stays behind.
 * RUN_DATABASE_INTEGRATION_TESTS=true DATABASE_URL=postgresql://… pnpm --filter @sokosumi/core test src/services/soko-bot-follow-ups.postgres.test.ts
 */
import { randomUUID } from "node:crypto";
import { Channel } from "@sokosumi/database";
import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import prisma from "@/lib/db/prisma";
import { getSokoBotRuntime } from "@/lib/soko-bot/factory";
import { expectCoreLog } from "@/test/core-log";

// The flow publishes over Ably; the test env has no real key.
vi.mock("@/lib/ably/client", async () =>
  (await import("@/test/ably-client")).fakeAblyClientModule(),
);

vi.mock("@/services/soko-bot-proactive.service", async (original) => ({
  ...(await original<object>()),
  proactiveGate: async () => ({ ok: true, usedToday: 0, limit: 1_000 }),
}));

import { sokoBotControlPlane } from "./soko-bot-control-plane.service";
import { sokoBotEventsSyncService } from "./soko-bot-events-sync.service";
import { listSchedules } from "./soko-bot-runtime/schedule-reads";
import {
  type AuthorizedSokoBotRuntime,
  sokoBotRuntimeService,
} from "./soko-bot-runtime.service";
import {
  createSokoBotSchedule,
  purgeSokoBotSchedules,
  SOKO_BOT_SCHEDULE_RETENTION_MS,
} from "./soko-bot-schedule.service";
import { SokoBotSchedulesSyncService } from "./soko-bot-schedules-sync.service";

const enabled =
  process.env.RUN_DATABASE_INTEGRATION_TESTS === "true" &&
  process.env.DATABASE_URL?.startsWith("postgres");

const HOUR = 60 * 60 * 1_000;

describe.skipIf(!enabled)("Soko Bot follow-ups", () => {
  let userId: string;
  let workspaceId: string;
  let botId: string;

  beforeEach(async () => {
    // The events sync ignores events older than its first scan; start that
    // scan in the past, as on any database the sync has run on before.
    await prisma.syncMetadata.upsert({
      where: { key: "soko-events-v2" },
      create: {
        key: "soko-events-v2",
        createdAt: new Date(0),
        lastSyncedAt: new Date(0),
      },
      update: {},
    });
    userId = randomUUID();
    await prisma.user.create({
      data: {
        id: userId,
        name: "Follow-up owner",
        email: `${userId}@example.test`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    workspaceId = (await prisma.workspace.create({ data: { userId } })).id;
    // Event turns are billed: give the owner a balance to start them on.
    const grant = await prisma.transaction.create({
      data: { userId, amount: 100_000n * 10_000_000_000n },
    });
    await prisma.creditBucket.create({
      data: {
        userId,
        amount: grant.amount,
        sourceTransactionId: grant.id,
      },
    });
    botId = (
      await prisma.sokoBot.create({
        data: { userId, workspaceId, proactiveDailyLimit: 10_000 },
      })
    ).id;
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await prisma.sokoBotSchedule.deleteMany({ where: { sokoBotId: botId } });
    await prisma.task.deleteMany({ where: { workspaceId } });
    await prisma.chatRoom.deleteMany({ where: { createdByUserId: userId } });
    await prisma.sokoBot.deleteMany({ where: { id: botId } });
    await prisma.workspace.deleteMany({ where: { id: workspaceId } });
    await prisma.user.deleteMany({ where: { id: userId } });
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  /** A live turn the runtime accepts tool calls for. */
  async function liveTurn(
    capabilityNames: string[],
    source: "CHAT" | "SCHEDULE" = "CHAT",
  ) {
    return prisma.sokoBotTurn.create({
      data: {
        sokoBotId: botId,
        requestedByUserId: userId,
        workspaceId,
        source,
        status: "RUNNING",
        clientTurnId: randomUUID(),
        userMessage: "Fixture turn",
        capabilityNames,
        deadlineAt: new Date(Date.now() + HOUR),
        leaseExpiresAt: new Date(Date.now() + HOUR),
        contextSnapshot: {
          create: {
            generatedAt: new Date(),
            schemaVersion: 1,
            hash: "fixture",
            packet: { memory: { version: 0 } },
            byteSize: 0,
            tokenEstimate: 0,
            counts: {},
            omissions: {},
          },
        },
      },
    });
  }

  function tool(turnId: string, capability: string, input: unknown) {
    return sokoBotRuntimeService.executeTool({
      sessionId: `session-${turnId}`,
      turnId,
      capability: capability as never,
      toolCallId: randomUUID(),
      input,
    });
  }

  async function settle(turnId: string) {
    await prisma.sokoBotTurn.update({
      where: { id: turnId },
      data: { status: "COMPLETED", completedAt: new Date() },
    });
  }

  /** Hannah finishes: a completed event with her result, as a Coworker would post. */
  async function complete(
    taskId: string,
    comment: string,
    status = "COMPLETED",
  ) {
    await prisma.$transaction([
      prisma.taskEvent.create({
        data: {
          taskId,
          status: status as never,
          comment,
          channel: Channel.SOKOSUMI,
          userId,
        },
      }),
      prisma.task.update({
        where: { id: taskId },
        data: { status: status as never },
      }),
    ]);
  }

  async function delegateWithPlan(plan: string) {
    const chat = await liveTurn(["create_task"]);
    const task = (await tool(chat.id, "create_task", {
      name: "Research the top 3 EU AI-agent marketplaces",
      description: "Pricing, positioning, funding.",
      status: "READY",
      followUp: plan,
    })) as { id: string };
    await settle(chat.id);
    return task.id;
  }

  async function syncEvents() {
    return sokoBotEventsSyncService.syncDelegatedWork({
      abortSignal: new AbortController().signal,
      shouldContinue: () => true,
    });
  }

  async function eventTurns() {
    return prisma.sokoBotTurn.findMany({
      where: { sokoBotId: botId, source: "EVENT" },
      select: { id: true, userMessage: true, status: true },
    });
  }

  it("stores the plan create_task was given on the delegation", async () => {
    const taskId = await delegateWithPlan("Give the findings to Alex.");

    const delegation = await prisma.sokoBotDelegation.findFirstOrThrow({
      where: { taskId },
    });
    expect(delegation.followUp).toBe("Give the findings to Alex.");
    expect(delegation.followUpTurnId).toBeNull();
  });

  it("hands the plan to exactly one EVENT turn, with the result, and never again", async () => {
    const taskId = await delegateWithPlan(
      "Give Hannah's findings to Alex as a one-page brief Task.",
    );
    await complete(taskId, "Findings: Sokosumi, Agent.ai, Relevance.");

    await syncEvents();
    const [first] = await eventTurns();
    expect(first.userMessage).toContain(
      'Your plan: "Give Hannah\'s findings to Alex as a one-page brief Task."',
    );
    expect(first.userMessage).toContain(
      "Latest comment: Findings: Sokosumi, Agent.ai, Relevance.",
    );
    const delegation = await prisma.sokoBotDelegation.findFirstOrThrow({
      where: { taskId },
    });
    expect(delegation.followUpTurnId).toBe(first.id);

    // A second Coworker post on the finished Task wakes the bot again,
    // without the plan it already carried out.
    await prisma.sokoBotTurn.updateMany({
      where: { sokoBotId: botId, source: "EVENT" },
      data: { status: "COMPLETED" },
    });
    await complete(taskId, "One more source: EU AI Office report.");
    await syncEvents();
    await syncEvents();
    const turns = await eventTurns();
    expect(turns).toHaveLength(2);
    const second = turns.find((turn) => turn.id !== first.id);
    expect(second?.userMessage).not.toContain("Your plan");
  });

  it("keeps the plan pending while the Task waits for input, then runs it on completion", async () => {
    const taskId = await delegateWithPlan("Give the findings to Alex.");
    await complete(taskId, "Which currency?", "INPUT_REQUIRED");

    await syncEvents();
    const [waiting] = await eventTurns();
    expect(waiting.userMessage).toContain("Your plan for when it completes");
    expect(
      (await prisma.sokoBotDelegation.findFirstOrThrow({ where: { taskId } }))
        .followUpTurnId,
    ).toBeNull();

    await prisma.sokoBotTurn.update({
      where: { id: waiting.id },
      data: { status: "COMPLETED" },
    });
    await complete(taskId, "Findings in EUR.");
    await syncEvents();
    const done = (await eventTurns()).find((turn) => turn.id !== waiting.id);
    expect(done?.userMessage).toContain(
      'Your plan: "Give the findings to Alex."',
    );
  });

  it("runs a plan once when event syncs race on the same completion", async () => {
    const taskId = await delegateWithPlan("Give the findings to Alex.");
    await complete(taskId, "Findings: A, B, C.");

    await Promise.allSettled([syncEvents(), syncEvents(), syncEvents()]);
    await syncEvents();

    const carried = (await eventTurns()).filter((turn) =>
      turn.userMessage.includes("Your plan:"),
    );
    expect(carried).toHaveLength(1);
    const delegation = await prisma.sokoBotDelegation.findFirstOrThrow({
      where: { taskId },
    });
    expect(delegation.followUpTurnId).toBe(carried[0].id);
  });

  /** Rejects as soon as `sync` ends: a gate it was due to open stays shut. */
  function endedEarly(sync: Promise<unknown>, what: string) {
    return sync.then(
      () => Promise.reject(new Error(`${what} ended early`)),
      (error: unknown) => Promise.reject(error),
    );
  }

  it("lets the losing event sync return while the winner is still starting the turn", async () => {
    const taskId = await delegateWithPlan("Give the findings to Alex.");
    await complete(taskId, "Findings: A, B, C.");
    // The winner holds after its STARTING turn commits, before the runtime
    // accepts it. The loser has read the completion as new and holds before
    // startTurn until then, so it gets the winner's turn as a duplicate.
    const runtime = getSokoBotRuntime();
    const createSession = runtime.createSession.bind(runtime);
    const winnerStarting = Promise.withResolvers<void>();
    const runtimeAccepts = Promise.withResolvers<void>();
    vi.spyOn(runtime, "createSession").mockImplementation(async (input) => {
      winnerStarting.resolve();
      await runtimeAccepts.promise;
      return createSession(input);
    });
    const startTurn = sokoBotControlPlane.startTurn.bind(sokoBotControlPlane);
    const loserStarts = Promise.withResolvers<void>();
    const winnerEnded = Promise.withResolvers<never>();
    winnerEnded.promise.catch(() => undefined);
    let loserStart: Awaited<ReturnType<typeof startTurn>> | undefined;
    vi.spyOn(sokoBotControlPlane, "startTurn").mockImplementationOnce(
      async (input) => {
        loserStarts.resolve();
        await Promise.race([winnerStarting.promise, winnerEnded.promise]);
        loserStart = await startTurn(input);
        return loserStart;
      },
    );
    const reconcile = vi.spyOn(sokoBotControlPlane, "reconcileTurn");

    const loser = syncEvents();
    let winner: ReturnType<typeof syncEvents> | undefined;
    let statusWhileStarting: string | undefined;
    try {
      await Promise.race([loserStarts.promise, endedEarly(loser, "The loser")]);
      winner = syncEvents();
      // A winner that ends before its turn commits fails the loser's start
      // instead of letting it create the only turn.
      endedEarly(winner, "The winner").catch((error: unknown) =>
        winnerEnded.reject(error),
      );
      await loser;
      statusWhileStarting = (await eventTurns())[0]?.status;
    } finally {
      winnerEnded.reject(new Error("Released"));
      runtimeAccepts.resolve();
      await Promise.allSettled([loser, winner]);
    }
    await winner;
    const [turn] = await eventTurns();
    expect(loserStart).toMatchObject({ duplicate: true, status: "STARTING" });
    expect(statusWhileStarting).toBe("STARTING");

    expect(await eventTurns()).toEqual([
      expect.objectContaining({ id: turn.id, status: "COMPLETED" }),
    ]);
    // Only the winner drains it: the loser's start was a duplicate.
    expect(reconcile).toHaveBeenCalledTimes(1);
    const delegation = await prisma.sokoBotDelegation.findFirstOrThrow({
      where: { taskId },
    });
    expect(delegation.followUpTurnId).toBe(turn.id);
  });

  it("lets the losing event sync leave a running turn to the winner", async () => {
    const taskId = await delegateWithPlan("Give the findings to Alex.");
    await complete(taskId, "Findings: A, B, C.");
    // The loser has read the completion as new and holds before startTurn
    // until the winner's runtime acknowledged the turn, so its duplicate is
    // RUNNING with a session. The winner holds before reconciling until the
    // loser's sync is done: the loser must not drain the turn itself.
    const startTurn = sokoBotControlPlane.startTurn.bind(sokoBotControlPlane);
    const loserStarts = Promise.withResolvers<void>();
    const winnerRunning = Promise.withResolvers<void>();
    const winnerEnded = Promise.withResolvers<never>();
    winnerEnded.promise.catch(() => undefined);
    const loserDone = Promise.withResolvers<void>();
    let loserStart: Awaited<ReturnType<typeof startTurn>> | undefined;
    vi.spyOn(sokoBotControlPlane, "startTurn").mockImplementationOnce(
      async (input) => {
        loserStarts.resolve();
        await Promise.race([winnerRunning.promise, winnerEnded.promise]);
        loserStart = await startTurn(input);
        return loserStart;
      },
    );
    const reconcileTurn =
      sokoBotControlPlane.reconcileTurn.bind(sokoBotControlPlane);
    // The loser waits before startTurn, so the first reconcile is the winner's.
    const reconcile = vi
      .spyOn(sokoBotControlPlane, "reconcileTurn")
      .mockImplementationOnce(async (...args) => {
        winnerRunning.resolve();
        await loserDone.promise;
        return reconcileTurn(...args);
      });

    const loser = syncEvents().finally(() => loserDone.resolve());
    let winner: ReturnType<typeof syncEvents> | undefined;
    try {
      await Promise.race([loserStarts.promise, endedEarly(loser, "The loser")]);
      winner = syncEvents();
      endedEarly(winner, "The winner").catch((error: unknown) =>
        winnerEnded.reject(error),
      );
      await loser;
      await winner;
    } finally {
      winnerEnded.reject(new Error("Released"));
      loserDone.resolve();
      await Promise.allSettled([loser, winner]);
    }

    const [turn] = await eventTurns();
    expect(loserStart).toMatchObject({ duplicate: true, status: "RUNNING" });
    expect(await eventTurns()).toEqual([
      expect.objectContaining({ id: turn.id, status: "COMPLETED" }),
    ]);
    expect(reconcile).toHaveBeenCalledTimes(1);
    const delegation = await prisma.sokoBotDelegation.findFirstOrThrow({
      where: { taskId },
    });
    expect(delegation.followUpTurnId).toBe(turn.id);
  });

  it("drains the turn when the duplicate sync resumed its start itself", async () => {
    const taskId = await delegateWithPlan("Give the findings to Alex.");
    await complete(taskId, "Findings: A, B, C.");
    // The first sync's runtime never confirms the start (twice), so its start
    // stays ambiguous and it gives up. The second sync, holding before
    // startTurn until then, resumes that start itself: it owns the drain,
    // and the runtime has already recorded the turn's whole log.
    const errors = expectCoreLog(
      "error",
      "Could not wake a Soko Bot for changes in its delegated work",
    );
    const runtime = getSokoBotRuntime();
    const createSession = runtime.createSession.bind(runtime);
    let rejections = 2;
    vi.spyOn(runtime, "createSession").mockImplementation(async (input) => {
      if (rejections > 0) {
        rejections -= 1;
        throw new DOMException("Runtime acceptance timed out", "TimeoutError");
      }
      return createSession(input);
    });
    const startTurn = sokoBotControlPlane.startTurn.bind(sokoBotControlPlane);
    const resumerStarts = Promise.withResolvers<void>();
    const firstDone = Promise.withResolvers<void>();
    let resumed: Awaited<ReturnType<typeof startTurn>> | undefined;
    vi.spyOn(sokoBotControlPlane, "startTurn").mockImplementationOnce(
      async (input) => {
        resumerStarts.resolve();
        await firstDone.promise;
        resumed = await startTurn(input);
        return resumed;
      },
    );
    const reconcile = vi.spyOn(sokoBotControlPlane, "reconcileTurn");

    const resumer = syncEvents();
    let first: ReturnType<typeof syncEvents> | undefined;
    try {
      await Promise.race([
        resumerStarts.promise,
        endedEarly(resumer, "The resumer"),
      ]);
      first = syncEvents();
      expect(await first).toMatchObject({ woken: 0, failed: 1 });
    } finally {
      firstDone.resolve();
      await Promise.allSettled([resumer, first]);
    }
    await resumer;

    expect(resumed).toMatchObject({
      duplicate: true,
      reconciliationLeaseToken: expect.any(String),
      status: "RUNNING",
    });
    const [turn] = await eventTurns();
    expect(await eventTurns()).toEqual([
      expect.objectContaining({ id: turn.id, status: "COMPLETED" }),
    ]);
    expect(reconcile).toHaveBeenCalledTimes(1);
    expect(errors).toHaveLength(1);
  });

  it("refuses to claim a plan another turn already carried out", async () => {
    const taskId = await delegateWithPlan("Give the findings to Alex.");
    const delegation = await prisma.sokoBotDelegation.findFirstOrThrow({
      where: { taskId },
    });
    const other = await liveTurn([]);
    await prisma.sokoBotDelegation.update({
      where: { id: delegation.id },
      data: { followUpTurnId: other.id },
    });
    await settle(other.id);

    await expect(
      sokoBotControlPlane.startTurn({
        userId,
        workspaceId,
        clientTurnId: `event:${randomUUID()}`,
        message: "Delegated work changed status.",
        source: "EVENT",
        presetRoute: { route: "DELEGATE_TASK", reason: "fixture" },
        eventBatch: [
          {
            eventId: randomUUID(),
            entityId: taskId,
            purpose: "TASK_EVENT",
            status: "COMPLETED",
            designatedHandlerBotId: botId,
            followUpDelegationIds: [delegation.id],
          },
        ],
      }),
    ).rejects.toThrow("already handed over");
    expect(await eventTurns()).toHaveLength(0);
  });

  describe("a schedule run's own schedule", () => {
    async function scheduleRun(capabilityNames: string[]) {
      const own = await prisma.sokoBotSchedule.create({
        data: {
          sokoBotId: botId,
          requestedByUserId: userId,
          workspaceId,
          name: "Check on Hannah",
          timezone: "UTC",
          cronExpression: "0 9 * * *",
          prompt: "Check Hannah's Task.",
          nextRunAt: new Date(Date.now() + HOUR),
          capabilityNames,
        },
      });
      const turn = await liveTurn(
        [...capabilityNames, "update_schedule", "delete_schedule"],
        "SCHEDULE",
      );
      await prisma.sokoBotScheduleRun.create({
        data: {
          scheduleId: own.id,
          turnId: turn.id,
          scheduledFor: new Date(),
          status: "RUNNING",
          attempt: 1,
        },
      });
      return { own, turn };
    }

    it("deletes its own owner-made schedule even without schedule tools", async () => {
      const { own, turn } = await scheduleRun([]);

      await tool(turn.id, "delete_schedule", { scheduleId: own.id });

      expect(
        await prisma.sokoBotSchedule.findUnique({ where: { id: own.id } }),
      ).toBeNull();
    });

    it("may not touch another schedule with tools it only has for its own", async () => {
      const { turn } = await scheduleRun([]);
      const other = await createSokoBotSchedule({
        userId,
        workspaceId,
        name: "Weekly review",
        timezone: "UTC",
        cronExpression: "0 9 * * 1",
        prompt: "Review the week.",
      });

      await expect(
        tool(turn.id, "delete_schedule", { scheduleId: other.id }),
      ).rejects.toThrow('only change its own schedule "Check on Hannah"');
      await expect(
        tool(turn.id, "update_schedule", {
          scheduleName: "Weekly review",
          enabled: false,
        }),
      ).rejects.toThrow("only change its own schedule");
      expect(
        (
          await prisma.sokoBotSchedule.findUniqueOrThrow({
            where: { id: other.id },
          })
        ).enabled,
      ).toBe(true);
    });

    it("keeps the schedule tools a bot-written schedule inherited", async () => {
      const { turn } = await scheduleRun([
        "create_schedule",
        "update_schedule",
        "delete_schedule",
      ]);
      const other = await createSokoBotSchedule({
        userId,
        workspaceId,
        name: "Stale follow-up",
        timezone: "UTC",
        cronExpression: "0 9 * * 1",
        prompt: "Old.",
      });

      await tool(turn.id, "delete_schedule", { scheduleId: other.id });

      expect(
        await prisma.sokoBotSchedule.findUnique({ where: { id: other.id } }),
      ).toBeNull();
    });
  });

  describe("cleanup", () => {
    async function oneTime(name: string, at = new Date(Date.now() - 1_000)) {
      return prisma.sokoBotSchedule.create({
        data: {
          sokoBotId: botId,
          requestedByUserId: userId,
          workspaceId,
          name,
          timezone: "UTC",
          cronExpression: "0 9 * * *",
          runOnce: true,
          prompt: `Follow up ${name}.`,
          nextRunAt: at,
        },
      });
    }

    it("leaves zero rows behind after 200 one-time follow-ups fire and settle", async () => {
      await prisma.sokoBotSchedule.createMany({
        data: Array.from({ length: 200 }, (_, index) => ({
          sokoBotId: botId,
          requestedByUserId: userId,
          workspaceId,
          name: `Follow-up ${index}`,
          timezone: "UTC",
          cronExpression: "0 9 * * *",
          runOnce: true,
          prompt: `Follow up ${index}.`,
          nextRunAt: new Date(Date.now() - 1_000 - index),
        })),
      });
      await prisma.sokoBotSchedule.create({
        data: {
          sokoBotId: botId,
          requestedByUserId: userId,
          workspaceId,
          name: "Paused by the owner",
          enabled: false,
          timezone: "UTC",
          cronExpression: "0 9 * * 1",
          prompt: "Weekly.",
          nextRunAt: new Date(Date.now() + HOUR),
        },
      });
      // Each run's turn finishes at once, the way a settled duplicate does.
      vi.spyOn(sokoBotControlPlane, "startTurn").mockImplementation(
        async (input) => {
          const turn = await prisma.sokoBotTurn.create({
            data: {
              sokoBotId: botId,
              requestedByUserId: userId,
              workspaceId,
              source: "SCHEDULE",
              status: "COMPLETED",
              clientTurnId: input.clientTurnId,
              userMessage: input.message,
              capabilityNames: [],
              deadlineAt: new Date(Date.now() + HOUR),
            },
          });
          return {
            turnId: turn.id,
            sokoBotId: botId,
            sessionId: "fixture",
            status: "COMPLETED",
            route: "DELEGATE_TASK",
            capabilities: [],
            duplicate: true,
          };
        },
      );

      const sync = new SokoBotSchedulesSyncService();
      const ours = { schedule: { sokoBotId: botId } };
      for (let tick = 0; tick < 60; tick++) {
        // Five claims a tick keeps the local pool from timing out.
        let budget = 5;
        const result = await sync.syncDueSchedules({
          shouldContinue: () => budget-- > 0,
        });
        // A run that hit a transient error retries after a delay; skip it.
        const retrying = await prisma.sokoBotScheduleRun.updateMany({
          where: { ...ours, status: "PENDING" },
          data: { leaseExpiresAt: new Date(0) },
        });
        if (result.claimed === 0 && retrying.count === 0) break;
      }
      expect(
        await prisma.sokoBotScheduleRun.count({
          where: { ...ours, status: "COMPLETED" },
        }),
      ).toBe(200);
      expect(
        await prisma.sokoBotSchedule.count({
          where: { sokoBotId: botId, runOnce: true, enabled: true },
        }),
      ).toBe(0);
      // Spent ones are already out of the bot's own list.
      const listed = (await listSchedules(
        {
          turn: { sokoBotId: botId, workspaceId, actingUserId: userId },
        } as unknown as AuthorizedSokoBotRuntime,
        {},
      )) as { schedules: { name: string }[] };
      expect(listed.schedules.map((schedule) => schedule.name)).toEqual([
        "Paused by the owner",
      ]);

      // Inside the retention window nothing goes: the Calendar shows the run.
      expect(
        (await purgeSokoBotSchedules(new Date(Date.now() + 2 * HOUR)))
          .spentOneTime,
      ).toBe(0);

      const later = new Date(
        Date.now() + SOKO_BOT_SCHEDULE_RETENTION_MS + HOUR,
      );
      const first = await purgeSokoBotSchedules(later);
      const second = await purgeSokoBotSchedules(later);
      expect(first.spentOneTime + second.spentOneTime).toBe(200);
      expect(
        await prisma.sokoBotSchedule.findMany({
          where: { sokoBotId: botId },
          select: { name: true },
        }),
      ).toEqual([{ name: "Paused by the owner" }]);
      expect(
        await prisma.sokoBotScheduleRun.count({
          where: { schedule: { sokoBotId: botId } },
        }),
      ).toBe(0);
    });

    it("keeps a failed one-time run for the retention window, then removes it", async () => {
      const schedule = await oneTime("Failed follow-up");
      await prisma.sokoBotSchedule.update({
        where: { id: schedule.id },
        data: { enabled: false, lastRunAt: schedule.nextRunAt },
      });
      await prisma.sokoBotScheduleRun.create({
        data: {
          scheduleId: schedule.id,
          scheduledFor: schedule.nextRunAt,
          status: "DEAD_LETTER",
          completedAt: new Date(),
        },
      });

      const afterGrace = new Date(Date.now() + 2 * HOUR);
      expect((await purgeSokoBotSchedules(afterGrace)).spentOneTime).toBe(0);
      const afterRetention = new Date(
        Date.now() + SOKO_BOT_SCHEDULE_RETENTION_MS + HOUR,
      );
      expect((await purgeSokoBotSchedules(afterRetention)).spentOneTime).toBe(
        1,
      );
    });

    it("never removes a schedule whose run is in flight", async () => {
      const schedule = await oneTime("Running follow-up");
      await prisma.sokoBotSchedule.update({
        where: { id: schedule.id },
        data: { enabled: false, lastRunAt: schedule.nextRunAt },
      });
      await prisma.sokoBotScheduleRun.create({
        data: {
          scheduleId: schedule.id,
          scheduledFor: schedule.nextRunAt,
          status: "RUNNING",
        },
      });

      const far = new Date(Date.now() + 2 * SOKO_BOT_SCHEDULE_RETENTION_MS);
      await purgeSokoBotSchedules(far);

      expect(
        await prisma.sokoBotSchedule.findUnique({ where: { id: schedule.id } }),
      ).not.toBeNull();
    });

    it("removes a schedule watching a Task once that Task finishes, and only then", async () => {
      const taskId = await delegateWithPlan("Report to the owner.");
      const watcher = await createSokoBotSchedule({
        userId,
        workspaceId,
        name: "Check on Hannah daily",
        timezone: "UTC",
        cronExpression: "0 9 * * *",
        prompt: `Check Task ${taskId}.`,
        taskId,
      });
      expect(watcher.taskId).toBe(taskId);

      expect((await purgeSokoBotSchedules()).watchedWorkFinished).toBe(0);
      await complete(taskId, "Done.");
      expect((await purgeSokoBotSchedules()).watchedWorkFinished).toBe(1);
      expect(
        await prisma.sokoBotSchedule.findUnique({ where: { id: watcher.id } }),
      ).toBeNull();
    });

    it("refuses to watch a Task outside the workspace", async () => {
      await expect(
        createSokoBotSchedule({
          userId,
          workspaceId,
          name: "Watch nothing",
          timezone: "UTC",
          cronExpression: "0 9 * * *",
          prompt: "Check.",
          taskId: randomUUID(),
        }),
      ).rejects.toThrow("The Task to watch is not in this workspace");
    });

    it("removes recurring schedules the failure budget switched off, after retention", async () => {
      const failing = await createSokoBotSchedule({
        userId,
        workspaceId,
        name: "Broken check",
        timezone: "UTC",
        cronExpression: "0 9 * * *",
        prompt: "Check.",
      });
      await prisma.sokoBotSchedule.update({
        where: { id: failing.id },
        data: { enabled: false, consecutiveFailures: 5 },
      });

      expect((await purgeSokoBotSchedules()).failedRecurring).toBe(0);
      const later = new Date(
        Date.now() + SOKO_BOT_SCHEDULE_RETENTION_MS + HOUR,
      );
      expect((await purgeSokoBotSchedules(later)).failedRecurring).toBe(1);
    });

    it("drops settled runs of a recurring schedule after retention and keeps the schedule", async () => {
      const recurring = await createSokoBotSchedule({
        userId,
        workspaceId,
        name: "Every hour",
        timezone: "UTC",
        cronExpression: "0 * * * *",
        prompt: "Check.",
      });
      await prisma.sokoBotScheduleRun.createMany({
        data: Array.from({ length: 30 }, (_, index) => ({
          scheduleId: recurring.id,
          scheduledFor: new Date(Date.now() - (index + 0.5) * HOUR * 24),
          status: "COMPLETED" as const,
          completedAt: new Date(),
        })),
      });

      const result = await purgeSokoBotSchedules();

      expect(result.settledRuns).toBe(23);
      expect(
        await prisma.sokoBotScheduleRun.count({
          where: { scheduleId: recurring.id },
        }),
      ).toBe(7);
      expect(
        await prisma.sokoBotSchedule.findUnique({
          where: { id: recurring.id },
        }),
      ).not.toBeNull();
    });
  });
});
