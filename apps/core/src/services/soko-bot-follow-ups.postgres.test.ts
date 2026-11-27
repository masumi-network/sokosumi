/**
 * Soko Bot follow-ups end to end against a disposable PostgreSQL database:
 * plans on delegated work run exactly once, schedule runs manage only their
 * own schedule, and nothing the scheduler is done with stays behind.
 * RUN_DATABASE_INTEGRATION_TESTS=true DATABASE_URL=postgresql://… pnpm --filter @sokosumi/core test src/services/soko-bot-follow-ups.postgres.test.ts
 */
import { randomUUID } from "node:crypto";
import { Channel } from "@sokosumi/database";
import type { SokoBotCapability } from "@sokosumi/soko-bot";
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
import {
  checkGrantSpendPreflight,
  reserveAuthoritySpend,
  settleAuthoritySpend,
} from "@/lib/soko-bot/authority-spend";
import { getSokoBotRuntime } from "@/lib/soko-bot/factory";
import {
  deriveDelegationAuthority,
  deriveWatchAuthority,
  evaluateSocialWriteAuthority,
  resolveSocialWriteOrigin,
  resolveSocialWriteOriginSource,
  resolveWorkItemParentAuthority,
  SCHEDULE_AUTHORITY_EXPIRED_MESSAGE,
  SCHEDULE_AUTHORITY_INVALID_MESSAGE,
  SCHEDULE_AUTHORITY_REVOKED_MESSAGE,
  SCHEDULE_AUTHORITY_SCOPE_MISMATCH_MESSAGE,
  SCHEDULE_AUTHORITY_UNAVAILABLE_MESSAGE,
  SCHEDULE_SOCIAL_DRAFT_ONLY_MESSAGE,
  SCHEDULE_SOCIAL_PUBLISH_BLOCKED_MESSAGE,
  WATCH_AUTHORITY_EXPIRED_MESSAGE,
  WATCH_AUTHORITY_INVALID_MESSAGE,
  WATCH_AUTHORITY_REVOKED_MESSAGE,
  WATCH_AUTHORITY_SCOPE_MISMATCH_MESSAGE,
  WATCH_AUTHORITY_UNAVAILABLE_MESSAGE,
  WATCH_SOCIAL_DRAFT_ONLY_MESSAGE,
} from "@/lib/soko-bot/owner-authority";
import { inheritedScheduleRoute } from "@/lib/soko-bot/system-routes";
import { mayMakeMediaForOwner } from "@/services/soko-bot-runtime/media-checks";
import { expectCoreLog } from "@/test/core-log";

vi.mock("@/services/x-subscription-tier.service", async (original) => ({
  ...(await original<object>()),
  resolveXSubscriptionType: async (connection: {
    subscriptionType: string | null;
  }) => connection.subscriptionType,
}));

// The flow publishes over Ably; the test env has no real key.
vi.mock("@/lib/ably/client", async () =>
  (await import("@/test/ably-client")).fakeAblyClientModule(),
);

vi.mock("@/services/soko-bot-proactive.service", async (original) => ({
  ...(await original<object>()),
  proactiveGate: async () => ({ ok: true, usedToday: 0, limit: 1_000 }),
}));

import {
  SokoBotStartAbortedError,
  sokoBotControlPlane,
} from "./soko-bot-control-plane.service";
import { sokoBotEventsSyncService } from "./soko-bot-events-sync.service";
import { listSchedules } from "./soko-bot-runtime/schedule-reads";
import {
  type AuthorizedSokoBotRuntime,
  sokoBotRuntimeService,
} from "./soko-bot-runtime.service";
import {
  createSokoBotSchedule,
  deleteSokoBotSchedule,
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
    await prisma.socialPost.deleteMany({ where: { project: { workspaceId } } });
    await prisma.project.deleteMany({ where: { workspaceId } });
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
        network: "mainnet",
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
    async function scheduleRun(
      capabilityNames: string[],
      prompt = "Check Hannah's Task.",
    ) {
      const own = await prisma.sokoBotSchedule.create({
        data: {
          sokoBotId: botId,
          requestedByUserId: userId,
          workspaceId,
          name: "Check on Hannah",
          timezone: "UTC",
          cronExpression: "0 9 * * *",
          prompt,
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

    it("keeps a legacy null-authority schedule running until an owner opts in with a typed stop rule", async () => {
      const { own, turn } = await scheduleRun(
        [],
        "Check Hannah's Task. Delete this schedule once she is done.",
      );

      // Legacy null-authority schedule keeps running regardless of prompt text.
      await expect(
        tool(turn.id, "delete_schedule", { scheduleId: own.id }),
      ).rejects.toThrow("doesn't delete or switch off schedules");
      expect(
        await prisma.sokoBotSchedule.findUnique({ where: { id: own.id } }),
      ).not.toBeNull();

      // Owner opts in via direct top-level chat with a typed stop rule.
      const ownerChat = await liveTurn(["update_schedule"], "CHAT");
      await tool(ownerChat.id, "update_schedule", {
        scheduleId: own.id,
        stopRule: {
          mode: "ends_on",
          endsOn: new Date(Date.now() - 60_000).toISOString(),
        },
      });

      await tool(turn.id, "delete_schedule", { scheduleId: own.id });

      expect(
        await prisma.sokoBotSchedule.findUnique({ where: { id: own.id } }),
      ).toBeNull();
    });

    it("keeps its own schedule when the brief never asks to end it (Codex round 13)", async () => {
      const { own, turn } = await scheduleRun([]);

      await expect(
        tool(turn.id, "delete_schedule", { scheduleId: own.id }),
      ).rejects.toThrow("doesn't delete or switch off schedules");
      expect(
        await prisma.sokoBotSchedule.findUnique({ where: { id: own.id } }),
      ).not.toBeNull();
    });

    it("may not touch another schedule with tools it only has for its own", async () => {
      const { turn } = await scheduleRun([]);
      const other = await createSokoBotSchedule({
        network: "mainnet",
        userId,
        workspaceId,
        name: "Weekly review",
        timezone: "UTC",
        cronExpression: "0 9 * * 1",
        prompt: "Review the week.",
      });

      await expect(
        tool(turn.id, "delete_schedule", { scheduleId: other.id }),
      ).rejects.toThrow("doesn't delete or switch off schedules");
      await expect(
        tool(turn.id, "update_schedule", {
          scheduleName: "Weekly review",
          enabled: false,
        }),
      ).rejects.toThrow("doesn't delete or switch off schedules");
      await expect(
        tool(turn.id, "update_schedule", {
          scheduleName: "Weekly review",
          cronExpression: "0 10 * * 1",
        }),
      ).rejects.toThrow('only change its own schedule "Check on Hannah"');
      expect(
        (
          await prisma.sokoBotSchedule.findUniqueOrThrow({
            where: { id: other.id },
          })
        ).enabled,
      ).toBe(true);
    });

    it("keeps the schedule tools a bot-written schedule inherited, but never deletes another schedule", async () => {
      const { turn } = await scheduleRun([
        "create_schedule",
        "update_schedule",
        "delete_schedule",
      ]);
      const other = await createSokoBotSchedule({
        network: "mainnet",
        userId,
        workspaceId,
        name: "Stale follow-up",
        timezone: "UTC",
        cronExpression: "0 9 * * 1",
        prompt: "Old.",
      });

      await tool(turn.id, "update_schedule", {
        scheduleId: other.id,
        cronExpression: "0 10 * * 1",
      });
      expect(
        (
          await prisma.sokoBotSchedule.findUniqueOrThrow({
            where: { id: other.id },
          })
        ).cronExpression,
      ).toBe("0 10 * * 1");
      await expect(
        tool(turn.id, "delete_schedule", { scheduleId: other.id }),
      ).rejects.toThrow("doesn't delete or switch off schedules");
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
        network: "mainnet",
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
          network: "mainnet",
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
        network: "mainnet",
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
        network: "mainnet",
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

    it("stops a monthly ends_after_runs schedule through real claim, settlement, purge, and recovery paths while fencing extra pending runs and preserving runOnce retries", async () => {
      const monthly = await sokoBotControlPlane.createSchedule({
        network: "mainnet",
        userId,
        workspaceId,
        name: "Monthly digest",
        timezone: "UTC",
        cronExpression: "0 9 1 * *",
        prompt: "Send the monthly digest.",
        stopRule: { mode: "ends_after_runs", maxRuns: 2 },
      });

      const makeTurn = async (
        clientTurnId: string,
        message: string,
        status: "COMPLETED" | "FAILED",
      ) =>
        prisma.sokoBotTurn.create({
          data: {
            sokoBotId: botId,
            requestedByUserId: userId,
            workspaceId,
            source: "SCHEDULE",
            status,
            clientTurnId,
            userMessage: message,
            capabilityNames: [],
            deadlineAt: new Date(Date.now() + HOUR),
          },
        });

      const startSpy = vi.spyOn(sokoBotControlPlane, "startTurn");
      const mockOutcome = (status: "COMPLETED" | "FAILED") =>
        startSpy.mockImplementationOnce(async (input) => {
          const turn = await makeTurn(
            input.clientTurnId,
            input.message,
            status,
          );
          return {
            turnId: turn.id,
            sokoBotId: botId,
            sessionId: "fixture",
            status,
            route: "DELEGATE_TASK",
            capabilities: [],
            duplicate: true,
          };
        });

      const sync = new SokoBotSchedulesSyncService();

      // 1. Month 1: real claim + settlement -> completedRuns becomes 1, stays enabled.
      const month1At = new Date(
        Date.now() - SOKO_BOT_SCHEDULE_RETENTION_MS - HOUR * 24,
      );
      await prisma.sokoBotSchedule.update({
        where: { id: monthly.id },
        data: { nextRunAt: month1At },
      });
      mockOutcome("COMPLETED");
      const month1 = await sync.syncDueSchedules({
        shouldContinue: () => true,
        scheduleId: monthly.id,
      });
      expect(month1).toMatchObject({ claimed: 1, completed: 1, failed: 0 });

      // 2. Seven-day retention purge drops month 1's run row; durable completedRuns stays 1.
      await purgeSokoBotSchedules();
      expect(
        await prisma.sokoBotScheduleRun.count({
          where: { scheduleId: monthly.id },
        }),
      ).toBe(0);
      expect(
        await prisma.sokoBotSchedule.findUniqueOrThrow({
          where: { id: monthly.id },
          select: { enabled: true, completedRuns: true },
        }),
      ).toEqual({ enabled: true, completedRuns: 1 });

      // 3. Month 2 attempt 1 FAILS through real claim + settlement: count stays 1, stays enabled.
      await prisma.sokoBotSchedule.update({
        where: { id: monthly.id },
        data: { nextRunAt: new Date(Date.now() - HOUR * 3) },
      });
      mockOutcome("FAILED");
      const month2Fail = await sync.syncDueSchedules({
        shouldContinue: () => true,
        scheduleId: monthly.id,
      });
      expect(month2Fail).toMatchObject({ claimed: 1, completed: 0, failed: 1 });
      expect(
        await prisma.sokoBotSchedule.findUniqueOrThrow({
          where: { id: monthly.id },
          select: { enabled: true, completedRuns: true },
        }),
      ).toEqual({ enabled: true, completedRuns: 1 });

      // 4. Busy occurrence queued while final run is due: Month 2 retry settles COMPLETED,
      //    reaches maxRuns = 2, disables the schedule, and fences the pending occurrence.
      const queuedPending = await prisma.sokoBotScheduleRun.create({
        data: {
          scheduleId: monthly.id,
          scheduledFor: new Date(Date.now() - HOUR),
          status: "PENDING",
          leaseExpiresAt: new Date(Date.now() + HOUR),
        },
      });
      await prisma.sokoBotSchedule.update({
        where: { id: monthly.id },
        data: { nextRunAt: new Date(Date.now() - HOUR * 2) },
      });
      mockOutcome("COMPLETED");
      const month2Retry = await sync.syncDueSchedules({
        shouldContinue: () => true,
        scheduleId: monthly.id,
      });
      expect(month2Retry).toMatchObject({
        claimed: 1,
        completed: 1,
        failed: 0,
      });
      expect(
        await prisma.sokoBotSchedule.findUniqueOrThrow({
          where: { id: monthly.id },
          select: { enabled: true, completedRuns: true },
        }),
      ).toEqual({ enabled: false, completedRuns: 2 });
      expect(
        await prisma.sokoBotScheduleRun.findUniqueOrThrow({
          where: { id: queuedPending.id },
          select: { status: true, errorKind: true },
        }),
      ).toEqual({ status: "DEAD_LETTER", errorKind: "schedule_stop_rule_met" });

      // 5. Recovery fence: even if an unstarted PENDING run exists on the disabled
      //    recurring schedule, real recovery claims nothing.
      await prisma.sokoBotScheduleRun.create({
        data: {
          scheduleId: monthly.id,
          scheduledFor: new Date(Date.now() - 30 * 60_000),
          status: "PENDING",
          leaseExpiresAt: null,
        },
      });
      const afterExhausted = await sync.syncDueSchedules({
        shouldContinue: () => true,
        scheduleId: monthly.id,
      });
      expect(afterExhausted).toMatchObject({
        claimed: 0,
        completed: 0,
        failed: 0,
      });

      // 6. Reservation binding fence: a pre-claimed unstarted occurrence cannot bind
      //    a turn once the recurring schedule is disabled.
      startSpy.mockRestore();
      const leaseToken = randomUUID();
      const racingRun = await prisma.sokoBotScheduleRun.create({
        data: {
          scheduleId: monthly.id,
          scheduledFor: new Date(Date.now() - 10 * 60_000),
          status: "CLAIMED",
          attempt: 1,
          prompt: "Send the monthly digest.",
          leaseToken,
          leaseExpiresAt: new Date(Date.now() + HOUR),
        },
      });
      await expect(
        sokoBotControlPlane.startTurn({
          network: "mainnet",
          userId,
          sokoBotId: botId,
          workspaceId,
          clientTurnId: randomUUID(),
          message: "Send the monthly digest.",
          source: "SCHEDULE",
          presetRoute: inheritedScheduleRoute([]),
          scheduleReservation: {
            runId: racingRun.id,
            attempt: 1,
            leaseToken,
          },
        }),
      ).rejects.toBeInstanceOf(SokoBotStartAbortedError);

      // 7. Re-enabling an already-exhausted schedule without raising maxRuns,
      //    or setting an already-met maxRuns on an enabled schedule with
      //    completedRuns = 2 (e.g. replacement member handoff after departed
      //    grantor), stops and fences unstarted runs immediately so a 3rd
      //    occurrence never starts.
      const queuedBeforeReenable = await prisma.sokoBotScheduleRun.create({
        data: {
          scheduleId: monthly.id,
          scheduledFor: new Date(Date.now() - 8 * 60_000),
          status: "PENDING",
          leaseExpiresAt: null,
        },
      });
      const reenabledSameLimit = await sokoBotControlPlane.updateSchedule({
        userId,
        scheduleId: monthly.id,
        workspaceId,
        sokoBotId: botId,
        enabled: true,
      });
      expect(reenabledSameLimit.enabled).toBe(false);
      expect(
        await prisma.sokoBotScheduleRun.findUniqueOrThrow({
          where: { id: queuedBeforeReenable.id },
          select: { status: true, errorKind: true },
        }),
      ).toEqual({ status: "DEAD_LETTER", errorKind: "schedule_stop_rule_met" });
      await prisma.sokoBotSchedule.update({
        where: { id: monthly.id },
        data: { nextRunAt: new Date(Date.now() - 60_000) },
      });
      expect(
        await sync.syncDueSchedules({
          shouldContinue: () => true,
          scheduleId: monthly.id,
        }),
      ).toMatchObject({ claimed: 0, completed: 0, failed: 0 });

      // Simulate schedule staying enabled at completedRuns = 2 (e.g., grantor
      // had left before run 2 settled), then an eligible member sets maxRuns=2:
      // it disables atomically, fences pending runs, and sync claims nothing.
      await prisma.sokoBotSchedule.update({
        where: { id: monthly.id },
        data: { enabled: true, nextRunAt: new Date(Date.now() - 60_000) },
      });
      const queuedBeforeHandoff = await prisma.sokoBotScheduleRun.create({
        data: {
          scheduleId: monthly.id,
          scheduledFor: new Date(Date.now() - 7 * 60_000),
          status: "PENDING",
          leaseExpiresAt: null,
        },
      });
      const handedOff = await sokoBotControlPlane.updateSchedule({
        userId,
        scheduleId: monthly.id,
        workspaceId,
        sokoBotId: botId,
        stopRule: { mode: "ends_after_runs", maxRuns: 2 },
      });
      expect(handedOff.enabled).toBe(false);
      expect(
        await prisma.sokoBotScheduleRun.findUniqueOrThrow({
          where: { id: queuedBeforeHandoff.id },
          select: { status: true, errorKind: true },
        }),
      ).toEqual({ status: "DEAD_LETTER", errorKind: "schedule_stop_rule_met" });
      expect(
        await sync.syncDueSchedules({
          shouldContinue: () => true,
          scheduleId: monthly.id,
        }),
      ).toMatchObject({ claimed: 0, completed: 0, failed: 0 });

      // Raising maxRuns above completedRuns with enabled: true DOES re-enable.
      const raised = await sokoBotControlPlane.updateSchedule({
        userId,
        scheduleId: monthly.id,
        workspaceId,
        sokoBotId: botId,
        enabled: true,
        stopRule: { mode: "ends_after_runs", maxRuns: 3 },
      });
      expect(raised.enabled).toBe(true);
      await prisma.sokoBotSchedule.update({
        where: { id: monthly.id },
        data: { enabled: false },
      });

      // Metadata-only chat rename (dispatch-schedules passes resolveAuthority,
      // which returns undefined for metadata edits) on an active schedule with
      // completedRuns = 2 >= maxRuns = 2 and an expired grant keeps the
      // schedule enabled and leaves queued pending occurrences untouched.
      const existingMonthly = await prisma.sokoBotSchedule.findUniqueOrThrow({
        where: { id: monthly.id },
        select: { authority: true },
      });
      await prisma.sokoBotSchedule.update({
        where: { id: monthly.id },
        data: {
          enabled: true,
          authority: {
            ...(existingMonthly.authority as Record<string, unknown>),
            stopRule: {
              mode: "ends_after_runs",
              scheduleId: monthly.id,
              maxRuns: 2,
            },
            expiresAt: "2020-01-01T00:00:00.000Z",
          },
        },
      });
      const queuedDuringExpiredRename = await prisma.sokoBotScheduleRun.create({
        data: {
          scheduleId: monthly.id,
          scheduledFor: new Date(Date.now() - 6 * 60_000),
          status: "PENDING",
          leaseExpiresAt: null,
        },
      });
      const renameChatTurn = await liveTurn(["update_schedule"], "CHAT");
      await tool(renameChatTurn.id, "update_schedule", {
        scheduleId: monthly.id,
        name: "Monthly digest (renamed)",
      });
      expect(
        await prisma.sokoBotSchedule.findUniqueOrThrow({
          where: { id: monthly.id },
          select: { enabled: true, name: true },
        }),
      ).toEqual({ enabled: true, name: "Monthly digest (renamed)" });
      expect(
        await prisma.sokoBotScheduleRun.findUniqueOrThrow({
          where: { id: queuedDuringExpiredRename.id },
          select: { status: true },
        }),
      ).toEqual({ status: "PENDING" });
      await settle(renameChatTurn.id);
      await prisma.sokoBotSchedule.update({
        where: { id: monthly.id },
        data: { enabled: false },
      });

      // 8. Control: a one-time schedule (`runOnce: true`, disabled on claim) STILL
      //    recovers its pending retry occurrence cleanly.
      const oneTime = await createSokoBotSchedule({
        network: "mainnet",
        userId,
        workspaceId,
        name: "One-time reminder",
        timezone: "UTC",
        runAt: new Date(Date.now() + HOUR).toISOString(),
        prompt: "Remind me once.",
      });
      await prisma.sokoBotSchedule.update({
        where: { id: oneTime.id },
        data: { enabled: false },
      });
      await prisma.sokoBotScheduleRun.create({
        data: {
          scheduleId: oneTime.id,
          scheduledFor: new Date(Date.now() - 5 * 60_000),
          status: "PENDING",
          leaseExpiresAt: null,
        },
      });
      const retrySpy = vi
        .spyOn(sokoBotControlPlane, "startTurn")
        .mockImplementationOnce(async (input) => {
          const turn = await makeTurn(
            input.clientTurnId,
            input.message,
            "COMPLETED",
          );
          return {
            turnId: turn.id,
            sokoBotId: botId,
            sessionId: "fixture",
            status: "COMPLETED",
            route: "DELEGATE_TASK",
            capabilities: [],
            duplicate: true,
          };
        });
      const recoveredOneTime = await sync.syncDueSchedules({
        shouldContinue: () => true,
        scheduleId: oneTime.id,
      });
      expect(recoveredOneTime).toMatchObject({
        claimed: 1,
        completed: 1,
        failed: 0,
      });
      retrySpy.mockRestore();
    });

    it("resolves production admin-retry:<uuid>:<op> chains on PostgreSQL without UUID syntax errors for chat and event turns", async () => {
      const failedChat = await prisma.sokoBotTurn.create({
        data: {
          sokoBotId: botId,
          requestedByUserId: userId,
          workspaceId,
          source: "CHAT",
          status: "FAILED",
          clientTurnId: `chat:${randomUUID()}`,
          versionId: "v36",
          userMessage: "Finish editing the launch post.",
          capabilityNames: ["create_social_post", "update_social_post"],
          deadlineAt: new Date(Date.now() + 60_000),
        },
      });
      const chatRetry = await prisma.sokoBotTurn.create({
        data: {
          sokoBotId: botId,
          requestedByUserId: userId,
          workspaceId,
          source: "ADMIN_RETRY",
          status: "RUNNING",
          clientTurnId: `admin-retry:${failedChat.id}:op-chat-1`,
          versionId: "v36",
          userMessage: failedChat.userMessage,
          capabilityNames: ["create_social_post", "update_social_post"],
          deadlineAt: new Date(Date.now() + 60_000),
        },
      });
      const failedEvent = await prisma.sokoBotTurn.create({
        data: {
          sokoBotId: botId,
          requestedByUserId: userId,
          workspaceId,
          source: "EVENT",
          status: "FAILED",
          clientTurnId: `event:${randomUUID()}`,
          versionId: "v36",
          userMessage: "Delegated task finished.",
          capabilityNames: ["create_social_post", "update_social_post"],
          deadlineAt: new Date(Date.now() + 60_000),
        },
      });
      const eventRetry = await prisma.sokoBotTurn.create({
        data: {
          sokoBotId: botId,
          requestedByUserId: userId,
          workspaceId,
          source: "ADMIN_RETRY",
          status: "RUNNING",
          clientTurnId: `admin-retry:${failedEvent.id}:op-event-1`,
          versionId: "v36",
          userMessage: failedEvent.userMessage,
          capabilityNames: ["create_social_post", "update_social_post"],
          deadlineAt: new Date(Date.now() + 60_000),
        },
      });
      const eventRetryChained = await prisma.sokoBotTurn.create({
        data: {
          sokoBotId: botId,
          requestedByUserId: userId,
          workspaceId,
          source: "ADMIN_RETRY",
          status: "RUNNING",
          clientTurnId: `admin-retry:${eventRetry.id}:op-event-2`,
          versionId: "v36",
          userMessage: failedEvent.userMessage,
          capabilityNames: ["create_social_post", "update_social_post"],
          deadlineAt: new Date(Date.now() + 60_000),
        },
      });
      const malformedRetry = await prisma.sokoBotTurn.create({
        data: {
          sokoBotId: botId,
          requestedByUserId: userId,
          workspaceId,
          source: "ADMIN_RETRY",
          status: "RUNNING",
          clientTurnId: "admin-retry:not-a-uuid:op-bad",
          versionId: "v36",
          userMessage: "Malformed retry.",
          capabilityNames: ["create_social_post", "update_social_post"],
          deadlineAt: new Date(Date.now() + 60_000),
        },
      });

      const chatOrigin = await resolveSocialWriteOriginSource(chatRetry);
      expect(chatOrigin).toBe("CHAT");
      expect(
        evaluateSocialWriteAuthority({
          turn: {
            id: chatRetry.id,
            sokoBotId: botId,
            workspaceId,
            versionId: "v36",
            source: chatOrigin,
            actingUserId: userId,
            askedByKind: "OWNER",
          },
          capability: "update_social_post",
          rawInput: {},
          tainted: false,
        }),
      ).toEqual({ allowed: true, requireUnapprovedDraft: false });

      const eventOrigin = await resolveSocialWriteOriginSource(eventRetry);
      expect(eventOrigin).toBe("EVENT");
      expect(
        evaluateSocialWriteAuthority({
          turn: {
            id: eventRetry.id,
            sokoBotId: botId,
            workspaceId,
            versionId: "v36",
            source: eventOrigin,
            actingUserId: userId,
            askedByKind: "OWNER",
          },
          capability: "create_social_post",
          rawInput: { text: "Draft from retried event" },
          tainted: false,
        }),
      ).toEqual({ allowed: true, requireUnapprovedDraft: false });
      expect(
        evaluateSocialWriteAuthority({
          turn: {
            id: eventRetry.id,
            sokoBotId: botId,
            workspaceId,
            versionId: "v36",
            source: eventOrigin,
            actingUserId: userId,
            askedByKind: "OWNER",
          },
          capability: "create_social_post",
          rawInput: {
            text: "Scheduled from retried event",
            scheduledAt: "2026-12-01T09:00:00.000Z",
          },
          tainted: false,
        }),
      ).toMatchObject({ allowed: false, kind: "delegation_event_draft_only" });
      expect(
        evaluateSocialWriteAuthority({
          turn: {
            id: eventRetry.id,
            sokoBotId: botId,
            workspaceId,
            versionId: "v36",
            source: eventOrigin,
            actingUserId: userId,
            askedByKind: "OWNER",
          },
          capability: "update_social_post",
          rawInput: {},
          tainted: false,
        }),
      ).toMatchObject({ allowed: false, kind: "delegation_event_draft_only" });

      expect(await resolveSocialWriteOriginSource(eventRetryChained)).toBe(
        "EVENT",
      );
      expect(await resolveSocialWriteOriginSource(malformedRetry)).toBe(
        "EVENT",
      );
    });

    it("persists and enforces SokoBotWatch OwnerAuthority across legacy null rows and expired grants on PostgreSQL", async () => {
      const { syncSokoBotWatches } = await import(
        "@/services/soko-bot-watches.service"
      );
      const originChat = await prisma.sokoBotTurn.create({
        data: {
          sokoBotId: botId,
          requestedByUserId: userId,
          workspaceId,
          source: "CHAT",
          status: "COMPLETED",
          clientTurnId: `chat:watch:${randomUUID()}`,
          versionId: "v36",
          userMessage: "Wait for the background run and post in chat.",
          capabilityNames: [
            "get_image",
            "post_chat",
            "create_social_post",
            "publish_social_post",
            "start_background_run",
          ],
          deadlineAt: new Date(Date.now() + 60_000),
        },
      });
      const finishedRun = await prisma.sokoBotTurn.create({
        data: {
          sokoBotId: botId,
          requestedByUserId: userId,
          workspaceId,
          parentTurnId: originChat.id,
          source: "CHAT",
          status: "COMPLETED",
          clientTurnId: `bg:watch:${randomUUID()}`,
          versionId: "v36",
          userMessage: "Do background research",
          capabilityNames: [],
          finalAnswer: "Done.",
          backgroundTitle: "Research",
          deadlineAt: new Date(Date.now() + 60_000),
        },
      });
      const legacyWatch = await prisma.sokoBotWatch.create({
        data: {
          sokoBotId: botId,
          turnId: originChat.id,
          kind: "background_run",
          targetId: finishedRun.id,
          then: "Share the summary",
          expiresAt: new Date(Date.now() + 60_000),
        },
      });
      const expiredWatch = await prisma.sokoBotWatch.create({
        data: {
          sokoBotId: botId,
          turnId: originChat.id,
          kind: "background_run",
          targetId: finishedRun.id,
          then: "Expired follow-up",
          expiresAt: new Date(Date.now() + 60_000),
          authority: {
            version: 1,
            grantId: originChat.id,
            origin: "owner_chat",
            sokoBotId: botId,
            workspaceId,
            ownerUserId: userId,
            rootTurnId: originChat.id,
            targetScope: { kind: "workspace" },
            scope: "owner_writes",
            socialMode: "full",
            stopRule: { mode: "never" },
            expiresAt: "2020-01-01T00:00:00.000Z",
          },
        },
      });

      const startedCaps = new Map<string, readonly string[]>();
      const watchSpy = vi
        .spyOn(sokoBotControlPlane, "startTurn")
        .mockImplementation(async (input) => {
          startedCaps.set(
            input.clientTurnId,
            input.presetRoute?.capabilities ?? [],
          );
          const turn = await prisma.sokoBotTurn.create({
            data: {
              sokoBotId: botId,
              requestedByUserId: userId,
              workspaceId,
              source: "EVENT",
              status: "COMPLETED",
              clientTurnId: input.clientTurnId,
              userMessage: input.message,
              capabilityNames: [],
              deadlineAt: new Date(Date.now() + HOUR),
            },
            select: { id: true },
          });
          return {
            turnId: turn.id,
            sokoBotId: botId,
            sessionId: "fixture",
            status: "COMPLETED",
            route: "DELEGATE_TASK",
            capabilities: [...(input.presetRoute?.capabilities ?? [])],
            duplicate: false,
          };
        });
      try {
        const synced = await syncSokoBotWatches({
          shouldContinue: () => true,
          sokoBotId: botId,
        });
        expect(synced.fired).toBe(2);
      } finally {
        watchSpy.mockRestore();
      }

      // Pre-migration authority=null watch resumes with owner tools (minus run management).
      expect(startedCaps.get(`watch:${legacyWatch.id}`)).toEqual(
        expect.arrayContaining([
          "get_image",
          "post_chat",
          "create_social_post",
        ]),
      );
      expect(startedCaps.get(`watch:${legacyWatch.id}`)).not.toContain(
        "start_background_run",
      );
      // Expired persisted watch authority clamps to read-only.
      expect(startedCaps.get(`watch:${expiredWatch.id}`)).toEqual([
        "get_image",
      ]);
    });

    it("enforces SokoBotSchedule.authority on scheduled runs and admin retries across draft_only, schedule_posts, Project scope, and expiry on PostgreSQL", async () => {
      const { failedRetryInput, loadAdminScheduleRun, scheduleRetryInput } =
        await import("@/services/soko-bot-admin-retry.service");
      const { withFixtureSchemas } = await import("@/test/split-layout");

      const [projectA, projectB] = await withFixtureSchemas(async (tx) => [
        await tx.project.create({
          data: { workspaceId, name: "Schedule Authority Project A" },
        }),
        await tx.project.create({
          data: { workspaceId, name: "Schedule Authority Project B" },
        }),
      ]);
      const connA = await prisma.projectSocialConnection.create({
        data: {
          projectId: projectA.id,
          provider: "x",
          externalAccountId: randomUUID(),
          externalHandle: "project_a_handle",
          composioConnectedAccountId: randomUUID(),
          status: "active",
          connectorUserId: userId,
          connectedAt: new Date(),
        },
      });
      const connB = await prisma.projectSocialConnection.create({
        data: {
          projectId: projectB.id,
          provider: "x",
          externalAccountId: randomUUID(),
          externalHandle: "project_b_handle",
          composioConnectedAccountId: randomUUID(),
          status: "active",
          connectorUserId: userId,
          connectedAt: new Date(),
        },
      });
      const bot = await prisma.sokoBot.findUniqueOrThrow({
        where: { id: botId },
      });

      const storedCaps = [
        "list_social_posts",
        "create_task",
        "create_social_post",
        "update_social_post",
        "schedule_social_post",
        "publish_social_post",
        "cancel_social_post",
      ];
      const scheduledAt = new Date(Date.now() + 24 * HOUR).toISOString();
      const baseAuthority = (
        scheduleId: string,
        overrides: Record<string, unknown> = {},
      ) => ({
        version: 1,
        grantId: randomUUID(),
        origin: "owner_chat",
        sokoBotId: botId,
        workspaceId,
        ownerUserId: userId,
        rootTurnId: randomUUID(),
        targetScope: { kind: "project", projectId: projectA.id },
        scheduleId,
        scope: "owner_writes",
        socialMode: "draft_only",
        stopRule: { mode: "never" },
        ...overrides,
      });

      const createTurnForRun = async (input: {
        source: "SCHEDULE" | "ADMIN_RETRY";
        clientTurnId: string;
        capabilityNames: string[];
      }) => {
        const sessionId = randomUUID();
        await prisma.sokoBot.update({
          where: { id: botId },
          data: { eveSessionId: sessionId },
        });
        const turn = await prisma.sokoBotTurn.create({
          data: {
            sokoBotId: botId,
            requestedByUserId: userId,
            workspaceId,
            source: input.source,
            status: "RUNNING",
            clientTurnId: input.clientTurnId,
            versionId: "v36",
            userMessage: "Run scheduled social task.",
            capabilityNames: input.capabilityNames,
            deadlineAt: new Date(Date.now() + HOUR),
            leaseExpiresAt: new Date(Date.now() + HOUR),
            contextSnapshot: {
              create: {
                generatedAt: new Date(),
                schemaVersion: 1,
                hash: randomUUID(),
                packet: { trigger: { askedBy: { kind: "OWNER" } } },
                byteSize: 2,
                tokenEstimate: 1,
                counts: {},
                omissions: {},
              },
            },
          },
        });
        return { turn, sessionId };
      };

      const callSocial = async (
        turnId: string,
        sessionId: string,
        capability:
          | "create_social_post"
          | "schedule_social_post"
          | "publish_social_post",
        payload: Record<string, unknown>,
      ) =>
        sokoBotRuntimeService.executeTool({
          turnId,
          sessionId,
          toolCallId: `call-${randomUUID()}`,
          capability,
          input: payload,
        });

      const fireRouteForSchedule = async (scheduleId: string) => {
        let capturedCapabilities: readonly SokoBotCapability[] = [];
        const spy = vi
          .spyOn(sokoBotControlPlane, "startTurn")
          .mockImplementation(async (input) => {
            capturedCapabilities = input.presetRoute?.capabilities ?? [];
            const turn = await prisma.sokoBotTurn.create({
              data: {
                sokoBotId: botId,
                requestedByUserId: userId,
                workspaceId,
                source: "SCHEDULE",
                status: "COMPLETED",
                clientTurnId: input.clientTurnId,
                versionId: "v36",
                userMessage: input.message,
                capabilityNames: [...capturedCapabilities],
                deadlineAt: new Date(Date.now() + HOUR),
              },
              select: { id: true },
            });
            return {
              turnId: turn.id,
              sokoBotId: botId,
              sessionId: "fixture",
              status: "COMPLETED",
              route: "DELEGATE_TASK",
              capabilities: [...capturedCapabilities],
              duplicate: false,
            };
          });
        try {
          await new SokoBotSchedulesSyncService().syncDueSchedules({
            shouldContinue: () => true,
            scheduleId,
          });
        } finally {
          spy.mockRestore();
        }
        return capturedCapabilities;
      };

      // 1. Positive + negative control: ordinary personal draft_only schedule
      //    keeps create_social_post, creates a NEEDS_APPROVAL draft (scheduledAt=null),
      //    and refuses scheduledAt / schedule_social_post.
      const draftScheduleId = randomUUID();
      await prisma.sokoBotSchedule.create({
        data: {
          id: draftScheduleId,
          sokoBotId: botId,
          workspaceId,
          requestedByUserId: userId,
          name: "Weekly draft post",
          prompt: "Draft a weekly post for Project A.",
          cronExpression: "0 9 * * 1",
          timezone: "UTC",
          enabled: true,
          nextRunAt: new Date(Date.now() - 60_000),
          capabilityNames: storedCaps,
          authority: baseAuthority(draftScheduleId, {
            socialMode: "draft_only",
          }),
        },
      });
      const draftRouteCaps = await fireRouteForSchedule(draftScheduleId);
      expect(draftRouteCaps).toEqual([
        "list_social_posts",
        "create_task",
        "create_social_post",
      ]);

      const draftRunTurn = await createTurnForRun({
        source: "SCHEDULE",
        clientTurnId: `schedule:${draftScheduleId}:${new Date().toISOString()}`,
        capabilityNames: storedCaps,
      });
      await prisma.sokoBotScheduleRun.create({
        data: {
          scheduleId: draftScheduleId,
          scheduledFor: new Date(Date.now() - 30_000),
          status: "RUNNING",
          attempt: 1,
          prompt: "Draft a weekly post for Project A.",
          turnId: draftRunTurn.turn.id,
        },
      });
      const createdDraft = (await callSocial(
        draftRunTurn.turn.id,
        draftRunTurn.sessionId,
        "create_social_post",
        {
          projectId: projectA.id,
          socialConnectionId: connA.id,
          text: "Weekly product note awaiting owner approval.",
        },
      )) as { id: string; revision: number };
      const persistedDraft = await prisma.socialPost.findUniqueOrThrow({
        where: { id: createdDraft.id },
      });
      expect(persistedDraft).toMatchObject({
        projectId: projectA.id,
        status: "NEEDS_APPROVAL",
        scheduledAt: null,
      });
      await expect(
        callSocial(
          draftRunTurn.turn.id,
          draftRunTurn.sessionId,
          "create_social_post",
          {
            projectId: projectA.id,
            socialConnectionId: connA.id,
            text: "Should not schedule on draft_only.",
            scheduledAt,
          },
        ),
      ).rejects.toThrow(SCHEDULE_SOCIAL_DRAFT_ONLY_MESSAGE);
      await expect(
        callSocial(
          draftRunTurn.turn.id,
          draftRunTurn.sessionId,
          "schedule_social_post",
          {
            projectId: projectA.id,
            postId: createdDraft.id,
            revision: createdDraft.revision,
            scheduledAt,
          },
        ),
      ).rejects.toThrow(SCHEDULE_SOCIAL_DRAFT_ONLY_MESSAGE);

      // 2. Positive + negative control: explicitly authorized schedule_posts
      //    scoped to Project A succeeds on Project A directly AND after BOTH
      //    admin-schedule-retry and admin-retry, while refusing publish and Project B.
      const schedPostsId = randomUUID();
      await prisma.sokoBotSchedule.create({
        data: {
          id: schedPostsId,
          sokoBotId: botId,
          workspaceId,
          requestedByUserId: userId,
          name: "Authorized Project A scheduler",
          prompt: "Create and schedule the Project A update.",
          cronExpression: "0 10 * * 1",
          timezone: "UTC",
          enabled: true,
          nextRunAt: new Date(Date.now() - 60_000),
          capabilityNames: storedCaps,
          authority: baseAuthority(schedPostsId, {
            socialMode: "schedule_posts",
          }),
        },
      });
      const schedPostsRouteCaps = await fireRouteForSchedule(schedPostsId);
      expect(schedPostsRouteCaps).toEqual([
        "list_social_posts",
        "create_task",
        "create_social_post",
        "update_social_post",
        "schedule_social_post",
      ]);

      const directTurn = await createTurnForRun({
        source: "SCHEDULE",
        clientTurnId: `schedule:${schedPostsId}:${new Date().toISOString()}`,
        capabilityNames: storedCaps,
      });
      const directRun = await prisma.sokoBotScheduleRun.create({
        data: {
          scheduleId: schedPostsId,
          scheduledFor: new Date(Date.now() - 25_000),
          status: "FAILED",
          attempt: 1,
          prompt: "Create and schedule the Project A update.",
          turnId: directTurn.turn.id,
        },
      });

      const directScheduled = (await callSocial(
        directTurn.turn.id,
        directTurn.sessionId,
        "create_social_post",
        {
          projectId: projectA.id,
          socialConnectionId: connA.id,
          text: "Scheduled update on Project A from direct schedule run.",
          scheduledAt,
        },
      )) as { id: string; revision: number };
      expect(
        await prisma.socialPost.findUniqueOrThrow({
          where: { id: directScheduled.id },
          select: { projectId: true, scheduledAt: true },
        }),
      ).toEqual({
        projectId: projectA.id,
        scheduledAt: new Date(scheduledAt),
      });
      await expect(
        callSocial(
          directTurn.turn.id,
          directTurn.sessionId,
          "publish_social_post",
          {
            projectId: projectA.id,
            postId: directScheduled.id,
            revision: directScheduled.revision,
          },
        ),
      ).rejects.toThrow(SCHEDULE_SOCIAL_PUBLISH_BLOCKED_MESSAGE);
      await expect(
        callSocial(
          directTurn.turn.id,
          directTurn.sessionId,
          "create_social_post",
          {
            projectId: projectB.id,
            socialConnectionId: connB.id,
            text: "Cross-project post must be refused.",
            scheduledAt,
          },
        ),
      ).rejects.toThrow(SCHEDULE_AUTHORITY_SCOPE_MISMATCH_MESSAGE);

      // Admin schedule retry (RETRY_SCHEDULE_RUN -> admin-schedule-retry:<runId>:<op>)
      const loadedRun = await loadAdminScheduleRun(botId, directRun.id);
      expect(loadedRun).not.toBeNull();
      const retryRoute = (await scheduleRetryInput(bot, loadedRun!, null))
        .presetRoute;
      expect(retryRoute?.capabilities).toEqual([
        "list_social_posts",
        "create_task",
        "create_social_post",
        "update_social_post",
        "schedule_social_post",
      ]);
      const adminScheduleRetryTurn = await createTurnForRun({
        source: "ADMIN_RETRY",
        clientTurnId: `admin-schedule-retry:${directRun.id}:op-retry-1`,
        capabilityNames: storedCaps,
      });
      const retriedRunPost = (await callSocial(
        adminScheduleRetryTurn.turn.id,
        adminScheduleRetryTurn.sessionId,
        "create_social_post",
        {
          projectId: projectA.id,
          socialConnectionId: connA.id,
          text: "Scheduled update on Project A after admin-schedule-retry.",
          scheduledAt,
        },
      )) as { id: string };
      expect(
        await prisma.socialPost.findUniqueOrThrow({
          where: { id: retriedRunPost.id },
          select: { projectId: true, scheduledAt: true },
        }),
      ).toEqual({
        projectId: projectA.id,
        scheduledAt: new Date(scheduledAt),
      });
      await expect(
        callSocial(
          adminScheduleRetryTurn.turn.id,
          adminScheduleRetryTurn.sessionId,
          "create_social_post",
          {
            projectId: projectB.id,
            socialConnectionId: connB.id,
            text: "Cross-project post after admin-schedule-retry must fail.",
            scheduledAt,
          },
        ),
      ).rejects.toThrow(SCHEDULE_AUTHORITY_SCOPE_MISMATCH_MESSAGE);

      // Admin turn retry (RETRY_LAST_FAILED -> admin-retry:<scheduleTurnId>:<op>),
      // even after directRun.turnId was rebound to the earlier admin retry turn.
      await prisma.sokoBotScheduleRun.update({
        where: { id: directRun.id },
        data: { turnId: adminScheduleRetryTurn.turn.id },
      });
      const activeFailedTurn = await prisma.sokoBotTurn.findUniqueOrThrow({
        where: { id: directTurn.turn.id },
      });
      expect(
        (
          await failedRetryInput(
            bot,
            activeFailedTurn,
            `admin-retry:${directTurn.turn.id}:op-retry-2`,
          )
        ).presetRoute?.capabilities,
      ).toEqual([
        "list_social_posts",
        "create_task",
        "create_social_post",
        "update_social_post",
        "schedule_social_post",
      ]);
      const adminTurnRetry = await createTurnForRun({
        source: "ADMIN_RETRY",
        clientTurnId: `admin-retry:${directTurn.turn.id}:op-retry-2`,
        capabilityNames: storedCaps,
      });
      const retriedTurnPost = (await callSocial(
        adminTurnRetry.turn.id,
        adminTurnRetry.sessionId,
        "create_social_post",
        {
          projectId: projectA.id,
          socialConnectionId: connA.id,
          text: "Scheduled update on Project A after admin-retry.",
          scheduledAt,
        },
      )) as { id: string };
      expect(
        await prisma.socialPost.findUniqueOrThrow({
          where: { id: retriedTurnPost.id },
          select: { projectId: true, scheduledAt: true },
        }),
      ).toEqual({
        projectId: projectA.id,
        scheduledAt: new Date(scheduledAt),
      });

      // Zero posts ever leaked into Project B.
      expect(
        await prisma.socialPost.count({ where: { projectId: projectB.id } }),
      ).toBe(0);

      // 3. Negative control: schedule expiry clamps both sync and admin retry
      //    routes to read-only and blocks social writes even on prior retries.
      await prisma.sokoBotSchedule.update({
        where: { id: schedPostsId },
        data: {
          nextRunAt: new Date(Date.now() - 60_000),
          authority: baseAuthority(schedPostsId, {
            socialMode: "schedule_posts",
            expiresAt: "2020-01-01T00:00:00.000Z",
          }),
        },
      });
      expect(await fireRouteForSchedule(schedPostsId)).toEqual([
        "list_social_posts",
      ]);
      const expiredRun = await loadAdminScheduleRun(botId, directRun.id);
      expect(
        (await scheduleRetryInput(bot, expiredRun!, null)).presetRoute
          ?.capabilities,
      ).toEqual(["list_social_posts"]);
      const expiredFailedTurn = await prisma.sokoBotTurn.findUniqueOrThrow({
        where: { id: directTurn.turn.id },
      });
      expect(
        (
          await failedRetryInput(
            bot,
            expiredFailedTurn,
            `admin-retry:${directTurn.turn.id}:op-expired-turn-retry`,
          )
        ).presetRoute?.capabilities,
      ).toEqual(["list_social_posts"]);
      await expect(
        callSocial(
          adminScheduleRetryTurn.turn.id,
          adminScheduleRetryTurn.sessionId,
          "create_social_post",
          {
            projectId: projectA.id,
            socialConnectionId: connA.id,
            text: "Expired retry draft must fail.",
          },
        ),
      ).rejects.toThrow(SCHEDULE_AUTHORITY_EXPIRED_MESSAGE);

      // 4. Negative control: malformed non-null authority & missing run fail closed.
      await prisma.sokoBotSchedule.update({
        where: { id: schedPostsId },
        data: { authority: { broken: true } },
      });
      await expect(
        callSocial(
          adminScheduleRetryTurn.turn.id,
          adminScheduleRetryTurn.sessionId,
          "create_social_post",
          {
            projectId: projectA.id,
            socialConnectionId: connA.id,
            text: "Malformed schedule authority must fail.",
          },
        ),
      ).rejects.toThrow(SCHEDULE_AUTHORITY_INVALID_MESSAGE);
      const orphanRetryTurn = await createTurnForRun({
        source: "ADMIN_RETRY",
        clientTurnId: `admin-schedule-retry:${randomUUID()}:op-missing`,
        capabilityNames: storedCaps,
      });
      await expect(
        callSocial(
          orphanRetryTurn.turn.id,
          orphanRetryTurn.sessionId,
          "create_social_post",
          {
            projectId: projectA.id,
            socialConnectionId: connA.id,
            text: "Missing schedule run must fail closed.",
          },
        ),
      ).rejects.toThrow(
        "Cannot recover the original occurrence for this retry",
      );

      const deletedScheduleTurn = await createTurnForRun({
        source: "SCHEDULE",
        clientTurnId: `schedule:${randomUUID()}:${new Date().toISOString()}`,
        capabilityNames: storedCaps,
      });
      await expect(
        callSocial(
          deletedScheduleTurn.turn.id,
          deletedScheduleTurn.sessionId,
          "create_social_post",
          {
            projectId: projectA.id,
            socialConnectionId: connA.id,
            text: "Deleted schedule must fail closed.",
          },
        ),
      ).rejects.toThrow(SCHEDULE_AUTHORITY_UNAVAILABLE_MESSAGE);
    });

    it("refuses recurring write schedules whose first run cannot perform the write while allowing direct personal writes and read-only checks", async () => {
      const fireScheduleRun = async (
        targetBotId: string,
        targetWorkspaceId: string,
        scheduleId: string,
        versionId: string,
      ) => {
        await prisma.sokoBotSchedule.update({
          where: { id: scheduleId },
          data: { nextRunAt: new Date(Date.now() - 60_000) },
        });
        let captured: {
          userId: string | null;
          capabilities: readonly SokoBotCapability[];
        } | null = null;
        const spy = vi
          .spyOn(sokoBotControlPlane, "startTurn")
          .mockImplementation(async (input) => {
            const caps = input.presetRoute?.capabilities ?? [];
            captured = {
              userId: input.userId,
              capabilities: caps,
            };
            const turn = await prisma.sokoBotTurn.create({
              data: {
                sokoBotId: targetBotId,
                requestedByUserId: input.userId,
                workspaceId: targetWorkspaceId,
                source: "SCHEDULE",
                status: "COMPLETED",
                clientTurnId: input.clientTurnId,
                versionId,
                userMessage: input.message,
                capabilityNames: [...caps],
                deadlineAt: new Date(Date.now() + HOUR),
              },
              select: { id: true },
            });
            return {
              turnId: turn.id,
              sokoBotId: targetBotId,
              sessionId: "fixture",
              status: "COMPLETED",
              route: "DELEGATE_TASK",
              capabilities: [...caps],
              duplicate: false,
            };
          });
        try {
          await new SokoBotSchedulesSyncService().syncDueSchedules({
            shouldContinue: () => true,
            scheduleId,
          });
        } finally {
          spy.mockRestore();
        }
        return captured as {
          userId: string | null;
          capabilities: readonly SokoBotCapability[];
        } | null;
      };

      // 1. Direct top-level personal owner chat creating a recurring table write succeeds
      //    and keeps write_table_rows on its first run.
      const ownerSessionId = randomUUID();
      await prisma.sokoBot.update({
        where: { id: botId },
        data: { eveSessionId: ownerSessionId, versionId: "v36" },
      });
      const directChat = await prisma.sokoBotTurn.create({
        data: {
          sokoBotId: botId,
          requestedByUserId: userId,
          workspaceId,
          source: "CHAT",
          status: "RUNNING",
          clientTurnId: randomUUID(),
          versionId: "v36",
          userMessage: "Update our pipeline table every morning.",
          capabilityNames: [
            "read_table",
            "write_table_rows",
            "create_schedule",
            "update_schedule",
            "delete_schedule",
          ],
          deadlineAt: new Date(Date.now() + HOUR),
          leaseExpiresAt: new Date(Date.now() + HOUR),
          contextSnapshot: {
            create: {
              generatedAt: new Date(),
              schemaVersion: 1,
              hash: randomUUID(),
              packet: { trigger: { askedBy: { kind: "OWNER" } } },
              byteSize: 2,
              tokenEstimate: 1,
              counts: {},
              omissions: {},
            },
          },
        },
      });
      const directSchedule = (await sokoBotRuntimeService.executeTool({
        sessionId: ownerSessionId,
        turnId: directChat.id,
        capability: "create_schedule",
        toolCallId: `direct-${randomUUID()}`,
        input: {
          name: "Daily pipeline table update",
          cronExpression: "0 9 * * *",
          timezone: "UTC",
          prompt: "Update the pipeline table rows.",
        },
      })) as { id: string };
      const directFirstRun = await fireScheduleRun(
        botId,
        workspaceId,
        directSchedule.id,
        "v36",
      );
      expect(directFirstRun?.userId).toBe(userId);
      expect(directFirstRun?.capabilities).toContain("write_table_rows");

      // 2. Authorized personal background task (`parentTurnId !== null`) holding
      //    BOTH read_table and write_table_rows:
      //    - creating a recurring table write (explicit or inherited) is refused;
      //    - creating a read-only check via capabilities: ["read_table"] from THAT
      //      SAME broader turn succeeds and fires with read_table;
      //    - editing that read-only schedule from the background run to request
      //      write_table_rows is refused (prompt and capabilities stay unchanged);
      //    - requesting a capability outside the authoring turn's grant is refused;
      //    - direct top-level owner chat upgrading the same schedule with
      //      capabilities: ["read_table", "write_table_rows"] succeeds and fires
      //      with write_table_rows.
      const bgBroadTurn = await prisma.sokoBotTurn.create({
        data: {
          sokoBotId: botId,
          requestedByUserId: userId,
          workspaceId,
          source: "CHAT",
          parentTurnId: directChat.id,
          status: "RUNNING",
          clientTurnId: randomUUID(),
          versionId: "v36",
          userMessage:
            "Background run with both table read and write tools creating schedules.",
          capabilityNames: [
            "read_table",
            "write_table_rows",
            "create_schedule",
            "update_schedule",
            "delete_schedule",
          ],
          deadlineAt: new Date(Date.now() + HOUR),
          leaseExpiresAt: new Date(Date.now() + HOUR),
          contextSnapshot: {
            create: {
              generatedAt: new Date(),
              schemaVersion: 1,
              hash: randomUUID(),
              packet: { trigger: { askedBy: { kind: "OWNER" } } },
              byteSize: 2,
              tokenEstimate: 1,
              counts: {},
              omissions: {},
            },
          },
        },
      });
      await expect(
        sokoBotRuntimeService.executeTool({
          sessionId: ownerSessionId,
          turnId: bgBroadTurn.id,
          capability: "create_schedule",
          toolCallId: `bg-write-${randomUUID()}`,
          input: {
            name: "Background table write",
            cronExpression: "0 10 * * *",
            timezone: "UTC",
            prompt: "Update the pipeline table rows.",
            capabilities: ["read_table", "write_table_rows"],
          },
        }),
      ).rejects.toThrow(/write_table_rows/);
      await expect(
        sokoBotRuntimeService.executeTool({
          sessionId: ownerSessionId,
          turnId: bgBroadTurn.id,
          capability: "create_schedule",
          toolCallId: `bg-write-default-${randomUUID()}`,
          input: {
            name: "Background table write",
            cronExpression: "0 10 * * *",
            timezone: "UTC",
            prompt: "Update the pipeline table rows.",
          },
        }),
      ).rejects.toThrow(/write_table_rows/);
      await expect(
        sokoBotRuntimeService.executeTool({
          sessionId: ownerSessionId,
          turnId: bgBroadTurn.id,
          capability: "create_schedule",
          toolCallId: `bg-ungranted-${randomUUID()}`,
          input: {
            name: "Escalated schedule",
            cronExpression: "0 10 * * *",
            timezone: "UTC",
            prompt: "Read memory.",
            capabilities: ["read_memory"],
          },
        }),
      ).rejects.toThrow(/read_memory/);
      expect(
        await prisma.sokoBotSchedule.count({
          where: {
            sokoBotId: botId,
            name: { in: ["Background table write", "Escalated schedule"] },
          },
        }),
      ).toBe(0);

      // Same broad background turn CAN create a read-only check by declaring capabilities: ["read_table"].
      const bgReadSchedule = (await sokoBotRuntimeService.executeTool({
        sessionId: ownerSessionId,
        turnId: bgBroadTurn.id,
        capability: "create_schedule",
        toolCallId: `bg-ro-${randomUUID()}`,
        input: {
          name: "Background table check",
          cronExpression: "0 11 * * *",
          timezone: "UTC",
          prompt: "Check the pipeline table and report anomalies.",
          capabilities: ["read_table"],
        },
      })) as { id: string };
      const bgFirstRun = await fireScheduleRun(
        botId,
        workspaceId,
        bgReadSchedule.id,
        "v36",
      );
      expect(bgFirstRun?.capabilities).toContain("read_table");
      expect(bgFirstRun?.capabilities).not.toContain("write_table_rows");

      // Background run cannot replace a read-only schedule's prompt without declaring
      // capabilities or keepCapabilities: true, and cannot add write_table_rows.
      await expect(
        sokoBotRuntimeService.executeTool({
          sessionId: ownerSessionId,
          turnId: bgBroadTurn.id,
          capability: "update_schedule",
          toolCallId: `bg-edit-undeclared-${randomUUID()}`,
          input: {
            scheduleId: bgReadSchedule.id,
            prompt: "Update the pipeline table rows.",
          },
        }),
      ).rejects.toThrow(/capabilities|keepCapabilities/);
      expect(
        await prisma.sokoBotSchedule.findUniqueOrThrow({
          where: { id: bgReadSchedule.id },
          select: { prompt: true, capabilityNames: true },
        }),
      ).toEqual({
        prompt: "Check the pipeline table and report anomalies.",
        capabilityNames: ["read_table"],
      });

      // Timing/name edits without prompt still work without capabilities or keepCapabilities,
      // and replacing prompt with keepCapabilities: true succeeds while keeping ["read_table"].
      await sokoBotRuntimeService.executeTool({
        sessionId: ownerSessionId,
        turnId: bgBroadTurn.id,
        capability: "update_schedule",
        toolCallId: `bg-edit-cron-${randomUUID()}`,
        input: {
          scheduleId: bgReadSchedule.id,
          cronExpression: "0 12 * * *",
        },
      });
      await sokoBotRuntimeService.executeTool({
        sessionId: ownerSessionId,
        turnId: bgBroadTurn.id,
        capability: "update_schedule",
        toolCallId: `bg-edit-keep-${randomUUID()}`,
        input: {
          scheduleId: bgReadSchedule.id,
          prompt: "Check the pipeline table and report anomalies clearly.",
          keepCapabilities: true,
        },
      });
      expect(
        await prisma.sokoBotSchedule.findUniqueOrThrow({
          where: { id: bgReadSchedule.id },
          select: { cronExpression: true, prompt: true, capabilityNames: true },
        }),
      ).toEqual({
        cronExpression: "0 12 * * *",
        prompt: "Check the pipeline table and report anomalies clearly.",
        capabilityNames: ["read_table"],
      });

      await expect(
        sokoBotRuntimeService.executeTool({
          sessionId: ownerSessionId,
          turnId: bgBroadTurn.id,
          capability: "update_schedule",
          toolCallId: `bg-edit-write-${randomUUID()}`,
          input: {
            scheduleId: bgReadSchedule.id,
            prompt: "Update the pipeline table rows.",
            capabilities: ["read_table", "write_table_rows"],
          },
        }),
      ).rejects.toThrow(/write_table_rows/);
      expect(
        await prisma.sokoBotSchedule.findUniqueOrThrow({
          where: { id: bgReadSchedule.id },
          select: { prompt: true, capabilityNames: true },
        }),
      ).toEqual({
        prompt: "Check the pipeline table and report anomalies clearly.",
        capabilityNames: ["read_table"],
      });

      // Direct top-level owner chat declaring BOTH create_social_post and schedule_social_post:
      // - refused without allowScheduledPosts: true (0 schedules created);
      // - succeeds with allowScheduledPosts: true, and first run gets BOTH tools;
      // - refused when explicitly declaring publish_social_post even with allowScheduledPosts: true.
      const directSocialChat = await prisma.sokoBotTurn.create({
        data: {
          sokoBotId: botId,
          requestedByUserId: userId,
          workspaceId,
          source: "CHAT",
          status: "RUNNING",
          clientTurnId: randomUUID(),
          versionId: "v36",
          userMessage: "Draft and schedule a weekly LinkedIn post.",
          capabilityNames: [
            "create_social_post",
            "schedule_social_post",
            "publish_social_post",
            "create_schedule",
          ],
          deadlineAt: new Date(Date.now() + HOUR),
          leaseExpiresAt: new Date(Date.now() + HOUR),
          contextSnapshot: {
            create: {
              generatedAt: new Date(),
              schemaVersion: 1,
              hash: randomUUID(),
              packet: { trigger: { askedBy: { kind: "OWNER" } } },
              byteSize: 2,
              tokenEstimate: 1,
              counts: {},
              omissions: {},
            },
          },
        },
      });
      await expect(
        sokoBotRuntimeService.executeTool({
          sessionId: ownerSessionId,
          turnId: directSocialChat.id,
          capability: "create_schedule",
          toolCallId: `direct-social-no-perm-${randomUUID()}`,
          input: {
            name: "Weekly social schedule",
            cronExpression: "0 9 * * 1",
            timezone: "UTC",
            prompt: "Draft and schedule our weekly post.",
            capabilities: ["create_social_post", "schedule_social_post"],
          },
        }),
      ).rejects.toThrow(/schedule_social_post.*allowScheduledPosts/i);
      await expect(
        sokoBotRuntimeService.executeTool({
          sessionId: ownerSessionId,
          turnId: directSocialChat.id,
          capability: "create_schedule",
          toolCallId: `direct-social-publish-${randomUUID()}`,
          input: {
            name: "Weekly social publish",
            cronExpression: "0 9 * * 1",
            timezone: "UTC",
            prompt: "Draft and publish immediately.",
            allowScheduledPosts: true,
            capabilities: ["create_social_post", "publish_social_post"],
          },
        }),
      ).rejects.toThrow(/publish_social_post/);
      expect(
        await prisma.sokoBotSchedule.count({
          where: {
            sokoBotId: botId,
            name: { in: ["Weekly social schedule", "Weekly social publish"] },
          },
        }),
      ).toBe(0);

      const authorizedSocialSchedule = (await sokoBotRuntimeService.executeTool(
        {
          sessionId: ownerSessionId,
          turnId: directSocialChat.id,
          capability: "create_schedule",
          toolCallId: `direct-social-with-perm-${randomUUID()}`,
          input: {
            name: "Weekly social schedule",
            cronExpression: "0 9 * * 1",
            timezone: "UTC",
            prompt: "Draft and schedule our weekly post.",
            allowScheduledPosts: true,
            capabilities: ["create_social_post", "schedule_social_post"],
          },
        },
      )) as { id: string };
      const socialFirstRun = await fireScheduleRun(
        botId,
        workspaceId,
        authorizedSocialSchedule.id,
        "v36",
      );
      expect(socialFirstRun?.capabilities).toEqual(
        expect.arrayContaining(["create_social_post", "schedule_social_post"]),
      );
      expect(socialFirstRun?.capabilities).not.toContain("publish_social_post");

      // Built-in personal rhythm (standup): capability changes are refused
      // (its fixed system route ignores stored capabilityNames), while timing-only
      // updates still succeed.
      const standup = await prisma.sokoBotSchedule.create({
        data: {
          sokoBotId: botId,
          workspaceId,
          requestedByUserId: userId,
          name: "Daily stand-up",
          systemKey: "standup",
          prompt: "Run the daily stand-up.",
          cronExpression: "0 9 * * 1-5",
          timezone: "UTC",
          enabled: true,
          nextRunAt: new Date(Date.now() + HOUR),
          capabilityNames: [],
        },
      });
      await expect(
        sokoBotRuntimeService.executeTool({
          sessionId: ownerSessionId,
          turnId: directChat.id,
          capability: "update_schedule",
          toolCallId: `standup-caps-${randomUUID()}`,
          input: {
            scheduleId: standup.id,
            capabilities: ["read_table"],
          },
        }),
      ).rejects.toThrow(/built-in rhythm/);
      expect(
        await prisma.sokoBotSchedule.findUniqueOrThrow({
          where: { id: standup.id },
          select: { capabilityNames: true, cronExpression: true },
        }),
      ).toEqual({
        capabilityNames: [],
        cronExpression: "0 9 * * 1-5",
      });
      await sokoBotRuntimeService.executeTool({
        sessionId: ownerSessionId,
        turnId: directChat.id,
        capability: "update_schedule",
        toolCallId: `standup-time-${randomUUID()}`,
        input: {
          scheduleId: standup.id,
          cronExpression: "0 10 * * 1-5",
        },
      });
      expect(
        await prisma.sokoBotSchedule.findUniqueOrThrow({
          where: { id: standup.id },
          select: { capabilityNames: true, cronExpression: true },
        }),
      ).toEqual({
        capabilityNames: [],
        cronExpression: "0 10 * * 1-5",
      });
      // Creating a custom schedule with a built-in rhythm's name (same or
      // different case) is refused instead of overwriting the built-in row.
      for (const collidingName of ["Daily stand-up", "daily stand-up"]) {
        await expect(
          sokoBotRuntimeService.executeTool({
            sessionId: ownerSessionId,
            turnId: directChat.id,
            capability: "create_schedule",
            toolCallId: `standup-create-collide-${randomUUID()}`,
            input: {
              name: collidingName,
              cronExpression: "0 8 * * 1-5",
              timezone: "UTC",
              prompt: "Read the daily KPI table.",
              capabilities: ["read_table"],
            },
          }),
        ).rejects.toThrow(/built-in rhythm.*different name/i);
      }
      expect(
        await prisma.sokoBotSchedule.findUniqueOrThrow({
          where: { id: standup.id },
          select: {
            name: true,
            prompt: true,
            capabilityNames: true,
            cronExpression: true,
            authority: true,
          },
        }),
      ).toEqual({
        name: "Daily stand-up",
        prompt: "Run the daily stand-up.",
        capabilityNames: [],
        cronExpression: "0 10 * * 1-5",
        authority: null,
      });
      const distinctReadOnly = (await sokoBotRuntimeService.executeTool({
        sessionId: ownerSessionId,
        turnId: directChat.id,
        capability: "create_schedule",
        toolCallId: `standup-distinct-${randomUUID()}`,
        input: {
          name: "Daily KPI table check",
          cronExpression: "0 8 * * 1-5",
          timezone: "UTC",
          prompt: "Read the daily KPI table.",
          capabilities: ["read_table"],
        },
      })) as { id: string };
      expect(distinctReadOnly.id).not.toBe(standup.id);
      const distinctRun = await fireScheduleRun(
        botId,
        workspaceId,
        distinctReadOnly.id,
        "v36",
      );
      expect(distinctRun?.capabilities).toContain("read_table");
      expect(distinctRun?.capabilities).not.toContain("write_table_rows");

      // Creating a custom schedule always inserts a new row (never upserts or
      // overwrites by name, including SQL LIKE wildcard names like "Margin 5%"
      // alongside "Margin 50%" or exact same-name creates with new instructions).
      const margin50Input = {
        name: "Margin 50%",
        cronExpression: "0 9 * * 1",
        timezone: "UTC",
        prompt: "Check 50% margin threshold.",
        capabilities: ["read_table"],
      };
      const margin50 = (await sokoBotRuntimeService.executeTool({
        sessionId: ownerSessionId,
        turnId: directChat.id,
        capability: "create_schedule",
        toolCallId: `margin-50-create-${randomUUID()}`,
        input: margin50Input,
      })) as { id: string };
      // Same-turn identical retry still replays the original receipt id.
      const margin50Retry = (await sokoBotRuntimeService.executeTool({
        sessionId: ownerSessionId,
        turnId: directChat.id,
        capability: "create_schedule",
        toolCallId: `margin-50-retry-${randomUUID()}`,
        input: margin50Input,
      })) as { id: string };
      expect(margin50Retry.id).toBe(margin50.id);
      // "Margin 5%" inserts its own row and leaves "Margin 50%" untouched.
      const margin5 = (await sokoBotRuntimeService.executeTool({
        sessionId: ownerSessionId,
        turnId: directChat.id,
        capability: "create_schedule",
        toolCallId: `margin-5-create-${randomUUID()}`,
        input: {
          name: "Margin 5%",
          cronExpression: "0 10 * * 1",
          timezone: "UTC",
          prompt: "Check 5% margin threshold.",
          capabilities: ["read_table"],
        },
      })) as { id: string };
      expect(margin5.id).not.toBe(margin50.id);
      // Even an exact same-name create with different instructions inserts a
      // new row; updates go only through update_schedule.
      const margin50Second = (await sokoBotRuntimeService.executeTool({
        sessionId: ownerSessionId,
        turnId: directChat.id,
        capability: "create_schedule",
        toolCallId: `margin-50-second-${randomUUID()}`,
        input: {
          name: "Margin 50%",
          cronExpression: "0 11 * * 1",
          timezone: "UTC",
          prompt: "Check quarterly 50% margin threshold.",
          capabilities: ["read_table"],
        },
      })) as { id: string };
      expect(margin50Second.id).not.toBe(margin50.id);
      expect(
        await prisma.sokoBotSchedule.findUniqueOrThrow({
          where: { id: margin50.id },
          select: { name: true, prompt: true, cronExpression: true },
        }),
      ).toEqual({
        name: "Margin 50%",
        prompt: "Check 50% margin threshold.",
        cronExpression: "0 9 * * 1",
      });
      expect(
        await prisma.sokoBotSchedule.findUniqueOrThrow({
          where: { id: margin5.id },
          select: { name: true, prompt: true, cronExpression: true },
        }),
      ).toEqual({
        name: "Margin 5%",
        prompt: "Check 5% margin threshold.",
        cronExpression: "0 10 * * 1",
      });
      // Updating by name uses literal exact matching (never SQL % wildcards)
      // and refuses ambiguous duplicate names until a scheduleId is supplied.
      await expect(
        sokoBotRuntimeService.executeTool({
          sessionId: ownerSessionId,
          turnId: directChat.id,
          capability: "update_schedule",
          toolCallId: `margin-wildcard-miss-${randomUUID()}`,
          input: {
            scheduleName: "Margin %",
            cronExpression: "45 9 * * 1",
          },
        }),
      ).rejects.toThrow(/Schedule not found/);
      await sokoBotRuntimeService.executeTool({
        sessionId: ownerSessionId,
        turnId: directChat.id,
        capability: "update_schedule",
        toolCallId: `margin-5-by-name-${randomUUID()}`,
        input: {
          scheduleName: "margin 5%",
          cronExpression: "15 10 * * 1",
        },
      });
      expect(
        await prisma.sokoBotSchedule.findUniqueOrThrow({
          where: { id: margin5.id },
          select: { name: true, prompt: true, cronExpression: true },
        }),
      ).toEqual({
        name: "Margin 5%",
        prompt: "Check 5% margin threshold.",
        cronExpression: "15 10 * * 1",
      });
      await expect(
        sokoBotRuntimeService.executeTool({
          sessionId: ownerSessionId,
          turnId: directChat.id,
          capability: "update_schedule",
          toolCallId: `margin-50-ambiguous-update-${randomUUID()}`,
          input: {
            scheduleName: "Margin 50%",
            cronExpression: "45 9 * * 1",
          },
        }),
      ).rejects.toThrow(
        new RegExp(
          `Multiple schedules are named "Margin 50%".*${margin50.id}.*${margin50Second.id}.*scheduleId`,
        ),
      );
      await expect(
        sokoBotRuntimeService.executeTool({
          sessionId: ownerSessionId,
          turnId: directChat.id,
          capability: "delete_schedule",
          toolCallId: `margin-50-ambiguous-delete-${randomUUID()}`,
          input: {
            scheduleName: "Margin 50%",
          },
        }),
      ).rejects.toThrow(
        new RegExp(
          `Multiple schedules are named "Margin 50%".*${margin50.id}.*${margin50Second.id}.*scheduleId`,
        ),
      );
      expect(
        await prisma.sokoBotSchedule.findUniqueOrThrow({
          where: { id: margin50.id },
          select: { prompt: true, cronExpression: true },
        }),
      ).toEqual({
        prompt: "Check 50% margin threshold.",
        cronExpression: "0 9 * * 1",
      });
      expect(
        await prisma.sokoBotSchedule.findUniqueOrThrow({
          where: { id: margin50Second.id },
          select: { prompt: true, cronExpression: true },
        }),
      ).toEqual({
        prompt: "Check quarterly 50% margin threshold.",
        cronExpression: "0 11 * * 1",
      });
      await sokoBotRuntimeService.executeTool({
        sessionId: ownerSessionId,
        turnId: directChat.id,
        capability: "update_schedule",
        toolCallId: `margin-50-update-${randomUUID()}`,
        input: {
          scheduleId: margin50.id,
          cronExpression: "30 9 * * 1",
        },
      });
      expect(
        await prisma.sokoBotSchedule.findUniqueOrThrow({
          where: { id: margin50.id },
          select: { prompt: true, cronExpression: true },
        }),
      ).toEqual({
        prompt: "Check 50% margin threshold.",
        cronExpression: "30 9 * * 1",
      });
      expect(
        await prisma.sokoBotSchedule.findUniqueOrThrow({
          where: { id: margin50Second.id },
          select: { prompt: true, cronExpression: true },
        }),
      ).toEqual({
        prompt: "Check quarterly 50% margin threshold.",
        cronExpression: "0 11 * * 1",
      });

      // Direct top-level owner chat CAN upgrade that read-only schedule to write_table_rows,
      // and its next run actually carries write_table_rows.
      await sokoBotRuntimeService.executeTool({
        sessionId: ownerSessionId,
        turnId: directChat.id,
        capability: "update_schedule",
        toolCallId: `direct-upgrade-${randomUUID()}`,
        input: {
          scheduleId: bgReadSchedule.id,
          prompt: "Update the pipeline table rows.",
          capabilities: ["read_table", "write_table_rows"],
        },
      });
      const upgradedRun = await fireScheduleRun(
        botId,
        workspaceId,
        bgReadSchedule.id,
        "v36",
      );
      expect(upgradedRun?.userId).toBe(userId);
      expect(upgradedRun?.capabilities).toContain("write_table_rows");

      // 3. Teammate on a shared Cuso org bot holding BOTH read_memory and update_memory:
      //    - creating a custom recurring memory write is refused;
      //    - creating a read-only check via capabilities: ["read_memory"] from THAT
      //      SAME broader turn succeeds and runs as Cuso (`actingUserId: null`);
      //    - editing that read-only schedule to add update_memory is refused.
      const { withFixtureSchemas } = await import("@/test/split-layout");
      const orgId = randomUUID();
      const teammateId = randomUUID();
      const cusoSessionId = randomUUID();
      let orgWorkspaceId: string | null = null;
      let cusoBotId: string | null = null;
      try {
        const orgWorkspace = await withFixtureSchemas(async (tx) => {
          await tx.organization.create({
            data: { id: orgId, name: "Cuso Schedule Org", slug: orgId },
          });
          await tx.user.create({
            data: {
              id: teammateId,
              name: "Cuso Teammate",
              email: `${teammateId}@example.test`,
              emailVerified: true,
              createdAt: new Date(),
              updatedAt: new Date(),
            },
          });
          await tx.member.create({
            data: {
              userId: teammateId,
              organizationId: orgId,
              role: "member",
              seatAssignedAt: new Date(),
            },
          });
          return tx.workspace.create({
            data: { organizationId: orgId },
          });
        });
        orgWorkspaceId = orgWorkspace.id;
        const cusoBot = await prisma.sokoBot.create({
          data: {
            userId: null,
            workspaceId: orgWorkspaceId,
            versionId: "cmo-v24",
            eveSessionId: cusoSessionId,
            proactiveDailyLimit: 10_000,
          },
        });
        cusoBotId = cusoBot.id;

        const cusoBroadTurn = await prisma.sokoBotTurn.create({
          data: {
            sokoBotId: cusoBotId,
            requestedByUserId: teammateId,
            askedByUserId: teammateId,
            workspaceId: orgWorkspaceId,
            source: "CHAT",
            status: "RUNNING",
            clientTurnId: randomUUID(),
            versionId: "cmo-v24",
            userMessage: "Manage recurring brand memory checks for our team.",
            capabilityNames: [
              "read_memory",
              "update_memory",
              "create_schedule",
              "update_schedule",
            ],
            deadlineAt: new Date(Date.now() + HOUR),
            leaseExpiresAt: new Date(Date.now() + HOUR),
            contextSnapshot: {
              create: {
                generatedAt: new Date(),
                schemaVersion: 1,
                hash: randomUUID(),
                packet: { trigger: { askedBy: { kind: "TEAMMATE" } } },
                byteSize: 2,
                tokenEstimate: 1,
                counts: {},
                omissions: {},
              },
            },
          },
        });
        await expect(
          sokoBotRuntimeService.executeTool({
            sessionId: cusoSessionId,
            turnId: cusoBroadTurn.id,
            capability: "create_schedule",
            toolCallId: `cuso-write-${randomUUID()}`,
            input: {
              name: "Weekly org memory update",
              cronExpression: "0 9 * * 1",
              timezone: "UTC",
              prompt: "Update our brand memory each Monday.",
              capabilities: ["read_memory", "update_memory"],
            },
          }),
        ).rejects.toThrow(/update_memory/);
        expect(
          await prisma.sokoBotSchedule.count({
            where: { sokoBotId: cusoBotId, name: "Weekly org memory update" },
          }),
        ).toBe(0);

        // Same broad Cuso teammate turn CAN create a read-only check by passing capabilities: ["read_memory"].
        const cusoReadSchedule = (await sokoBotRuntimeService.executeTool({
          sessionId: cusoSessionId,
          turnId: cusoBroadTurn.id,
          capability: "create_schedule",
          toolCallId: `cuso-ro-${randomUUID()}`,
          input: {
            name: "Weekly org memory check",
            cronExpression: "0 10 * * 1",
            timezone: "UTC",
            prompt: "Review our brand memory and flag stale facts.",
            capabilities: ["read_memory"],
          },
        })) as { id: string };
        const cusoFirstRun = await fireScheduleRun(
          cusoBotId,
          orgWorkspaceId,
          cusoReadSchedule.id,
          "cmo-v24",
        );
        // Cuso keeps its shared execution identity (actingUserId === null) and read_memory.
        expect(cusoFirstRun?.userId).toBeNull();
        expect(cusoFirstRun?.capabilities).toContain("read_memory");
        expect(cusoFirstRun?.capabilities).not.toContain("update_memory");

        // Editing that read-only Cuso schedule to require update_memory is refused.
        await expect(
          sokoBotRuntimeService.executeTool({
            sessionId: cusoSessionId,
            turnId: cusoBroadTurn.id,
            capability: "update_schedule",
            toolCallId: `cuso-edit-write-${randomUUID()}`,
            input: {
              scheduleId: cusoReadSchedule.id,
              prompt: "Update our brand memory each Monday.",
              capabilities: ["read_memory", "update_memory"],
            },
          }),
        ).rejects.toThrow(/update_memory/);
        expect(
          await prisma.sokoBotSchedule.findUniqueOrThrow({
            where: { id: cusoReadSchedule.id },
            select: { prompt: true, capabilityNames: true },
          }),
        ).toEqual({
          prompt: "Review our brand memory and flag stale facts.",
          capabilityNames: ["read_memory"],
        });
      } finally {
        await withFixtureSchemas(async (tx) => {
          if (cusoBotId) {
            await tx.sokoBotSchedule.deleteMany({
              where: { sokoBotId: cusoBotId },
            });
            await tx.sokoBot.deleteMany({ where: { id: cusoBotId } });
          }
          if (orgWorkspaceId) {
            await tx.workspace.deleteMany({ where: { id: orgWorkspaceId } });
          }
          await tx.organization.deleteMany({ where: { id: orgId } });
          await tx.user.deleteMany({ where: { id: teammateId } });
        });
      }
    });

    it("enforces SokoBotWatch social authority and watch/schedule media limits across occurrences and admin retries on PostgreSQL", async () => {
      const rootChatTurn = await prisma.sokoBotTurn.create({
        data: {
          sokoBotId: botId,
          requestedByUserId: userId,
          workspaceId,
          source: "CHAT",
          status: "COMPLETED",
          clientTurnId: randomUUID(),
          versionId: "v36",
          userMessage: "Watch the reply and generate visuals on Project A.",
          capabilityNames: ["create_social_post", "generate_image"],
          deadlineAt: new Date(Date.now() + HOUR),
          leaseExpiresAt: new Date(Date.now() + HOUR),
        },
      });
      const projectA = randomUUID();
      const projectB = randomUUID();
      const sharedWatchGrantId = `watch-shared-${randomUUID()}`;
      const baseWatchAuth = {
        version: 1 as const,
        grantId: sharedWatchGrantId,
        origin: "owner_chat" as const,
        sokoBotId: botId,
        workspaceId,
        ownerUserId: userId,
        rootTurnId: rootChatTurn.id,
        targetScope: { kind: "project" as const, projectId: projectA },
        scope: "draft_and_workspace" as const,
        socialMode: "full" as const,
        limits: {
          grantId: sharedWatchGrantId,
          period: "lifetime" as const,
          images: 1,
          maxMediaCredits: 10,
        },
        stopRule: { mode: "never" as const },
      };

      const chatReplyWatch = await prisma.sokoBotWatch.create({
        data: {
          sokoBotId: botId,
          turnId: rootChatTurn.id,
          kind: "chat_reply",
          targetId: randomUUID(),
          projectId: projectA,
          then: "Draft a social post and make 1 image.",
          status: "FIRED",
          expiresAt: new Date(Date.now() + HOUR),
          authority: baseWatchAuth,
        },
      });
      const siblingWatch = await prisma.sokoBotWatch.create({
        data: {
          sokoBotId: botId,
          turnId: rootChatTurn.id,
          kind: "studio_job",
          targetId: randomUUID(),
          projectId: projectA,
          then: "Make an image under the same shared grant.",
          status: "FIRED",
          expiresAt: new Date(Date.now() + HOUR),
          authority: baseWatchAuth,
        },
      });
      const expiredWatch = await prisma.sokoBotWatch.create({
        data: {
          sokoBotId: botId,
          turnId: rootChatTurn.id,
          kind: "studio_job",
          targetId: randomUUID(),
          projectId: projectA,
          then: "Expired follow-up.",
          status: "FIRED",
          expiresAt: new Date(Date.now() + HOUR),
          authority: {
            ...baseWatchAuth,
            grantId: `expired-${randomUUID()}`,
            expiresAt: "2020-01-01T00:00:00.000Z",
          },
        },
      });
      const corruptWatch = await prisma.sokoBotWatch.create({
        data: {
          sokoBotId: botId,
          turnId: rootChatTurn.id,
          kind: "studio_job",
          targetId: randomUUID(),
          projectId: projectA,
          then: "Corrupt authority payload.",
          status: "FIRED",
          expiresAt: new Date(Date.now() + HOUR),
          authority: { invalid: true },
        },
      });
      const legacyWatch = await prisma.sokoBotWatch.create({
        data: {
          sokoBotId: botId,
          turnId: rootChatTurn.id,
          kind: "chat_reply",
          targetId: randomUUID(),
          projectId: null,
          then: "Pre-migration legacy chat_reply watch.",
          status: "FIRED",
          expiresAt: new Date(Date.now() + HOUR),
        },
      });

      const makeTurn = (
        source: "CHAT" | "SCHEDULE" | "ADMIN_RETRY",
        clientTurnId: string,
      ) =>
        prisma.sokoBotTurn.create({
          data: {
            sokoBotId: botId,
            requestedByUserId: userId,
            workspaceId,
            source,
            status: "RUNNING",
            clientTurnId,
            versionId: "v36",
            userMessage: "Follow-up execution",
            capabilityNames: ["create_social_post", "generate_image"],
            deadlineAt: new Date(Date.now() + HOUR),
            leaseExpiresAt: new Date(Date.now() + HOUR),
          },
        });

      const wakeTurn = await makeTurn("CHAT", `watch:${chatReplyWatch.id}`);
      const wakeAdminRetry = await makeTurn(
        "ADMIN_RETRY",
        `admin-retry:${wakeTurn.id}:op1`,
      );
      const siblingWakeTurn = await makeTurn(
        "CHAT",
        `watch:${siblingWatch.id}`,
      );
      const expiredWakeTurn = await makeTurn(
        "CHAT",
        `watch:${expiredWatch.id}`,
      );
      const corruptWakeTurn = await makeTurn(
        "CHAT",
        `watch:${corruptWatch.id}`,
      );
      const legacyWakeTurn = await makeTurn("CHAT", `watch:${legacyWatch.id}`);
      const deletedWakeTurn = await makeTurn("CHAT", `watch:${randomUUID()}`);
      const malformedWakeTurn = await makeTurn("CHAT", "watch:not-a-uuid");

      // 1. Social write enforcement on watch wakes and their ADMIN_RETRY chains.
      for (const candidate of [wakeTurn, wakeAdminRetry]) {
        const origin = await resolveSocialWriteOrigin({
          id: candidate.id,
          sokoBotId: botId,
          source: candidate.source,
          clientTurnId: candidate.clientTurnId,
        });
        expect(origin.watchAuthority?.kind).toBe("watch");
        const turnInfo = {
          id: candidate.id,
          sokoBotId: botId,
          workspaceId,
          versionId: "v36",
          source: origin.source,
          actingUserId: userId,
          askedByKind: "OWNER" as const,
          sharedBot: false,
        };
        expect(
          evaluateSocialWriteAuthority({
            turn: turnInfo,
            capability: "create_social_post",
            rawInput: { projectId: projectA, text: "Draft only" },
            tainted: false,
            watchAuthority: origin.watchAuthority,
          }),
        ).toEqual({ allowed: true, requireUnapprovedDraft: false });
        expect(
          evaluateSocialWriteAuthority({
            turn: turnInfo,
            capability: "create_social_post",
            rawInput: {
              projectId: projectA,
              text: "Scheduled",
              scheduledAt: "2026-12-01T10:00:00Z",
            },
            tainted: false,
            watchAuthority: origin.watchAuthority,
          }),
        ).toEqual({
          allowed: false,
          kind: "watch_authority",
          detail: WATCH_SOCIAL_DRAFT_ONLY_MESSAGE,
        });
        expect(
          evaluateSocialWriteAuthority({
            turn: turnInfo,
            capability: "create_social_post",
            rawInput: { projectId: projectB, text: "Wrong Project" },
            tainted: false,
            watchAuthority: origin.watchAuthority,
          }),
        ).toEqual({
          allowed: false,
          kind: "watch_authority",
          detail: WATCH_AUTHORITY_SCOPE_MISMATCH_MESSAGE,
        });
      }

      // Expired, corrupt, legacy, deleted, and malformed watches on real PostgreSQL.
      for (const [turnRow, expectedDetail] of [
        [expiredWakeTurn, WATCH_AUTHORITY_EXPIRED_MESSAGE],
        [corruptWakeTurn, WATCH_AUTHORITY_INVALID_MESSAGE],
        [deletedWakeTurn, WATCH_AUTHORITY_UNAVAILABLE_MESSAGE],
        [malformedWakeTurn, WATCH_AUTHORITY_UNAVAILABLE_MESSAGE],
      ] as const) {
        const origin = await resolveSocialWriteOrigin({
          id: turnRow.id,
          sokoBotId: botId,
          source: turnRow.source,
          clientTurnId: turnRow.clientTurnId,
        });
        expect(
          evaluateSocialWriteAuthority({
            turn: {
              id: turnRow.id,
              sokoBotId: botId,
              workspaceId,
              versionId: "v36",
              source: origin.source,
              actingUserId: userId,
              askedByKind: "OWNER",
              sharedBot: false,
            },
            capability: "create_social_post",
            rawInput: { projectId: projectA, text: "Blocked" },
            tainted: false,
            watchAuthority: origin.watchAuthority,
          }),
        ).toEqual({
          allowed: false,
          kind: "watch_authority",
          detail: expectedDetail,
        });
      }

      const legacyOrigin = await resolveSocialWriteOrigin({
        id: legacyWakeTurn.id,
        sokoBotId: botId,
        source: legacyWakeTurn.source,
        clientTurnId: legacyWakeTurn.clientTurnId,
      });
      expect(
        evaluateSocialWriteAuthority({
          turn: {
            id: legacyWakeTurn.id,
            sokoBotId: botId,
            workspaceId,
            versionId: "v36",
            source: legacyOrigin.source,
            actingUserId: userId,
            askedByKind: "OWNER",
            sharedBot: false,
          },
          capability: "schedule_social_post",
          rawInput: { projectId: projectA, postId: randomUUID() },
          tainted: false,
          watchAuthority: legacyOrigin.watchAuthority,
        }),
      ).toEqual({
        allowed: false,
        kind: "watch_authority",
        detail: WATCH_SOCIAL_DRAFT_ONLY_MESSAGE,
      });

      // 2. Shared watch media limits across parallel watches & ADMIN_RETRY on PostgreSQL.
      const mediaRuntime = {
        mayActForOwner: async (auth: { turn: { source: string | null } }) =>
          auth.turn.source === "CHAT",
      };
      const asAuthorized = (row: {
        id: string;
        source: string | null;
        clientTurnId: string;
      }) =>
        ({
          askedByKind: "OWNER",
          reader: { sharedScope: null },
          turn: {
            id: row.id,
            sokoBotId: botId,
            workspaceId,
            versionId: "v36",
            source: row.source,
            clientTurnId: row.clientTurnId,
            actingUserId: userId,
            chainDepth: 0,
          },
        }) as unknown as Parameters<typeof mayMakeMediaForOwner>[1];

      const watch1Allowance = await mayMakeMediaForOwner(
        mediaRuntime,
        asAuthorized(wakeTurn),
        { projectId: projectA, capability: "generate_image" },
      );
      expect(watch1Allowance?.grants).toHaveLength(1);
      await prisma.$transaction(async (tx) => {
        await reserveAuthoritySpend(tx, {
          sokoBotId: botId,
          workspaceId,
          turnId: wakeTurn.id,
          toolCallId: "watch-img-1",
          operationKey: "op-watch-img-1",
          capability: "generate_image",
          projectId: projectA,
          images: 1,
          videos: 0,
          credits: 4,
          grants: watch1Allowance!.grants!,
        });
      });
      await settleAuthoritySpend(
        prisma,
        {
          turnId: wakeTurn.id,
          toolCallId: "watch-img-1",
        },
        "SETTLED",
      );

      // Parallel sibling watch AND ADMIN_RETRY sharing the same grantId are now refused.
      for (const blockedTurn of [siblingWakeTurn, wakeAdminRetry]) {
        const allowance = await mayMakeMediaForOwner(
          mediaRuntime,
          asAuthorized(blockedTurn),
          { projectId: projectA, capability: "generate_image" },
        );
        await expect(
          checkGrantSpendPreflight(prisma, {
            sokoBotId: botId,
            workspaceId,
            turnId: blockedTurn.id,
            toolCallId: `blocked-${randomUUID()}`,
            operationKey: null,
            capability: "generate_image",
            projectId: projectA,
            images: 1,
            videos: 0,
            credits: 4,
            grants: allowance!.grants!,
          }),
        ).rejects.toThrow("The owner asked for 1 image in this plan");
      }

      // 3. Schedule per_occurrence vs lifetime media limits across occurrences and retries.
      const perOccSchedId = randomUUID();
      const perOccGrantId = `sched-occ-${randomUUID()}`;
      await prisma.sokoBotSchedule.create({
        data: {
          id: perOccSchedId,
          sokoBotId: botId,
          workspaceId,
          requestedByUserId: userId,
          name: "Weekly hero image",
          cronExpression: "0 9 * * 1",
          timezone: "UTC",
          prompt: "Generate 1 weekly hero image.",
          nextRunAt: new Date(Date.now() + HOUR),
          capabilityNames: ["generate_image"],
          authority: {
            version: 1,
            grantId: perOccGrantId,
            origin: "owner_chat",
            sokoBotId: botId,
            workspaceId,
            ownerUserId: userId,
            rootTurnId: rootChatTurn.id,
            targetScope: { kind: "project", projectId: projectA },
            scheduleId: perOccSchedId,
            scope: "owner_writes",
            socialMode: "draft_only",
            limits: {
              grantId: perOccGrantId,
              period: "per_occurrence",
              images: 1,
              maxMediaCredits: 10,
            },
            stopRule: { mode: "never" },
          },
        },
      });
      const slot1 = new Date("2026-11-30T09:00:00.000Z");
      const slot2 = new Date("2026-12-07T09:00:00.000Z");
      const occ1Turn = await makeTurn(
        "SCHEDULE",
        `schedule:${perOccSchedId}:${slot1.toISOString()}`,
      );
      const occ1Run = await prisma.sokoBotScheduleRun.create({
        data: {
          scheduleId: perOccSchedId,
          scheduledFor: slot1,
          status: "RUNNING",
          turnId: occ1Turn.id,
        },
      });
      const occ1AdminRetry = await makeTurn(
        "ADMIN_RETRY",
        `admin-retry:${occ1Turn.id}:op1`,
      );
      const occ1SchedRetry = await makeTurn(
        "ADMIN_RETRY",
        `admin-schedule-retry:${occ1Run.id}:op1`,
      );
      const occ2Turn = await makeTurn(
        "SCHEDULE",
        `schedule:${perOccSchedId}:${slot2.toISOString()}`,
      );
      await prisma.sokoBotScheduleRun.create({
        data: {
          scheduleId: perOccSchedId,
          scheduledFor: slot2,
          status: "RUNNING",
          turnId: occ2Turn.id,
        },
      });

      const occ1Allowance = await mayMakeMediaForOwner(
        mediaRuntime,
        asAuthorized(occ1Turn),
        { projectId: projectA, capability: "generate_image" },
      );
      expect(occ1Allowance?.grants?.[0]?.grantId).toBe(
        `${perOccGrantId}:slot:${slot1.toISOString()}`,
      );
      // Image-only schedule refuses generate_video.
      expect(
        await mayMakeMediaForOwner(mediaRuntime, asAuthorized(occ1Turn), {
          projectId: projectA,
          capability: "generate_video",
        }),
      ).toBeNull();
      // Spend 1/1 on Occurrence 1.
      await prisma.$transaction(async (tx) => {
        await reserveAuthoritySpend(tx, {
          sokoBotId: botId,
          workspaceId,
          turnId: occ1Turn.id,
          toolCallId: "occ1-img-1",
          operationKey: "op-occ1-img-1",
          capability: "generate_image",
          projectId: projectA,
          images: 1,
          videos: 0,
          credits: 4,
          grants: occ1Allowance!.grants!,
        });
      });
      await settleAuthoritySpend(
        prisma,
        {
          turnId: occ1Turn.id,
          toolCallId: "occ1-img-1",
        },
        "SETTLED",
      );
      // Both admin-retry and admin-schedule-retry of Occurrence 1 are refused.
      for (const retryRow of [occ1AdminRetry, occ1SchedRetry]) {
        const retryAllowance = await mayMakeMediaForOwner(
          mediaRuntime,
          asAuthorized(retryRow),
          { projectId: projectA, capability: "generate_image" },
        );
        await expect(
          checkGrantSpendPreflight(prisma, {
            sokoBotId: botId,
            workspaceId,
            turnId: retryRow.id,
            toolCallId: `occ1-retry-${randomUUID()}`,
            operationKey: null,
            capability: "generate_image",
            projectId: projectA,
            images: 1,
            videos: 0,
            credits: 4,
            grants: retryAllowance!.grants!,
          }),
        ).rejects.toThrow("The owner asked for 1 image in this plan");
      }
      // Occurrence 2 gets its own fresh bucket and succeeds at preflight.
      const occ2Allowance = await mayMakeMediaForOwner(
        mediaRuntime,
        asAuthorized(occ2Turn),
        { projectId: projectA, capability: "generate_image" },
      );
      expect(occ2Allowance?.grants?.[0]?.grantId).toBe(
        `${perOccGrantId}:slot:${slot2.toISOString()}`,
      );
      await expect(
        checkGrantSpendPreflight(prisma, {
          sokoBotId: botId,
          workspaceId,
          turnId: occ2Turn.id,
          toolCallId: "occ2-img-1",
          operationKey: null,
          capability: "generate_image",
          projectId: projectA,
          images: 1,
          videos: 0,
          credits: 4,
          grants: occ2Allowance!.grants!,
        }),
      ).resolves.toBeUndefined();

      // Lifetime schedule shares ONE grantId across occurrences: Occurrence 2 is refused.
      const lifetimeSchedId = randomUUID();
      const lifetimeGrantId = `sched-life-${randomUUID()}`;
      await prisma.sokoBotSchedule.create({
        data: {
          id: lifetimeSchedId,
          sokoBotId: botId,
          workspaceId,
          requestedByUserId: userId,
          name: "Campaign lifetime cap",
          cronExpression: "0 9 * * 2",
          timezone: "UTC",
          prompt: "Generate up to 1 image total across the campaign.",
          nextRunAt: new Date(Date.now() + HOUR),
          capabilityNames: ["generate_image"],
          authority: {
            version: 1,
            grantId: lifetimeGrantId,
            origin: "owner_chat",
            sokoBotId: botId,
            workspaceId,
            ownerUserId: userId,
            rootTurnId: rootChatTurn.id,
            targetScope: { kind: "project", projectId: projectA },
            scheduleId: lifetimeSchedId,
            scope: "owner_writes",
            socialMode: "draft_only",
            limits: {
              grantId: lifetimeGrantId,
              period: "lifetime",
              images: 1,
              maxMediaCredits: 10,
            },
            stopRule: { mode: "never" },
          },
        },
      });
      const life1Turn = await makeTurn(
        "SCHEDULE",
        `schedule:${lifetimeSchedId}:${slot1.toISOString()}`,
      );
      await prisma.sokoBotScheduleRun.create({
        data: {
          scheduleId: lifetimeSchedId,
          scheduledFor: slot1,
          status: "RUNNING",
          turnId: life1Turn.id,
        },
      });
      const life2Turn = await makeTurn(
        "SCHEDULE",
        `schedule:${lifetimeSchedId}:${slot2.toISOString()}`,
      );
      await prisma.sokoBotScheduleRun.create({
        data: {
          scheduleId: lifetimeSchedId,
          scheduledFor: slot2,
          status: "RUNNING",
          turnId: life2Turn.id,
        },
      });
      const life1Allowance = await mayMakeMediaForOwner(
        mediaRuntime,
        asAuthorized(life1Turn),
        { projectId: projectA, capability: "generate_image" },
      );
      await prisma.$transaction(async (tx) => {
        await reserveAuthoritySpend(tx, {
          sokoBotId: botId,
          workspaceId,
          turnId: life1Turn.id,
          toolCallId: "life1-img-1",
          operationKey: "op-life1-img-1",
          capability: "generate_image",
          projectId: projectA,
          images: 1,
          videos: 0,
          credits: 4,
          grants: life1Allowance!.grants!,
        });
      });
      await settleAuthoritySpend(
        prisma,
        {
          turnId: life1Turn.id,
          toolCallId: "life1-img-1",
        },
        "SETTLED",
      );
      const life2Allowance = await mayMakeMediaForOwner(
        mediaRuntime,
        asAuthorized(life2Turn),
        { projectId: projectA, capability: "generate_image" },
      );
      await expect(
        checkGrantSpendPreflight(prisma, {
          sokoBotId: botId,
          workspaceId,
          turnId: life2Turn.id,
          toolCallId: "life2-img-1",
          operationKey: null,
          capability: "generate_image",
          projectId: projectA,
          images: 1,
          videos: 0,
          credits: 4,
          grants: life2Allowance!.grants!,
        }),
      ).rejects.toThrow("The owner asked for 1 image in this plan");
    });

    it("propagates live OwnerAuthority revocation on schedule pause/delete and cancelled root turns without breaking spent one-time schedules", async () => {
      const { failedRetryInput, loadAdminScheduleRun, scheduleRetryInput } =
        await import("./soko-bot-admin-retry.service");
      const bot = await prisma.sokoBot.findUniqueOrThrow({
        where: { id: botId },
      });
      const projectA = randomUUID();
      const makeTurn = (
        source: "CHAT" | "SCHEDULE" | "EVENT" | "ADMIN_RETRY",
        clientTurnId: string,
        overrides?: {
          parentTurnId?: string | null;
          status?: "COMPLETED" | "FAILED" | "CANCELLED" | "RUNNING";
          capabilityNames?: string[];
        },
      ) =>
        prisma.sokoBotTurn.create({
          data: {
            sokoBotId: botId,
            workspaceId,
            requestedByUserId: userId,
            askedByUserId: source === "CHAT" ? userId : null,
            source,
            clientTurnId,
            parentTurnId: overrides?.parentTurnId ?? null,
            userMessage: "Run scheduled follow-up",
            versionId: "v36",
            status: overrides?.status ?? "COMPLETED",
            deadlineAt: new Date(Date.now() + HOUR),
            capabilityNames: overrides?.capabilityNames ?? [
              "list_social_posts",
              "create_social_post",
              "schedule_social_post",
              "generate_image",
              "create_task",
            ],
          },
        });
      const asAuthorized = (row: {
        id: string;
        source: string | null;
        clientTurnId: string;
      }) =>
        ({
          askedByKind: "OWNER",
          reader: { sharedScope: null },
          turn: {
            id: row.id,
            sokoBotId: botId,
            workspaceId,
            versionId: "v36",
            source: row.source,
            clientTurnId: row.clientTurnId,
            actingUserId: userId,
            chainDepth: 0,
          },
        }) as unknown as Parameters<typeof mayMakeMediaForOwner>[1];
      const mediaRuntime = {
        mayActForOwner: async (auth: { turn: { source: string | null } }) =>
          auth.turn.source === "CHAT",
      };

      // 1. Recurring schedule creates child watch + child delegation carrying scheduleId.
      const schedRootTurn = await makeTurn(
        "CHAT",
        `chat-sched-root:${randomUUID()}`,
      );
      const schedId = randomUUID();
      const schedGrantId = `sched-rev-${randomUUID()}`;
      await prisma.sokoBotSchedule.create({
        data: {
          id: schedId,
          sokoBotId: botId,
          workspaceId,
          requestedByUserId: userId,
          name: "Weekly launch post",
          cronExpression: "0 9 * * 1",
          timezone: "UTC",
          prompt: "Generate 1 image and schedule a post.",
          nextRunAt: new Date(Date.now() + HOUR),
          runOnce: false,
          enabled: true,
          capabilityNames: [
            "list_social_posts",
            "create_social_post",
            "schedule_social_post",
            "generate_image",
          ],
          authority: {
            version: 1,
            grantId: schedGrantId,
            origin: "owner_chat",
            sokoBotId: botId,
            workspaceId,
            ownerUserId: userId,
            rootTurnId: schedRootTurn.id,
            targetScope: { kind: "project", projectId: projectA },
            scheduleId: schedId,
            scope: "owner_writes",
            socialMode: "schedule_posts",
            limits: {
              grantId: schedGrantId,
              period: "per_occurrence",
              images: 1,
              maxMediaCredits: 10,
            },
            stopRule: { mode: "never" },
          },
        },
      });
      const slot = new Date("2026-12-01T09:00:00.000Z");
      const schedTurn = await makeTurn(
        "SCHEDULE",
        `schedule:${schedId}:${slot.toISOString()}`,
        { status: "FAILED" },
      );
      const schedRun = await prisma.sokoBotScheduleRun.create({
        data: {
          scheduleId: schedId,
          scheduledFor: slot,
          status: "FAILED",
          turnId: schedTurn.id,
        },
      });
      const schedRetryTurn = await makeTurn(
        "ADMIN_RETRY",
        `admin-schedule-retry:${schedRun.id}:op1`,
      );
      const childWatchAuthority = await deriveWatchAuthority(
        {
          id: schedTurn.id,
          sokoBotId: botId,
          workspaceId,
          versionId: "v36",
          source: "SCHEDULE",
          parentTurnId: null,
          askedByUserId: null,
          requestedByUserId: userId,
          actingUserId: userId,
          chainDepth: 0,
        },
        { kind: "studio_job", projectId: projectA },
      );
      expect(childWatchAuthority.scheduleId).toBe(schedId);
      const childWatch = await prisma.sokoBotWatch.create({
        data: {
          sokoBotId: botId,
          turnId: schedTurn.id,
          kind: "studio_job",
          targetId: randomUUID(),
          projectId: projectA,
          then: "Post the generated image",
          status: "FIRED",
          expiresAt: new Date(Date.now() + HOUR),
          authority: childWatchAuthority,
        },
      });
      const childWatchWake = await makeTurn(
        "SCHEDULE",
        `watch:${childWatch.id}`,
        { parentTurnId: schedTurn.id, status: "FAILED" },
      );

      const childDelegationAuthority = await deriveDelegationAuthority(
        {
          id: schedTurn.id,
          sokoBotId: botId,
          workspaceId,
          versionId: "v36",
          source: "SCHEDULE",
          parentTurnId: null,
          askedByUserId: null,
          requestedByUserId: userId,
          actingUserId: userId,
          chainDepth: 0,
        },
        { followUpAllows: { images: 1, maxCredits: 10 }, projectId: projectA },
      );
      expect(childDelegationAuthority.scheduleId).toBe(schedId);
      const childEventWake = await makeTurn(
        "EVENT",
        `event:sched-child:${randomUUID()}`,
      );
      const delegatedTask = await prisma.task.create({
        data: {
          workspaceId,
          ownerId: userId,
          name: "Scheduled child task",
          status: "COMPLETED",
        },
      });
      await prisma.sokoBotDelegation.create({
        data: {
          turnId: schedTurn.id,
          toolCallId: `tool-sched-del-${randomUUID()}`,
          action: "create_task",
          kind: "TASK",
          taskId: delegatedTask.id,
          followUp: "Make an image from the completed task",
          followUpAllows: { images: 1, maxCredits: 10 },
          followUpTurnId: childEventWake.id,
          authority: childDelegationAuthority,
        },
      });

      // While enabled: schedule run, admin retry, child watch, and child delegation succeed.
      const enabledSchedOrigin = await resolveSocialWriteOrigin(schedTurn);
      expect(
        evaluateSocialWriteAuthority({
          turn: {
            id: schedTurn.id,
            sokoBotId: botId,
            workspaceId,
            versionId: "v36",
            source: enabledSchedOrigin.source,
            actingUserId: userId,
            askedByKind: "OWNER",
            sharedBot: false,
          },
          capability: "create_social_post",
          rawInput: {
            projectId: projectA,
            text: "Enabled run",
            scheduledAt: "2026-12-02T10:00:00Z",
          },
          tainted: false,
          scheduleAuthority: enabledSchedOrigin.scheduleAuthority,
        }).allowed,
      ).toBe(true);
      const enabledWatchOrigin = await resolveSocialWriteOrigin(childWatchWake);
      expect(
        evaluateSocialWriteAuthority({
          turn: {
            id: childWatchWake.id,
            sokoBotId: botId,
            workspaceId,
            versionId: "v36",
            source: enabledWatchOrigin.source,
            actingUserId: userId,
            askedByKind: "OWNER",
            sharedBot: false,
          },
          capability: "create_social_post",
          rawInput: { projectId: projectA, text: "Enabled watch" },
          tainted: false,
          watchAuthority: enabledWatchOrigin.watchAuthority,
        }).allowed,
      ).toBe(true);
      expect(
        (
          await mayMakeMediaForOwner(
            mediaRuntime,
            asAuthorized(childWatchWake),
            {
              projectId: projectA,
              capability: "generate_image",
            },
          )
        )?.images,
      ).toBe(1);
      expect(
        (
          await mayMakeMediaForOwner(
            mediaRuntime,
            asAuthorized(childEventWake),
            {
              projectId: projectA,
              capability: "generate_image",
            },
          )
        )?.images,
      ).toBe(1);

      // 2. Pause schedule (`enabled: false`) -> immediately revokes schedule run,
      //    retries, child watch, child delegation, and parent derivation without
      //    mutating child rows.
      await prisma.sokoBotSchedule.update({
        where: { id: schedId },
        data: { enabled: false },
      });
      for (const turnRow of [schedTurn, schedRetryTurn]) {
        const origin = await resolveSocialWriteOrigin(turnRow);
        expect(
          evaluateSocialWriteAuthority({
            turn: {
              id: turnRow.id,
              sokoBotId: botId,
              workspaceId,
              versionId: "v36",
              source: origin.source,
              actingUserId: userId,
              askedByKind: "OWNER",
              sharedBot: false,
            },
            capability: "create_social_post",
            rawInput: { projectId: projectA, text: "Paused run" },
            tainted: false,
            scheduleAuthority: origin.scheduleAuthority,
          }),
        ).toEqual({
          allowed: false,
          kind: "schedule_authority",
          detail: SCHEDULE_AUTHORITY_REVOKED_MESSAGE,
        });
        await expect(
          mayMakeMediaForOwner(mediaRuntime, asAuthorized(turnRow), {
            projectId: projectA,
            capability: "generate_image",
          }),
        ).rejects.toThrow(/was revoked/);
      }
      const pausedWatchOrigin = await resolveSocialWriteOrigin(childWatchWake);
      expect(
        evaluateSocialWriteAuthority({
          turn: {
            id: childWatchWake.id,
            sokoBotId: botId,
            workspaceId,
            versionId: "v36",
            source: pausedWatchOrigin.source,
            actingUserId: userId,
            askedByKind: "OWNER",
            sharedBot: false,
          },
          capability: "create_social_post",
          rawInput: { projectId: projectA, text: "Paused watch" },
          tainted: false,
          watchAuthority: pausedWatchOrigin.watchAuthority,
        }),
      ).toEqual({
        allowed: false,
        kind: "watch_authority",
        detail: WATCH_AUTHORITY_REVOKED_MESSAGE,
      });
      await expect(
        mayMakeMediaForOwner(mediaRuntime, asAuthorized(childWatchWake), {
          projectId: projectA,
          capability: "generate_image",
        }),
      ).rejects.toThrow(/was revoked/);
      await expect(
        mayMakeMediaForOwner(mediaRuntime, asAuthorized(childEventWake), {
          projectId: projectA,
          capability: "generate_image",
        }),
      ).rejects.toThrow(/was revoked/);

      // Admin retry builders strip write tools on both paused schedule and child watch.
      const loadedRun = await loadAdminScheduleRun(botId, schedRun.id);
      const pausedSchedRetryRoute = (
        await scheduleRetryInput(bot, loadedRun!, null)
      ).presetRoute;
      expect(pausedSchedRetryRoute?.capabilities).toEqual([
        "list_social_posts",
      ]);
      expect(
        pausedSchedRetryRoute && "sandbox" in pausedSchedRetryRoute
          ? pausedSchedRetryRoute.sandbox
          : false,
      ).toBe(false);
      const pausedWatchRetryRoute = (
        await failedRetryInput(
          bot,
          childWatchWake,
          `admin-retry:${childWatchWake.id}:op1`,
        )
      ).presetRoute;
      expect(pausedWatchRetryRoute?.capabilities).toEqual([
        "list_social_posts",
      ]);
      expect(pausedWatchRetryRoute?.sandbox).toBe(false);

      // Chained child work from paused schedule or watch degrades to system read_only.
      expect(
        (
          await resolveWorkItemParentAuthority({
            id: schedTurn.id,
            sokoBotId: botId,
            workspaceId,
            versionId: "v36",
            source: "SCHEDULE",
            parentTurnId: null,
            askedByUserId: null,
            requestedByUserId: userId,
            actingUserId: userId,
            chainDepth: 0,
          })
        ).origin,
      ).toBe("system");
      expect(
        (
          await resolveWorkItemParentAuthority({
            id: childWatchWake.id,
            sokoBotId: botId,
            workspaceId,
            versionId: "v36",
            source: "SCHEDULE",
            clientTurnId: childWatchWake.clientTurnId,
            parentTurnId: schedTurn.id,
            askedByUserId: userId,
            requestedByUserId: userId,
            actingUserId: userId,
            chainDepth: 0,
          })
        ).origin,
      ).toBe("system");

      // 3. Delete schedule row -> child watch & child delegation remain revoked.
      await prisma.sokoBotSchedule.delete({ where: { id: schedId } });
      await expect(
        mayMakeMediaForOwner(mediaRuntime, asAuthorized(childWatchWake), {
          projectId: projectA,
          capability: "generate_image",
        }),
      ).rejects.toThrow(/was revoked/);
      await expect(
        mayMakeMediaForOwner(mediaRuntime, asAuthorized(childEventWake), {
          projectId: projectA,
          capability: "generate_image",
        }),
      ).rejects.toThrow(/was revoked/);

      // 4. Spent one-time schedule (`runOnce: true, enabled: false, lastRunAt != null`)
      //    stays authorized until its root CHAT turn is CANCELLED.
      const onceRoot = await makeTurn("CHAT", `chat-once-root:${randomUUID()}`);
      const onceSchedId = randomUUID();
      const onceGrantId = `once-grant-${randomUUID()}`;
      await prisma.sokoBotSchedule.create({
        data: {
          id: onceSchedId,
          sokoBotId: botId,
          workspaceId,
          requestedByUserId: userId,
          name: "One-time launch",
          cronExpression: "0 9 1 12 *",
          timezone: "UTC",
          prompt: "Generate 1 launch image.",
          nextRunAt: slot,
          lastRunAt: slot,
          runOnce: true,
          enabled: false,
          capabilityNames: ["list_social_posts", "generate_image"],
          authority: {
            version: 1,
            grantId: onceGrantId,
            origin: "owner_chat",
            sokoBotId: botId,
            workspaceId,
            ownerUserId: userId,
            rootTurnId: onceRoot.id,
            targetScope: { kind: "project", projectId: projectA },
            scheduleId: onceSchedId,
            scope: "owner_writes",
            socialMode: "schedule_posts",
            limits: {
              grantId: onceGrantId,
              period: "per_occurrence",
              images: 1,
              maxMediaCredits: 10,
            },
            stopRule: { mode: "never" },
          },
        },
      });
      const onceTurn = await makeTurn(
        "SCHEDULE",
        `schedule:${onceSchedId}:${slot.toISOString()}`,
      );
      const onceRun = await prisma.sokoBotScheduleRun.create({
        data: {
          scheduleId: onceSchedId,
          scheduledFor: slot,
          status: "RUNNING",
          turnId: onceTurn.id,
        },
      });
      expect(
        (
          await mayMakeMediaForOwner(mediaRuntime, asAuthorized(onceTurn), {
            projectId: projectA,
            capability: "generate_image",
          })
        )?.images,
      ).toBe(1);
      const loadedOnceRun = await loadAdminScheduleRun(botId, onceRun.id);
      expect(
        (await scheduleRetryInput(bot, loadedOnceRun!, null)).presetRoute
          ?.capabilities,
      ).toEqual(["list_social_posts", "generate_image"]);

      // Cancelling the one-time schedule's root CHAT turn revokes it immediately.
      await prisma.sokoBotTurn.update({
        where: { id: onceRoot.id },
        data: { status: "CANCELLED" },
      });
      await expect(
        mayMakeMediaForOwner(mediaRuntime, asAuthorized(onceTurn), {
          projectId: projectA,
          capability: "generate_image",
        }),
      ).rejects.toThrow(/was revoked/);
      expect(
        (await scheduleRetryInput(bot, loadedOnceRun!, null)).presetRoute
          ?.capabilities,
      ).toEqual(["list_social_posts"]);

      // 5. Cancelling a direct CHAT root turn revokes its child watch, delegation,
      //    and background run while a sibling COMPLETED root stays authorized.
      const cancelledRoot = await makeTurn(
        "CHAT",
        `chat-cancel-root:${randomUUID()}`,
        { status: "CANCELLED" },
      );
      const liveRoot = await makeTurn(
        "CHAT",
        `chat-live-root:${randomUUID()}`,
        {
          status: "COMPLETED",
        },
      );
      const cancelledBg = await makeTurn("CHAT", `bg-cancel:${randomUUID()}`, {
        parentTurnId: cancelledRoot.id,
      });
      const liveBg = await makeTurn("CHAT", `bg-live:${randomUUID()}`, {
        parentTurnId: liveRoot.id,
      });
      expect(
        (
          await resolveWorkItemParentAuthority({
            id: cancelledBg.id,
            sokoBotId: botId,
            workspaceId,
            versionId: "v36",
            source: "CHAT",
            parentTurnId: cancelledRoot.id,
            askedByUserId: userId,
            requestedByUserId: userId,
            actingUserId: userId,
            chainDepth: 0,
          })
        ).origin,
      ).toBe("system");
      expect(
        (
          await resolveWorkItemParentAuthority({
            id: liveBg.id,
            sokoBotId: botId,
            workspaceId,
            versionId: "v36",
            source: "CHAT",
            parentTurnId: liveRoot.id,
            askedByUserId: userId,
            requestedByUserId: userId,
            actingUserId: userId,
            chainDepth: 0,
          })
        ).origin,
      ).toBe("owner_chat");
    });

    it("keeps a settled one-time schedule alive through 7-day retention cleanup while its delegated follow-up is outstanding, then purges once settled and still revokes on explicit owner cancellation", async () => {
      const projectA = randomUUID();
      const mediaRuntime = {
        mayActForOwner: async () => false,
      };
      const asAuthorized = (row: {
        id: string;
        source: string | null;
        clientTurnId: string;
      }) =>
        ({
          askedByKind: "OWNER",
          reader: { sharedScope: null },
          turn: {
            id: row.id,
            sokoBotId: botId,
            workspaceId,
            versionId: "v36",
            source: row.source,
            clientTurnId: row.clientTurnId,
            actingUserId: userId,
            chainDepth: 0,
          },
        }) as unknown as Parameters<typeof mayMakeMediaForOwner>[1];

      const createSpentOneTimeWithDelegation = async (name: string) => {
        const rootChat = await prisma.sokoBotTurn.create({
          data: {
            sokoBotId: botId,
            workspaceId,
            requestedByUserId: userId,
            askedByUserId: userId,
            source: "CHAT",
            status: "COMPLETED",
            clientTurnId: `chat-ret-root:${randomUUID()}`,
            userMessage: "Delegate a task and make one image when it returns.",
            versionId: "v36",
            deadlineAt: new Date(Date.now() + HOUR),
            capabilityNames: ["create_task", "generate_image"],
          },
        });
        const schedId = randomUUID();
        const grantId = `ret-grant-${randomUUID()}`;
        const slot = new Date(Date.now() - 2 * HOUR);
        await prisma.sokoBotSchedule.create({
          data: {
            id: schedId,
            sokoBotId: botId,
            workspaceId,
            requestedByUserId: userId,
            name,
            cronExpression: "0 9 1 12 *",
            timezone: "UTC",
            prompt: "Delegate and make 1 image.",
            nextRunAt: slot,
            lastRunAt: slot,
            runOnce: true,
            enabled: false,
            capabilityNames: ["create_task", "generate_image"],
            authority: {
              version: 1,
              grantId,
              origin: "owner_chat",
              sokoBotId: botId,
              workspaceId,
              ownerUserId: userId,
              rootTurnId: rootChat.id,
              targetScope: { kind: "project", projectId: projectA },
              scheduleId: schedId,
              scope: "owner_writes",
              socialMode: "draft_only",
              limits: {
                grantId,
                period: "per_occurrence",
                images: 1,
                maxMediaCredits: 10,
              },
              stopRule: { mode: "never" },
            },
          },
        });
        const schedTurn = await prisma.sokoBotTurn.create({
          data: {
            sokoBotId: botId,
            workspaceId,
            requestedByUserId: userId,
            source: "SCHEDULE",
            status: "COMPLETED",
            clientTurnId: `schedule:${schedId}:${slot.toISOString()}`,
            userMessage: "Delegate and make 1 image.",
            versionId: "v36",
            deadlineAt: new Date(Date.now() + HOUR),
            capabilityNames: ["create_task", "generate_image"],
          },
        });
        await prisma.sokoBotScheduleRun.create({
          data: {
            scheduleId: schedId,
            scheduledFor: slot,
            status: "COMPLETED",
            completedAt: slot,
            turnId: schedTurn.id,
          },
        });
        const delegationAuthority = await deriveDelegationAuthority(
          {
            id: schedTurn.id,
            sokoBotId: botId,
            workspaceId,
            versionId: "v36",
            source: "SCHEDULE",
            parentTurnId: null,
            askedByUserId: null,
            requestedByUserId: userId,
            actingUserId: userId,
            chainDepth: 0,
          },
          {
            followUpAllows: { images: 1, maxCredits: 10 },
            projectId: projectA,
          },
        );
        expect(delegationAuthority.scheduleId).toBe(schedId);
        const task = await prisma.task.create({
          data: {
            workspaceId,
            ownerId: userId,
            name: `Pending task for ${name}`,
            status: "READY",
          },
        });
        const delegation = await prisma.sokoBotDelegation.create({
          data: {
            turnId: schedTurn.id,
            toolCallId: `tool-ret-${randomUUID()}`,
            action: "create_task",
            kind: "TASK",
            taskId: task.id,
            followUp: "Make 1 image once the Coworker returns.",
            followUpAllows: { images: 1, maxCredits: 10 },
            authority: delegationAuthority,
          },
        });
        return { rootChat, schedId, schedTurn, task, delegation };
      };

      const afterRetention = new Date(
        Date.now() + SOKO_BOT_SCHEDULE_RETENTION_MS + HOUR,
      );

      // 1. Inside retention window: Task completes -> follow-up retains 1-image allowance.
      const inside = await createSpentOneTimeWithDelegation("Inside retention");
      await prisma.task.update({
        where: { id: inside.task.id },
        data: { status: "COMPLETED" },
      });
      const insideWake = await prisma.sokoBotTurn.create({
        data: {
          sokoBotId: botId,
          workspaceId,
          requestedByUserId: userId,
          source: "EVENT",
          status: "RUNNING",
          clientTurnId: `event:inside:${randomUUID()}`,
          userMessage: "Follow up on completed task.",
          versionId: "v36",
          deadlineAt: new Date(Date.now() + HOUR),
          capabilityNames: ["generate_image"],
        },
      });
      await prisma.sokoBotDelegation.update({
        where: { id: inside.delegation.id },
        data: { followUpTurnId: insideWake.id },
      });
      expect(
        (
          await mayMakeMediaForOwner(mediaRuntime, asAuthorized(insideWake), {
            projectId: projectA,
            capability: "generate_image",
          })
        )?.images,
      ).toBe(1);
      await prisma.sokoBotTurn.update({
        where: { id: insideWake.id },
        data: { status: "COMPLETED" },
      });

      // 2. Past 7-day retention window: cleanup runs while Task is STILL pending.
      //    Schedule row MUST survive routine retention (even after settled run rows purge),
      //    Task completion retains its 1-image allowance, in-flight wake keeps it alive,
      //    and once the wake settles COMPLETED, cleanup removes the spent schedule.
      const past = await createSpentOneTimeWithDelegation("Past retention");
      const firstPurge = await purgeSokoBotSchedules(afterRetention);
      expect(firstPurge.settledRuns).toBeGreaterThanOrEqual(1);
      expect(
        await prisma.sokoBotSchedule.findUnique({
          where: { id: past.schedId },
        }),
      ).not.toBeNull();
      // Settled `inside` schedule had a COMPLETED wake, so routine cleanup removes it.
      expect(
        await prisma.sokoBotSchedule.findUnique({
          where: { id: inside.schedId },
        }),
      ).toBeNull();

      // Task finishes after day 7 -> wake still gets its 1-image allowance!
      await prisma.task.update({
        where: { id: past.task.id },
        data: { status: "COMPLETED" },
      });
      const pastWake = await prisma.sokoBotTurn.create({
        data: {
          sokoBotId: botId,
          workspaceId,
          requestedByUserId: userId,
          source: "EVENT",
          status: "RUNNING",
          clientTurnId: `event:past:${randomUUID()}`,
          userMessage: "Follow up past 7-day retention.",
          versionId: "v36",
          deadlineAt: new Date(Date.now() + HOUR),
          capabilityNames: ["generate_image"],
        },
      });
      await prisma.sokoBotDelegation.update({
        where: { id: past.delegation.id },
        data: { followUpTurnId: pastWake.id },
      });
      expect(
        (
          await mayMakeMediaForOwner(mediaRuntime, asAuthorized(pastWake), {
            projectId: projectA,
            capability: "generate_image",
          })
        )?.images,
      ).toBe(1);

      // Routine cleanup while follow-up wake is RUNNING still keeps the schedule alive.
      await purgeSokoBotSchedules(afterRetention);
      expect(
        await prisma.sokoBotSchedule.findUnique({
          where: { id: past.schedId },
        }),
      ).not.toBeNull();

      // Once follow-up wake completes, routine cleanup removes the spent schedule.
      await prisma.sokoBotTurn.update({
        where: { id: pastWake.id },
        data: { status: "COMPLETED" },
      });
      const finalPurge = await purgeSokoBotSchedules(afterRetention);
      expect(finalPurge.spentOneTime).toBe(1);
      expect(
        await prisma.sokoBotSchedule.findUnique({
          where: { id: past.schedId },
        }),
      ).toBeNull();

      // 3. Explicit owner deletion AND explicit root-turn cancellation still revoke immediately.
      const deletedByOwner = await createSpentOneTimeWithDelegation(
        "Explicitly deleted by owner",
      );
      await deleteSokoBotSchedule(userId, {
        workspaceId,
        sokoBotId: botId,
        scheduleId: deletedByOwner.schedId,
      });
      const deletedWake = await prisma.sokoBotTurn.create({
        data: {
          sokoBotId: botId,
          workspaceId,
          requestedByUserId: userId,
          source: "EVENT",
          status: "RUNNING",
          clientTurnId: `event:deleted:${randomUUID()}`,
          userMessage: "Follow up after owner deleted schedule.",
          versionId: "v36",
          deadlineAt: new Date(Date.now() + HOUR),
          capabilityNames: ["generate_image"],
        },
      });
      await prisma.sokoBotDelegation.update({
        where: { id: deletedByOwner.delegation.id },
        data: { followUpTurnId: deletedWake.id },
      });
      await expect(
        mayMakeMediaForOwner(mediaRuntime, asAuthorized(deletedWake), {
          projectId: projectA,
          capability: "generate_image",
        }),
      ).rejects.toThrow(/was revoked/);

      const cancelledByOwner = await createSpentOneTimeWithDelegation(
        "Explicitly cancelled root",
      );
      await prisma.sokoBotTurn.update({
        where: { id: cancelledByOwner.rootChat.id },
        data: { status: "CANCELLED" },
      });
      const cancelledWake = await prisma.sokoBotTurn.create({
        data: {
          sokoBotId: botId,
          workspaceId,
          requestedByUserId: userId,
          source: "EVENT",
          status: "RUNNING",
          clientTurnId: `event:cancelled:${randomUUID()}`,
          userMessage: "Follow up after owner cancelled root turn.",
          versionId: "v36",
          deadlineAt: new Date(Date.now() + HOUR),
          capabilityNames: ["generate_image"],
        },
      });
      await prisma.sokoBotDelegation.update({
        where: { id: cancelledByOwner.delegation.id },
        data: { followUpTurnId: cancelledWake.id },
      });
      await expect(
        mayMakeMediaForOwner(mediaRuntime, asAuthorized(cancelledWake), {
          projectId: projectA,
          capability: "generate_image",
        }),
      ).rejects.toThrow(/was revoked/);

      // 4. Schedule watching Task A that also delegated Task B: when Task A
      //    completes, routine cleanup retires the schedule so it never fires
      //    again while keeping Task B's follow-up authorized, then deletes it
      //    once Task B settles; an owner-paused watcher stays revoked.
      const watchRoot = await prisma.sokoBotTurn.create({
        data: {
          sokoBotId: botId,
          workspaceId,
          requestedByUserId: userId,
          askedByUserId: userId,
          source: "CHAT",
          status: "COMPLETED",
          clientTurnId: `chat-watched-root:${randomUUID()}`,
          userMessage: "Watch Task A and delegate Task B with 1 image.",
          versionId: "v36",
          deadlineAt: new Date(Date.now() + HOUR),
          capabilityNames: ["create_task", "generate_image"],
        },
      });
      const taskA = await prisma.task.create({
        data: {
          workspaceId,
          ownerId: userId,
          name: "Watched Task A",
          status: "READY",
        },
      });
      const taskB = await prisma.task.create({
        data: {
          workspaceId,
          ownerId: userId,
          name: "Delegated Task B",
          status: "READY",
        },
      });
      const watchedSchedId = randomUUID();
      const watchedGrantId = `watched-grant-${randomUUID()}`;
      const pastDue = new Date(Date.now() - HOUR);
      await prisma.sokoBotSchedule.create({
        data: {
          id: watchedSchedId,
          sokoBotId: botId,
          workspaceId,
          requestedByUserId: userId,
          name: "Watch Task A",
          cronExpression: "0 * * * *",
          timezone: "UTC",
          prompt: "Check Task A and coordinate Task B.",
          nextRunAt: pastDue,
          lastRunAt: pastDue,
          runOnce: false,
          enabled: true,
          taskId: taskA.id,
          capabilityNames: ["create_task", "generate_image"],
          authority: {
            version: 1,
            grantId: watchedGrantId,
            origin: "owner_chat",
            sokoBotId: botId,
            workspaceId,
            ownerUserId: userId,
            rootTurnId: watchRoot.id,
            targetScope: { kind: "project", projectId: projectA },
            scheduleId: watchedSchedId,
            scope: "owner_writes",
            socialMode: "draft_only",
            limits: {
              grantId: watchedGrantId,
              period: "per_occurrence",
              images: 1,
              maxMediaCredits: 10,
            },
            stopRule: { mode: "never" },
          },
        },
      });
      const watchedSchedTurn = await prisma.sokoBotTurn.create({
        data: {
          sokoBotId: botId,
          workspaceId,
          requestedByUserId: userId,
          source: "SCHEDULE",
          status: "COMPLETED",
          clientTurnId: `schedule:${watchedSchedId}:${pastDue.toISOString()}`,
          userMessage: "Check Task A and coordinate Task B.",
          versionId: "v36",
          deadlineAt: new Date(Date.now() + HOUR),
          capabilityNames: ["create_task", "generate_image"],
        },
      });
      await prisma.sokoBotScheduleRun.create({
        data: {
          scheduleId: watchedSchedId,
          scheduledFor: pastDue,
          status: "COMPLETED",
          completedAt: pastDue,
          turnId: watchedSchedTurn.id,
        },
      });
      const taskBAuthority = await deriveDelegationAuthority(
        {
          id: watchedSchedTurn.id,
          sokoBotId: botId,
          workspaceId,
          versionId: "v36",
          source: "SCHEDULE",
          parentTurnId: null,
          askedByUserId: null,
          requestedByUserId: userId,
          actingUserId: userId,
          chainDepth: 0,
        },
        { followUpAllows: { images: 1, maxCredits: 10 }, projectId: projectA },
      );
      const taskBDelegation = await prisma.sokoBotDelegation.create({
        data: {
          turnId: watchedSchedTurn.id,
          toolCallId: `tool-watched-b-${randomUUID()}`,
          action: "create_task",
          kind: "TASK",
          taskId: taskB.id,
          followUp: "Make 1 image once Task B finishes.",
          followUpAllows: { images: 1, maxCredits: 10 },
          authority: taskBAuthority,
        },
      });

      // Task A completes; cleanup retires the schedule (disabled, never fires again)
      // instead of deleting it while Task B is still pending.
      await prisma.task.update({
        where: { id: taskA.id },
        data: { status: "COMPLETED" },
      });
      const watchedPurge = await purgeSokoBotSchedules(
        new Date(Date.now() + 2 * HOUR),
      );
      expect(watchedPurge.watchedWorkFinished).toBe(0);
      const retiredWatcher = await prisma.sokoBotSchedule.findUnique({
        where: { id: watchedSchedId },
      });
      expect(retiredWatcher).not.toBeNull();
      expect(retiredWatcher?.enabled).toBe(false);
      expect(retiredWatcher?.runOnce).toBe(true);
      expect(retiredWatcher?.lastRunAt).not.toBeNull();

      // The retired schedule never fires again even though nextRunAt is past due.
      const syncResult =
        await new SokoBotSchedulesSyncService().syncDueSchedules({
          shouldContinue: () => true,
          scheduleId: watchedSchedId,
        });
      expect(syncResult.claimed).toBe(0);

      // Task B completes within two hours -> follow-up retains its 1-image allowance.
      await prisma.task.update({
        where: { id: taskB.id },
        data: { status: "COMPLETED" },
      });
      const taskBWake = await prisma.sokoBotTurn.create({
        data: {
          sokoBotId: botId,
          workspaceId,
          requestedByUserId: userId,
          source: "EVENT",
          status: "RUNNING",
          clientTurnId: `event:taskb:${randomUUID()}`,
          userMessage: "Follow up on Task B.",
          versionId: "v36",
          deadlineAt: new Date(Date.now() + HOUR),
          capabilityNames: ["generate_image"],
        },
      });
      await prisma.sokoBotDelegation.update({
        where: { id: taskBDelegation.id },
        data: { followUpTurnId: taskBWake.id },
      });
      expect(
        (
          await mayMakeMediaForOwner(mediaRuntime, asAuthorized(taskBWake), {
            projectId: projectA,
            capability: "generate_image",
          })
        )?.images,
      ).toBe(1);

      // Once Task B's follow-up settles COMPLETED, cleanup removes the retired watcher.
      await prisma.sokoBotTurn.update({
        where: { id: taskBWake.id },
        data: { status: "COMPLETED" },
      });
      const watchedCleanup = await purgeSokoBotSchedules(
        new Date(Date.now() + 2 * HOUR),
      );
      expect(watchedCleanup.watchedWorkFinished).toBe(1);
      expect(
        await prisma.sokoBotSchedule.findUnique({
          where: { id: watchedSchedId },
        }),
      ).toBeNull();

      // Control: a watcher explicitly paused by the owner (`enabled: false, runOnce: false`)
      // before Task A completes is NEVER un-revoked by cleanup.
      const taskA2 = await prisma.task.create({
        data: {
          workspaceId,
          ownerId: userId,
          name: "Watched Task A2",
          status: "COMPLETED",
        },
      });
      const taskB2 = await prisma.task.create({
        data: {
          workspaceId,
          ownerId: userId,
          name: "Delegated Task B2",
          status: "READY",
        },
      });
      const pausedWatcherId = randomUUID();
      await prisma.sokoBotSchedule.create({
        data: {
          id: pausedWatcherId,
          sokoBotId: botId,
          workspaceId,
          requestedByUserId: userId,
          name: "Paused Watch Task A2",
          cronExpression: "0 * * * *",
          timezone: "UTC",
          prompt: "Paused watcher.",
          nextRunAt: pastDue,
          lastRunAt: pastDue,
          runOnce: false,
          enabled: false,
          taskId: taskA2.id,
          capabilityNames: ["create_task", "generate_image"],
          authority: {
            version: 1,
            grantId: `paused-watch-${randomUUID()}`,
            origin: "owner_chat",
            sokoBotId: botId,
            workspaceId,
            ownerUserId: userId,
            rootTurnId: watchRoot.id,
            targetScope: { kind: "project", projectId: projectA },
            scheduleId: pausedWatcherId,
            scope: "owner_writes",
            socialMode: "draft_only",
            limits: {
              grantId: `paused-watch-${randomUUID()}`,
              period: "per_occurrence",
              images: 1,
              maxMediaCredits: 10,
            },
            stopRule: { mode: "never" },
          },
        },
      });
      const taskB2Wake = await prisma.sokoBotTurn.create({
        data: {
          sokoBotId: botId,
          workspaceId,
          requestedByUserId: userId,
          source: "EVENT",
          status: "RUNNING",
          clientTurnId: `event:taskb2:${randomUUID()}`,
          userMessage: "Follow up on Task B2 after owner paused watcher.",
          versionId: "v36",
          deadlineAt: new Date(Date.now() + HOUR),
          capabilityNames: ["generate_image"],
        },
      });
      await prisma.sokoBotDelegation.create({
        data: {
          turnId: watchedSchedTurn.id,
          toolCallId: `tool-watched-b2-${randomUUID()}`,
          action: "create_task",
          kind: "TASK",
          taskId: taskB2.id,
          followUp: "Make 1 image once Task B2 finishes.",
          followUpAllows: { images: 1, maxCredits: 10 },
          followUpTurnId: taskB2Wake.id,
          authority: {
            ...taskBAuthority,
            scheduleId: pausedWatcherId,
          },
        },
      });
      await purgeSokoBotSchedules(new Date(Date.now() + 2 * HOUR));
      await expect(
        mayMakeMediaForOwner(mediaRuntime, asAuthorized(taskB2Wake), {
          projectId: projectA,
          capability: "generate_image",
        }),
      ).rejects.toThrow(/was revoked/);

      // 5. Concurrency barrier race: an active run commits its child delegation
      //    and settles COMPLETED *after* cleanup's preliminary child scan has
      //    already returned empty. Atomic DELETE + UPDATE must spare and retire
      //    the schedule rather than deleting it using stale scan state.
      for (const mode of ["watched_work", "spent_one_time"] as const) {
        const raceWatchedTask =
          mode === "watched_work"
            ? await prisma.task.create({
                data: {
                  workspaceId,
                  ownerId: userId,
                  name: "Race watched Task A",
                  status: "COMPLETED",
                },
              })
            : null;
        const raceChildTask = await prisma.task.create({
          data: {
            workspaceId,
            ownerId: userId,
            name: `Race delegated Task B (${mode})`,
            status: "READY",
          },
        });
        const raceSchedId = randomUUID();
        const raceGrantId = `race-grant-${randomUUID()}`;
        await prisma.sokoBotSchedule.create({
          data: {
            id: raceSchedId,
            sokoBotId: botId,
            workspaceId,
            requestedByUserId: userId,
            name: `Race schedule (${mode})`,
            cronExpression: "0 * * * *",
            timezone: "UTC",
            prompt: "Delegate child while cleanup runs.",
            nextRunAt: pastDue,
            lastRunAt: pastDue,
            runOnce: mode === "spent_one_time",
            enabled: mode === "watched_work",
            ...(raceWatchedTask ? { taskId: raceWatchedTask.id } : {}),
            capabilityNames: ["create_task", "generate_image"],
            authority: {
              version: 1,
              grantId: raceGrantId,
              origin: "owner_chat",
              sokoBotId: botId,
              workspaceId,
              ownerUserId: userId,
              rootTurnId: watchRoot.id,
              targetScope: { kind: "project", projectId: projectA },
              scheduleId: raceSchedId,
              scope: "owner_writes",
              socialMode: "draft_only",
              limits: {
                grantId: raceGrantId,
                period: "per_occurrence",
                images: 1,
                maxMediaCredits: 10,
              },
              stopRule: { mode: "never" },
            },
          },
        });
        const raceSchedTurn = await prisma.sokoBotTurn.create({
          data: {
            sokoBotId: botId,
            workspaceId,
            requestedByUserId: userId,
            source: "SCHEDULE",
            status: "RUNNING",
            clientTurnId: `schedule:${raceSchedId}:${pastDue.toISOString()}`,
            userMessage: "Delegate child while cleanup runs.",
            versionId: "v36",
            deadlineAt: new Date(Date.now() + HOUR),
            capabilityNames: ["create_task", "generate_image"],
          },
        });
        const raceRun = await prisma.sokoBotScheduleRun.create({
          data: {
            scheduleId: raceSchedId,
            scheduledFor: pastDue,
            status: "RUNNING",
            turnId: raceSchedTurn.id,
          },
        });

        let createdRaceDelegationId: string | null = null;
        const origQueryRaw = prisma.$queryRaw.bind(prisma);
        const barrierSpy = vi
          .spyOn(prisma, "$queryRaw")
          .mockImplementationOnce((async (...args: unknown[]) => {
            const rows = await (
              origQueryRaw as (...a: unknown[]) => Promise<unknown>
            )(...args);
            // Preliminary scan finished BEFORE child exists; now the active run
            // commits its child delegation and settles COMPLETED.
            const childAuth = await deriveDelegationAuthority(
              {
                id: raceSchedTurn.id,
                sokoBotId: botId,
                workspaceId,
                versionId: "v36",
                source: "SCHEDULE",
                parentTurnId: null,
                askedByUserId: null,
                requestedByUserId: userId,
                actingUserId: userId,
                chainDepth: 0,
              },
              {
                followUpAllows: { images: 1, maxCredits: 10 },
                projectId: projectA,
              },
            );
            const created = await prisma.sokoBotDelegation.create({
              data: {
                turnId: raceSchedTurn.id,
                toolCallId: `tool-race-${randomUUID()}`,
                action: "create_task",
                kind: "TASK",
                taskId: raceChildTask.id,
                followUp: "Make 1 image after race child finishes.",
                followUpAllows: { images: 1, maxCredits: 10 },
                authority: childAuth,
              },
            });
            createdRaceDelegationId = created.id;
            await prisma.sokoBotScheduleRun.update({
              where: { id: raceRun.id },
              data: { status: "COMPLETED", completedAt: new Date() },
            });
            await prisma.sokoBotTurn.update({
              where: { id: raceSchedTurn.id },
              data: { status: "COMPLETED" },
            });
            return rows;
          }) as typeof prisma.$queryRaw);

        try {
          const purgeClock =
            mode === "spent_one_time"
              ? afterRetention
              : new Date(Date.now() + 2 * HOUR);
          const racePurge = await purgeSokoBotSchedules(purgeClock);
          if (mode === "spent_one_time") {
            expect(racePurge.spentOneTime).toBe(0);
          } else {
            expect(racePurge.watchedWorkFinished).toBe(0);
          }
        } finally {
          barrierSpy.mockRestore();
        }

        // Schedule survived the barrier race (and watched_work was retired so it never fires again).
        const survived = await prisma.sokoBotSchedule.findUnique({
          where: { id: raceSchedId },
        });
        expect(survived).not.toBeNull();
        expect(survived?.enabled).toBe(false);
        expect(survived?.runOnce).toBe(true);
        expect(survived?.lastRunAt).not.toBeNull();

        // Child completes -> follow-up retains its 1-image allowance!
        await prisma.task.update({
          where: { id: raceChildTask.id },
          data: { status: "COMPLETED" },
        });
        const raceWake = await prisma.sokoBotTurn.create({
          data: {
            sokoBotId: botId,
            workspaceId,
            requestedByUserId: userId,
            source: "EVENT",
            status: "RUNNING",
            clientTurnId: `event:race:${randomUUID()}`,
            userMessage: "Follow up after barrier race.",
            versionId: "v36",
            deadlineAt: new Date(Date.now() + HOUR),
            capabilityNames: ["generate_image"],
          },
        });
        await prisma.sokoBotDelegation.update({
          where: { id: createdRaceDelegationId! },
          data: { followUpTurnId: raceWake.id },
        });
        expect(
          (
            await mayMakeMediaForOwner(mediaRuntime, asAuthorized(raceWake), {
              projectId: projectA,
              capability: "generate_image",
            })
          )?.images,
        ).toBe(1);

        // Once the follow-up settles COMPLETED, the next cleanup removes the schedule.
        await prisma.sokoBotTurn.update({
          where: { id: raceWake.id },
          data: { status: "COMPLETED" },
        });
        const settledClock =
          mode === "spent_one_time"
            ? afterRetention
            : new Date(Date.now() + 2 * HOUR);
        await purgeSokoBotSchedules(settledClock);
        expect(
          await prisma.sokoBotSchedule.findUnique({
            where: { id: raceSchedId },
          }),
        ).toBeNull();
      }
    });
  });
});
