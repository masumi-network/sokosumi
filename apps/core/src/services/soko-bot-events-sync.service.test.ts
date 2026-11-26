import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  metadataUpsertMock,
  metadataUpdateMock,
  taskEventFindManyMock,
  inboxFindManyMock,
  delegationFindManyMock,
  delegationUpdateMock,
  getEnvMock,
  proactiveGateMock,
  reconcileTurnMock,
  startTurnMock,
  botFindUniqueMock,
  memberFindManyMock,
  toolCallFindFirstMock,
} = vi.hoisted(() => ({
  toolCallFindFirstMock: vi.fn(),
  botFindUniqueMock: vi.fn(),
  memberFindManyMock: vi.fn(),
  metadataUpsertMock: vi.fn(),
  metadataUpdateMock: vi.fn(),
  taskEventFindManyMock: vi.fn(),
  inboxFindManyMock: vi.fn(),
  delegationFindManyMock: vi.fn(),
  delegationUpdateMock: vi.fn(),
  getEnvMock: vi.fn(),
  reconcileTurnMock: vi.fn(),
  startTurnMock: vi.fn(),
  proactiveGateMock: vi.fn(),
}));

vi.mock("@/config/env", () => ({ getEnv: getEnvMock }));
const { taskCreditsChargedMock } = vi.hoisted(() => ({
  taskCreditsChargedMock: vi.fn(async () => new Map<string, number>()),
}));
vi.mock("@/lib/soko-bot/task-charges", () => ({
  taskCreditsCharged: taskCreditsChargedMock,
  roundCredits: (credits: number) => Math.round(credits * 100) / 100,
}));
vi.mock("@/services/soko-bot-proactive.service", () => ({
  proactiveGate: proactiveGateMock,
}));
vi.mock("@/lib/db/prisma", () => ({
  default: {
    syncMetadata: { upsert: metadataUpsertMock, update: metadataUpdateMock },
    sokoBotEventInbox: { findMany: inboxFindManyMock },
    taskEvent: { findMany: taskEventFindManyMock },
    sokoBot: { findUnique: botFindUniqueMock },
    member: { findMany: memberFindManyMock },
    sokoBotToolCall: { findFirst: toolCallFindFirstMock },
    sokoBotDelegation: {
      findMany: delegationFindManyMock,
      update: delegationUpdateMock,
    },
  },
}));
vi.mock("@/services/soko-bot-control-plane.service", () => ({
  SokoBotBusyError: class SokoBotBusyError extends Error {},
  SokoBotNotFoundError: class SokoBotNotFoundError extends Error {},
  sokoBotControlPlane: {
    reconcileTurn: reconcileTurnMock,
    startTurn: startTurnMock,
  },
}));

import { computeJobStatus } from "@sokosumi/database/helpers";
import { digestJob } from "@/helpers/job-digest";
import { SokoBotBusyError } from "@/services/soko-bot-control-plane.service";

import {
  buildEventMessage,
  followUpPlans,
  SokoBotEventsSyncService,
  sokoBotEventClientTurnId,
} from "./soko-bot-events-sync.service";

const turn = {
  sokoBotId: "bot_1",
  requestedByUserId: "user_1",
  workspaceId: "ws_1",
  parentTurnId: null as string | null,
  status: "COMPLETED",
};
const input = {
  abortSignal: new AbortController().signal,
  shouldContinue: () => true,
};

function taskDelegation(
  id: string,
  lastSeenStatus: string | null,
  status: string,
) {
  return {
    id,
    kind: "TASK",
    lastSeenStatus,
    task: {
      id: `task_${id}`,
      name: `Task ${id}`,
      visibility: "PUBLIC",
      ownerId: "user_1",
      workspaceId: "ws_1",
      archivedAt: null,
      status,
      events: [] as {
        id: string;
        comment: string;
        createdAt: Date;
        userId?: string;
        sokoBotId?: string;
      }[],
    },
    job: null,
    turn,
    followUp: null as string | null,
    followUpTurnId: null as string | null,
  };
}

function plannedDelegation(
  id: string,
  status: string,
  followUp: string,
  followUpTurnId: string | null = null,
) {
  const delegation = taskDelegation(id, "READY", status);
  delegation.task.id = "task_shared";
  delegation.task.events = [
    {
      id: `event_${status}`,
      comment: "Findings: A, B, C.",
      createdAt: new Date("2026-10-23T10:00:00Z"),
      userId: "user_2",
    },
  ];
  return { ...delegation, followUp, followUpTurnId };
}

describe("SokoBotEventsSyncService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    metadataUpsertMock.mockResolvedValue({
      key: "soko-events-v2",
      createdAt: new Date(0),
      cursorId: null,
    });
    metadataUpdateMock.mockResolvedValue({});
    inboxFindManyMock.mockResolvedValue([]);
    taskEventFindManyMock.mockResolvedValue([]);
    getEnvMock.mockReturnValue({ SOKO_BOT_ENABLED: true });
    proactiveGateMock.mockResolvedValue({ ok: true, usedToday: 0, limit: 20 });
    delegationUpdateMock.mockResolvedValue({});
    reconcileTurnMock.mockResolvedValue(undefined);
    startTurnMock.mockResolvedValue({
      turnId: "turn_event",
      status: "RUNNING",
      reconciliationLeaseToken: "lease",
    });
    botFindUniqueMock.mockResolvedValue({
      userId: "user_1",
      createdByUserId: "user_1",
      workspace: { organizationId: null },
    });
    memberFindManyMock.mockReset().mockResolvedValue([]);
    toolCallFindFirstMock.mockReset().mockResolvedValue(null);
  });

  it("bounds each pass and resumes its persisted cursor without starving older delegations", async () => {
    const page = Array.from({ length: 500 }, (_, i) =>
      taskDelegation(`d${i}`, "READY", "FAILED"),
    );
    delegationFindManyMock
      .mockResolvedValueOnce(page)
      .mockResolvedValueOnce([taskDelegation("older", "READY", "FAILED")]);
    const service = new SokoBotEventsSyncService();
    expect((await service.syncDelegatedWork(input)).scanned).toBe(500);
    expect(delegationFindManyMock).toHaveBeenCalledTimes(1);
    expect(metadataUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ cursorId: "d499" }),
      }),
    );
    metadataUpsertMock.mockResolvedValue({
      key: "soko-events-v2",
      createdAt: new Date(0),
      cursorId: "d499",
    });
    expect((await service.syncDelegatedWork(input)).scanned).toBe(1);
    expect(delegationFindManyMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: { gt: "d499" },
          // A comment alone does not make the bot part of the Task.
          action: { not: "reply_to_task" },
        }),
      }),
    );
    expect(metadataUpdateMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ cursorId: null }),
      }),
    );
  });

  it("baselines historical actionable events before the persisted cutover", async () => {
    metadataUpsertMock.mockResolvedValue({
      key: "soko-events-v2",
      createdAt: new Date("2026-09-26"),
      cursorId: null,
    });
    const old = taskDelegation("old", null, "INPUT_REQUIRED");
    old.task.events = [
      {
        id: "old-event",
        comment: "Old question",
        createdAt: new Date("2026-01-01"),
      },
    ];
    delegationFindManyMock.mockResolvedValue([old]);
    await new SokoBotEventsSyncService().syncDelegatedWork(input);
    expect(startTurnMock).not.toHaveBeenCalled();
    expect(delegationUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ lastSeenEventId: "old-event" }),
      }),
    );
  });

  it("preserves earlier pending occurrences when a later same-timestamp event was already consumed", async () => {
    const at = new Date("2026-09-25T12:00:00Z");
    const delegation = {
      ...taskDelegation("a", "INPUT_REQUIRED", "INPUT_REQUIRED"),
      lastSeenEventAt: at,
      lastSeenEventId: "event-0",
    };
    delegation.task.events = [
      { id: "event-2", comment: "new question", createdAt: at },
    ];
    delegationFindManyMock.mockResolvedValue([delegation]);
    taskEventFindManyMock.mockResolvedValue([
      {
        id: "event-1",
        createdAt: at,
        status: "INPUT_REQUIRED",
        comment: "first question",
      },
      {
        id: "event-2",
        createdAt: at,
        status: "INPUT_REQUIRED",
        comment: "second question",
      },
    ]);
    inboxFindManyMock.mockResolvedValue([{ eventId: "event-2" }]);
    await new SokoBotEventsSyncService().syncDelegatedWork(input);
    expect(taskEventFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          taskId: "task_a",
          OR: [
            { createdAt: { gt: at } },
            { createdAt: at, id: { gt: "event-0" } },
          ],
        },
      }),
    );
    expect(delegationUpdateMock).not.toHaveBeenCalled();
    expect(startTurnMock.mock.calls[0][0].eventBatch).toEqual([
      expect.objectContaining({ eventId: "event-1" }),
    ]);
    expect(startTurnMock.mock.calls[0][0].message).toContain("first question");
    // The bot that delegated hears back, not whichever bot the owner has.
    expect(startTurnMock.mock.calls[0][0].sokoBotId).toBe("bot_1");
  });

  it("does not disclose formerly delegated tasks after privacy or workspace changes", async () => {
    const privateTask = taskDelegation("private", "READY", "FAILED");
    privateTask.task.visibility = "PRIVATE";
    privateTask.task.ownerId = "other-owner";
    const movedTask = taskDelegation("moved", "READY", "FAILED");
    movedTask.task.workspaceId = "other-workspace";
    delegationFindManyMock.mockResolvedValue([privateTask, movedTask]);
    const result = await new SokoBotEventsSyncService().syncDelegatedWork(
      input,
    );
    expect(result.woken).toBe(0);
    expect(startTurnMock).not.toHaveBeenCalled();
  });

  it("does not wake a bot that has spent its daily allowance", async () => {
    // EVENT turns bill the owner like any other. Without this a bot that
    // comments on its own Task wakes itself every cron minute forever.
    proactiveGateMock.mockResolvedValue({
      ok: false,
      usedToday: 20,
      limit: 20,
      reason: "daily-limit",
    });
    delegationFindManyMock.mockResolvedValue([
      taskDelegation("a", "READY", "COMPLETED"),
    ]);

    const result = await new SokoBotEventsSyncService().syncDelegatedWork(
      input,
    );

    expect(result.woken).toBe(0);
    expect(startTurnMock).not.toHaveBeenCalled();
  });

  it("wakes the bot once for all changed delegations and marks them seen", async () => {
    delegationFindManyMock.mockResolvedValue([
      taskDelegation("a", "READY", "COMPLETED"),
      taskDelegation("b", "DRAFT", "DRAFT"),
      taskDelegation("c", "READY", "FAILED"),
    ]);
    taskCreditsChargedMock.mockResolvedValueOnce(new Map([["task_a", 190.6]]));
    const result = await new SokoBotEventsSyncService().syncDelegatedWork(
      input,
    );

    expect(result).toEqual({ scanned: 3, woken: 1, deferred: 0, failed: 0 });
    expect(taskCreditsChargedMock).toHaveBeenCalledWith(
      expect.arrayContaining(["task_a", "task_c"]),
    );
    expect(startTurnMock).toHaveBeenCalledTimes(1);
    const call = startTurnMock.mock.calls[0]?.[0];
    expect(call).toMatchObject({
      userId: "user_1",
      workspaceId: "ws_1",
      source: "EVENT",
    });
    expect(call.message).toContain(
      'Task "Task a" (id task_a) is now COMPLETED (was READY). Charged 190.6 credits.',
    );
    expect(call.message).toContain("is now FAILED");
    expect(call.eventBatch).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          entityId: "task_a",
          status: "COMPLETED",
          delegationIds: ["a"],
        }),
      ]),
    );
    expect(delegationUpdateMock).not.toHaveBeenCalled();
    expect(reconcileTurnMock).toHaveBeenCalledWith(
      "turn_event",
      input.abortSignal,
      "lease",
    );
  });

  // Another sync started the turn for the same completion first: it drains
  // it under its own lease. This duplicate observes the existing turn.
  it("leaves a duplicate start to the sync that won it", async () => {
    delegationFindManyMock.mockResolvedValue([
      taskDelegation("a", "READY", "COMPLETED"),
    ]);
    startTurnMock.mockResolvedValueOnce({
      turnId: "turn_event",
      status: "RUNNING",
      duplicate: true,
    });

    const result = await new SokoBotEventsSyncService().syncDelegatedWork(
      input,
    );

    expect(result).toMatchObject({ woken: 1, failed: 0 });
    expect(reconcileTurnMock).not.toHaveBeenCalled();
  });

  // Its own resume or recovery acknowledged the start, so its start result
  // carries the grant this sync uses to drain the turn it has just recovered.
  it("drains a duplicate start this call acknowledged itself", async () => {
    delegationFindManyMock.mockResolvedValue([
      taskDelegation("a", "READY", "COMPLETED"),
    ]);
    startTurnMock.mockResolvedValueOnce({
      turnId: "turn_event",
      status: "RUNNING",
      duplicate: true,
      reconciliationLeaseToken: "lease",
    });

    await new SokoBotEventsSyncService().syncDelegatedWork(input);

    expect(reconcileTurnMock).toHaveBeenCalledWith(
      "turn_event",
      input.abortSignal,
      "lease",
    );
  });

  it("leaves a running background run's own Tasks to the run", async () => {
    delegationFindManyMock.mockResolvedValue([
      {
        ...taskDelegation("a", "READY", "COMPLETED"),
        turn: { ...turn, parentTurnId: "chat_turn", status: "RUNNING" },
      },
    ]);
    const result = await new SokoBotEventsSyncService().syncDelegatedWork(
      input,
    );

    expect(result.woken).toBe(0);
    expect(startTurnMock).not.toHaveBeenCalled();
    // Left unseen, so a run that fails before reading it does not lose it.
    expect(delegationUpdateMock).not.toHaveBeenCalled();
  });

  describe("a background run's Coworker Task with a follow-up", () => {
    const runTurn = { ...turn, parentTurnId: "chat_turn", status: "RUNNING" };
    function runDelegation() {
      const delegation = plannedDelegation(
        "d1",
        "COMPLETED",
        "Use the review in the owner's draft.",
      );
      return { ...delegation, turnId: "run_turn", turn: runTurn };
    }
    const sync = () => new SokoBotEventsSyncService().syncDelegatedWork(input);

    beforeEach(() => {
      runTurn.status = "RUNNING";
    });

    it("hands the follow-up on when the Task completed before the run failed", async () => {
      delegationFindManyMock.mockResolvedValue([runDelegation()]);
      expect((await sync()).woken).toBe(0);
      expect(delegationUpdateMock).not.toHaveBeenCalled();

      runTurn.status = "FAILED";
      expect((await sync()).woken).toBe(1);
      const call = startTurnMock.mock.calls[0]![0];
      expect(call.message).toContain(
        'Your plan: "Use the review in the owner\'s draft."',
      );
      expect(call.eventBatch[0].followUpDelegationIds).toEqual(["d1"]);
    });

    it("hands the follow-up on when the Task completed after the run failed", async () => {
      runTurn.status = "FAILED";
      delegationFindManyMock.mockResolvedValue([runDelegation()]);
      expect((await sync()).woken).toBe(1);
      expect(
        startTurnMock.mock.calls[0]![0].eventBatch[0].followUpDelegationIds,
      ).toEqual(["d1"]);
    });

    it("wakes nobody when the finished run read the result itself", async () => {
      runTurn.status = "COMPLETED";
      toolCallFindFirstMock.mockResolvedValue({ id: "read" });
      delegationFindManyMock.mockResolvedValue([runDelegation()]);
      expect((await sync()).woken).toBe(0);
      expect(toolCallFindFirstMock).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            turnId: "run_turn",
            capability: "get_task_status",
            input: { path: ["taskId"], equals: "task_shared" },
            // Only a read that returned the change counts.
            result: { path: ["status"], equals: "COMPLETED" },
            updatedAt: { gte: new Date("2026-10-23T10:00:00Z") },
          }),
        }),
      );
      expect(delegationUpdateMock).toHaveBeenCalledOnce();
    });

    describe("a hired Agent's Job the run read", () => {
      const at = new Date("2026-10-23T10:00:00Z");
      type Where = Record<string, unknown>;
      /** The stored-read filter, applied to one saved get_job_status result. */
      function matches(where: Where, result: unknown): boolean {
        if (Array.isArray(where.OR))
          return where.OR.some((part: Where) => matches(part, result));
        const filter = where.result as
          | { path: string[]; equals: string }
          | undefined;
        if (!filter) return true;
        const value = filter.path.reduce<unknown>(
          (node, key) => (node as Record<string, unknown> | null)?.[key],
          result,
        );
        return value === filter.equals;
      }
      function jobDelegation(status: string, eventId: string) {
        return {
          id: "d1",
          turnId: "run_turn",
          kind: "JOB",
          lastSeenStatus: "INITIATED",
          lastSeenEventId: null,
          lastSeenEventAt: null,
          task: null,
          job: {
            id: "job_1",
            name: "Market scan",
            ownerId: "user_1",
            workspaceId: "ws_1",
            task: null,
            events: [{ id: eventId, status, createdAt: at }],
          },
          turn: runTurn,
          followUp: "Draft the post from the scan.",
          followUpTurnId: null,
        };
      }
      async function wakesAfterRead(
        delegation: ReturnType<typeof jobDelegation>,
        saved: unknown,
      ) {
        runTurn.status = "COMPLETED";
        toolCallFindFirstMock.mockImplementation(
          async ({ where }: { where: Where }) =>
            matches(where, saved) ? { id: "read" } : null,
        );
        delegationFindManyMock.mockResolvedValue([delegation]);
        return (await sync()).woken;
      }

      it("counts a read of a completed Job in the Job's own words", async () => {
        const status = computeJobStatus({
          jobType: "FREE",
          events: [{ status: "COMPLETED", input: null, createdAt: at }],
        } as never);
        expect(status).toBe("completed");
        expect(
          await wakesAfterRead(jobDelegation("COMPLETED", "done"), { status }),
        ).toBe(0);
      });

      it("counts a read of a refunded paid Job", async () => {
        const status = computeJobStatus({
          jobType: "PAID",
          refundedTransactionId: "refund",
          events: [{ status: "COMPLETED", input: null, createdAt: at }],
        } as never);
        expect(status).toBe("refund_resolved");
        expect(
          await wakesAfterRead(jobDelegation("COMPLETED", "done"), { status }),
        ).toBe(0);
      });

      it("wakes for a second input request the read did not see", async () => {
        // The read saw the first request, req_1; the Agent then asked again.
        const saved = digestJob({
          status: "input_required",
          input: null,
          inputSchema: null,
          result: null,
          events: [
            {
              id: "req_1",
              status: "AWAITING_INPUT",
              inputSchema: null,
              result: null,
              blobs: [],
              links: [],
            },
          ],
        } as never);
        expect(saved.inputRequest?.eventId).toBe("req_1");
        expect(
          await wakesAfterRead(jobDelegation("AWAITING_INPUT", "req_2"), saved),
        ).toBe(1);
        startTurnMock.mockClear();
        expect(
          await wakesAfterRead(jobDelegation("AWAITING_INPUT", "req_1"), saved),
        ).toBe(0);
      });
    });

    it("does not count a read saved after the change that still returned RUNNING", async () => {
      runTurn.status = "COMPLETED";
      const reads = [
        {
          turnId: "run_turn",
          capability: "get_task_status",
          status: "COMPLETED",
          input: { taskId: "task_shared" },
          // Started a moment before the Task completed, saved after it.
          result: { status: "RUNNING" },
          updatedAt: new Date("2026-10-23T10:00:00.002Z"),
        },
      ];
      toolCallFindFirstMock.mockImplementation(
        async ({
          where,
        }: {
          where: {
            turnId: string;
            capability: string;
            input: { equals: string };
            result: { equals: string };
            updatedAt: { gte: Date };
          };
        }) =>
          reads.find(
            (read) =>
              read.turnId === where.turnId &&
              read.capability === where.capability &&
              read.input.taskId === where.input.equals &&
              read.result.status === where.result.equals &&
              read.updatedAt >= where.updatedAt.gte,
          ) ?? null,
      );
      delegationFindManyMock.mockResolvedValue([runDelegation()]);
      expect((await sync()).woken).toBe(1);
      expect(
        startTurnMock.mock.calls[0]![0].eventBatch[0].followUpDelegationIds,
      ).toEqual(["d1"]);
    });

    it("hands the follow-up on when the run read the result and then failed", async () => {
      runTurn.status = "FAILED";
      toolCallFindFirstMock.mockResolvedValue({ id: "read" });
      delegationFindManyMock.mockResolvedValue([runDelegation()]);
      expect((await sync()).woken).toBe(1);
      expect(
        startTurnMock.mock.calls[0]![0].eventBatch[0].followUpDelegationIds,
      ).toEqual(["d1"]);
    });

    it("never restarts a plan the owner stopped with the run", async () => {
      runTurn.status = "CANCEL_REQUESTED";
      delegationFindManyMock.mockResolvedValue([runDelegation()]);
      expect((await sync()).woken).toBe(0);
      runTurn.status = "CANCELLED";
      expect((await sync()).woken).toBe(0);
      expect(startTurnMock).not.toHaveBeenCalled();
      expect(delegationUpdateMock).toHaveBeenCalledOnce();
    });

    it("carries the follow-up out once, however often the scan replays", async () => {
      runTurn.status = "FAILED";
      const delegation = runDelegation();
      delegationFindManyMock.mockResolvedValue([delegation]);
      // What Core records when it starts the wake: the change is seen and
      // the plan is claimed by that turn.
      startTurnMock.mockImplementation(async () => {
        Object.assign(delegation, {
          lastSeenStatus: "COMPLETED",
          lastSeenEventId: delegation.task.events[0]!.id,
          lastSeenEventAt: delegation.task.events[0]!.createdAt,
          followUpTurnId: "turn_event",
        });
        return {
          turnId: "turn_event",
          status: "RUNNING",
          reconciliationLeaseToken: "lease",
        };
      });
      expect((await sync()).woken).toBe(1);
      expect((await sync()).woken).toBe(0);
      expect(startTurnMock).toHaveBeenCalledOnce();
    });
  });

  it("does not wake the bot for a status change it made itself", async () => {
    const delegation = taskDelegation("a", "DRAFT", "COMPLETED");
    delegation.task.events = [
      {
        id: "event-1",
        comment: "Closed at the owner's request",
        createdAt: new Date(),
        sokoBotId: turn.sokoBotId,
      },
    ];
    delegationFindManyMock.mockResolvedValue([delegation]);
    const result = await new SokoBotEventsSyncService().syncDelegatedWork(
      input,
    );

    expect(result.woken).toBe(0);
    expect(startTurnMock).not.toHaveBeenCalled();
    expect(delegationUpdateMock).toHaveBeenCalledOnce();
  });

  it("wakes the bot for a Task whose background run has ended", async () => {
    delegationFindManyMock.mockResolvedValue([
      {
        ...taskDelegation("a", "READY", "COMPLETED"),
        turn: { ...turn, parentTurnId: "chat_turn", status: "FAILED" },
      },
    ]);
    const result = await new SokoBotEventsSyncService().syncDelegatedWork(
      input,
    );

    expect(result.woken).toBe(1);
  });

  it("runs a shared bot's event turn for its Requester, not the TaskEvent's author", async () => {
    const delegation = taskDelegation("a", "READY", "COMPLETED");
    delegation.task.events = [
      {
        id: "ev_a",
        comment: "Done",
        createdAt: new Date(1),
        userId: "member_2",
      },
    ];
    delegationFindManyMock.mockResolvedValue([delegation]);
    botFindUniqueMock.mockResolvedValue({
      userId: null,
      createdByUserId: "creator_1",
      workspace: { organizationId: "org_1" },
    });

    const result = await new SokoBotEventsSyncService().syncDelegatedWork(
      input,
    );

    expect(result.woken).toBe(1);
    expect(memberFindManyMock).not.toHaveBeenCalled();
    expect(startTurnMock.mock.calls[0]?.[0]).toMatchObject({
      userId: "user_1",
      sokoBotId: "bot_1",
      workspaceId: "ws_1",
      source: "EVENT",
    });
  });

  it("runs a shared bot's self-started work for nobody", async () => {
    delegationFindManyMock.mockResolvedValue([
      {
        ...taskDelegation("a", "READY", "COMPLETED"),
        turn: { ...turn, requestedByUserId: null, sokoBot: { userId: null } },
      },
    ]);
    botFindUniqueMock.mockResolvedValue({
      userId: null,
      createdByUserId: null,
      workspace: { organizationId: "org_1" },
    });

    const result = await new SokoBotEventsSyncService().syncDelegatedWork(
      input,
    );

    expect(result).toMatchObject({ woken: 1, failed: 0 });
    expect(startTurnMock.mock.calls[0]?.[0]).toMatchObject({
      userId: null,
      sokoBotId: "bot_1",
    });
  });

  it("wakes a shared bot once per asking member, never one member for another", async () => {
    delegationFindManyMock.mockResolvedValue([
      {
        ...taskDelegation("a", "READY", "COMPLETED"),
        turn: {
          ...turn,
          requestedByUserId: "member_1",
          sokoBot: { userId: null },
        },
      },
      {
        ...taskDelegation("b", "READY", "COMPLETED"),
        turn: {
          ...turn,
          requestedByUserId: "member_2",
          sokoBot: { userId: null },
        },
      },
    ]);
    botFindUniqueMock.mockResolvedValue({
      userId: null,
      createdByUserId: null,
      workspace: { organizationId: "org_1" },
    });

    const result = await new SokoBotEventsSyncService().syncDelegatedWork(
      input,
    );

    expect(result).toMatchObject({ woken: 2, failed: 0 });
    expect(
      startTurnMock.mock.calls.map(([call]) => [
        call.userId,
        call.eventBatch.map(({ entityId }: { entityId: string }) => entityId),
      ]),
    ).toEqual([
      ["member_1", ["task_a"]],
      ["member_2", ["task_b"]],
    ]);
  });

  it("baselines first observations and silent statuses without waking", async () => {
    delegationFindManyMock.mockResolvedValue([
      taskDelegation("new", null, "COMPLETED"),
      taskDelegation("running", "READY", "RUNNING"),
    ]);
    const result = await new SokoBotEventsSyncService().syncDelegatedWork(
      input,
    );

    expect(result.woken).toBe(0);
    expect(startTurnMock).not.toHaveBeenCalled();
    expect(delegationUpdateMock).toHaveBeenCalledTimes(2);
  });

  it("leaves the change unseen when the bot is busy so the next tick retries", async () => {
    delegationFindManyMock.mockResolvedValue([
      taskDelegation("a", "READY", "COMPLETED"),
    ]);
    startTurnMock.mockRejectedValue(new SokoBotBusyError("busy"));
    const result = await new SokoBotEventsSyncService().syncDelegatedWork(
      input,
    );

    expect(result).toEqual({ scanned: 1, woken: 0, deferred: 1, failed: 0 });
    expect(delegationUpdateMock).not.toHaveBeenCalled();
  });

  it("wakes on job completion via the latest job event", async () => {
    delegationFindManyMock.mockResolvedValue([
      {
        id: "j",
        kind: "JOB",
        lastSeenStatus: "RUNNING",
        task: null,
        job: {
          id: "job_1",
          name: null,
          workspaceId: "ws_1",
          ownerId: "user_1",
          task: null,
          events: [{ status: "COMPLETED" }],
        },
        turn,
      },
    ]);
    await new SokoBotEventsSyncService().syncDelegatedWork(input);
    const message = startTurnMock.mock.calls[0]?.[0].message;
    expect(message).toContain('Job "Agent job" (id job_1) is now COMPLETED');
    expect(message).toContain("Read each Job with get_job_status");
    expect(message).toContain("provide_job_input");
    expect(message).not.toContain("Read each Task");
  });

  it.each([
    { label: "no parent Task", task: null },
    {
      label: "a parent Task someone else owns",
      task: { visibility: "PUBLIC", ownerId: "other_owner" },
    },
  ])(
    "runs a shared bot's Job wake for the hiring member with $label",
    async ({ task }) => {
      delegationFindManyMock.mockResolvedValue([
        {
          id: "j",
          kind: "JOB",
          lastSeenStatus: "RUNNING",
          task: null,
          job: {
            id: "job_1",
            name: null,
            workspaceId: "ws_1",
            ownerId: "user_1",
            task,
            events: [{ status: "COMPLETED" }],
          },
          turn,
        },
      ]);
      botFindUniqueMock.mockResolvedValue({
        userId: null,
        createdByUserId: "creator_1",
        workspace: { organizationId: "org_1" },
      });
      const live = ["user_1", "other_owner", "creator_1", "owner_1"];
      memberFindManyMock.mockImplementation(
        async (args: { where: { userId?: { in: string[] }; role?: string } }) =>
          live
            .filter((id) =>
              args.where.role
                ? id === "owner_1"
                : args.where.userId?.in.includes(id),
            )
            .map((id) => ({
              userId: id,
              user: { banned: false, banExpires: null },
            })),
      );

      await new SokoBotEventsSyncService().syncDelegatedWork(input);

      expect(startTurnMock.mock.calls[0]?.[0]).toMatchObject({
        userId: "user_1",
        sokoBotId: "bot_1",
      });
    },
  );

  it("does nothing while Soko Bot is disabled", async () => {
    getEnvMock.mockReturnValue({ SOKO_BOT_ENABLED: false });
    const result = await new SokoBotEventsSyncService().syncDelegatedWork(
      input,
    );
    expect(result.scanned).toBe(0);
    expect(delegationFindManyMock).not.toHaveBeenCalled();
  });

  it("formats the wake-up message as a checklist", () => {
    const message = buildEventMessage([
      {
        delegationId: "d",
        kind: "TASK",
        entityId: "t1",
        name: "Brief",
        from: null,
        to: "COMPLETED",
        note: null,
      },
    ]);
    expect(
      message.startsWith(
        'Delegated work changed status:\n- Task "Brief" (id t1) is now COMPLETED.',
      ),
    ).toBe(true);
  });
  it("tells the bot what a finished Task charged, so it can compare with the approval", () => {
    const message = buildEventMessage([
      {
        delegationId: "d",
        kind: "TASK",
        entityId: "t1",
        name: "Pricing research",
        from: "READY",
        to: "COMPLETED",
        note: null,
        creditsCharged: 421.31,
      },
    ]);
    expect(message).toContain(
      '- Task "Pricing research" (id t1) is now COMPLETED (was READY). Charged 421.31 credits.',
    );
    expect(message).toContain("say plainly if it went over");
  });

  it("retains overflow beyond eight changes and queues only the selected occurrences", async () => {
    delegationFindManyMock.mockResolvedValue(
      Array.from({ length: 10 }, (_, i) =>
        taskDelegation(String(i), "READY", "FAILED"),
      ),
    );
    await new SokoBotEventsSyncService().syncDelegatedWork(input);
    expect(startTurnMock.mock.calls[0][0].eventBatch).toHaveLength(8);
    expect(delegationUpdateMock).not.toHaveBeenCalled();
  });

  it("wakes first actionable observations and repeated statuses with a new event", async () => {
    delegationFindManyMock.mockResolvedValue([
      {
        ...taskDelegation("a", "INPUT_REQUIRED", "INPUT_REQUIRED"),
        lastSeenEventId: "event-one",
        task: {
          ...taskDelegation("a", "INPUT_REQUIRED", "INPUT_REQUIRED").task,
          id: "task_a",
          name: "Task a",
          status: "INPUT_REQUIRED",
          events: [
            { id: "event-two", comment: "Please clarify the new requirement" },
          ],
        },
      },
      {
        ...taskDelegation("b", null, "INPUT_REQUIRED"),
        task: {
          ...taskDelegation("b", null, "INPUT_REQUIRED").task,
          events: [{ id: "fresh", comment: "new", createdAt: new Date() }],
        },
      },
    ]);
    await new SokoBotEventsSyncService().syncDelegatedWork(input);
    expect(startTurnMock.mock.calls[0][0].message).toContain(
      "Please clarify the new requirement",
    );
    expect(startTurnMock.mock.calls[0][0].eventBatch).toHaveLength(2);
  });

  it("hashes full canonical occurrence identities without prefix collisions", () => {
    const change = {
      delegationId: "x".repeat(150),
      kind: "TASK" as const,
      entityId: "task",
      name: "task",
      from: "READY",
      to: "INPUT_REQUIRED",
      note: null,
      eventId: "event-one",
    };
    expect(sokoBotEventClientTurnId([change])).not.toBe(
      sokoBotEventClientTurnId([{ ...change, eventId: "event-two" }]),
    );
    expect(sokoBotEventClientTurnId([change])).toHaveLength(70);
  });

  it("hands a follow-up plan over on the wake that reports completion", async () => {
    delegationFindManyMock.mockResolvedValue([
      plannedDelegation("d1", "COMPLETED", "Give the findings to Alex."),
    ]);
    await new SokoBotEventsSyncService().syncDelegatedWork(input);
    const call = startTurnMock.mock.calls[0]![0];
    expect(call.message).toContain(
      "Follow-up plans you attached to this work:",
    );
    expect(call.message).toContain('Your plan: "Give the findings to Alex."');
    expect(call.message).toContain("Latest comment: Findings: A, B, C.");
    expect(call.eventBatch[0].followUpDelegationIds).toEqual(["d1"]);
  });

  it("shows a plan as pending, without claiming it, while the work waits", async () => {
    delegationFindManyMock.mockResolvedValue([
      plannedDelegation("d1", "INPUT_REQUIRED", "Give the findings to Alex."),
    ]);
    await new SokoBotEventsSyncService().syncDelegatedWork(input);
    const call = startTurnMock.mock.calls[0]![0];
    expect(call.message).toContain("Your plan for when it completes");
    expect(call.eventBatch[0].followUpDelegationIds).toBeUndefined();
  });

  it("never repeats a plan another turn already carried out", async () => {
    delegationFindManyMock.mockResolvedValue([
      plannedDelegation("d1", "COMPLETED", "Give it to Alex.", "turn_before"),
    ]);
    await new SokoBotEventsSyncService().syncDelegatedWork(input);
    const call = startTurnMock.mock.calls[0]![0];
    expect(call.message).not.toContain("Give it to Alex.");
    expect(call.eventBatch[0].followUpDelegationIds).toBeUndefined();
  });

  it("claims plans of every delegation on the Task once, on one occurrence", async () => {
    delegationFindManyMock.mockResolvedValue([
      plannedDelegation("d1", "COMPLETED", "Give it to Alex."),
      plannedDelegation("d2", "COMPLETED", "Tell the owner."),
    ]);
    await new SokoBotEventsSyncService().syncDelegatedWork(input);
    const call = startTurnMock.mock.calls[0]![0];
    const claims = call.eventBatch.flatMap(
      (occurrence: { followUpDelegationIds?: string[] }) =>
        occurrence.followUpDelegationIds ?? [],
    );
    expect(claims.sort()).toEqual(["d1", "d2"]);
    expect(call.message).toContain('"Give it to Alex." and "Tell the owner."');
  });

  it("defers, rather than fails, when another turn took the plan first", async () => {
    delegationFindManyMock.mockResolvedValue([
      plannedDelegation("d1", "COMPLETED", "Give it to Alex."),
    ]);
    startTurnMock.mockRejectedValue(new SokoBotBusyError("handed over"));
    const result = await new SokoBotEventsSyncService().syncDelegatedWork(
      input,
    );
    expect(result).toMatchObject({ woken: 0, deferred: 1, failed: 0 });
  });

  it("settles plans by kind: a failed Task can still be restarted, a failed Job cannot", () => {
    const base = {
      delegationId: "d1",
      entityId: "e1",
      name: "Work",
      from: "READY",
      note: null,
      followUp: "Next step.",
    };
    const plan = (kind: "TASK" | "JOB", to: string) =>
      followUpPlans([{ ...base, kind, to }])[0];
    expect(plan("TASK", "COMPLETED").due).toBe(true);
    expect(plan("TASK", "CANCELED").due).toBe(true);
    expect(plan("TASK", "FAILED").due).toBe(false);
    expect(plan("JOB", "FAILED").due).toBe(true);
    expect(plan("JOB", "AWAITING_INPUT").due).toBe(false);
    expect(
      buildEventMessage([{ ...base, kind: "JOB", to: "FAILED" }]),
    ).toContain('your plan "Next step." will not run');
  });
});
