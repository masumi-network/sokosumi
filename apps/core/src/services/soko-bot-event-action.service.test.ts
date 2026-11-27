import type { Prisma } from "@sokosumi/database";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { commitActionReceipt } from "@/lib/soko-bot/action-receipts";
import { claimTaskEventAction } from "./soko-bot-event-action.service";

const actor = {
  turnId: "turn_1",
  sokoBotId: "bot_1",
  workspaceId: "ws_1",
  source: "EVENT",
};

const tx = {
  sokoBotEventInbox: { findMany: vi.fn(), findFirst: vi.fn() },
  taskLink: { findMany: vi.fn() },
  task: { findFirst: vi.fn() },
  sokoBotTurn: { findUnique: vi.fn() },
  sokoBotTaskActionClaim: {
    findUnique: vi.fn(),
    create: vi.fn(),
    updateMany: vi.fn(),
  },
};
const claim = () =>
  claimTaskEventAction(
    tx as unknown as Prisma.TransactionClient,
    actor,
    "task_alex",
    "TASK_STATE",
  );

describe("claimTaskEventAction for a Task the reported one blocked", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    tx.sokoBotEventInbox.findMany.mockResolvedValue([]);
    tx.taskLink.findMany.mockResolvedValue([{ fromTaskId: "task_hannah" }]);
    tx.sokoBotEventInbox.findFirst.mockResolvedValue({
      eventId: "event_hannah_completed",
      designatedHandlerBotId: "bot_1",
    });
    tx.task.findFirst.mockResolvedValue({ assigneeSokoBotId: null });
    tx.sokoBotTaskActionClaim.findUnique.mockResolvedValue(null);
    tx.sokoBotTaskActionClaim.create.mockResolvedValue({ id: "claim_1" });
  });

  it("lets the wake about a completed blocker start the blocked Task", async () => {
    expect(await claim()).toEqual({ allowed: true, claimId: "claim_1" });
    expect(tx.taskLink.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          toTaskId: "task_alex",
          type: "BLOCKS",
          fromTask: { workspaceId: "ws_1", status: "COMPLETED" },
        }),
      }),
    );
    expect(tx.sokoBotTaskActionClaim.create).toHaveBeenCalledWith({
      data: {
        taskId: "task_alex",
        triggeringEventId: "event_hannah_completed",
        actionKind: "TASK_STATE",
        handlerBotId: "bot_1",
        turnId: "turn_1",
      },
      select: { id: true },
    });
  });

  it("refuses when no completed blocker is part of this wake", async () => {
    tx.sokoBotEventInbox.findFirst.mockResolvedValue(null);
    expect(await claim()).toMatchObject({ allowed: false, claimId: null });
    tx.taskLink.findMany.mockResolvedValue([]);
    expect(await claim()).toMatchObject({ allowed: false, claimId: null });
    expect(tx.sokoBotTaskActionClaim.create).not.toHaveBeenCalled();
  });

  it("refuses when another bot handles the blocked Task", async () => {
    tx.task.findFirst.mockResolvedValue({ assigneeSokoBotId: "bot_2" });
    expect(await claim()).toMatchObject({ allowed: false, claimId: null });
  });
});

describe("claimTaskEventAction on a follow-up's retry", () => {
  // The first wake for CodePat's finished review failed; the retry carries
  // the plan "give the review to Alex as a Task".
  const create = () =>
    claimTaskEventAction(
      tx as unknown as Prisma.TransactionClient,
      { ...actor, turnId: "retry_turn" },
      "task_codepat",
      "CREATE_TASK",
    );

  beforeEach(() => {
    vi.clearAllMocks();
    tx.sokoBotEventInbox.findMany.mockResolvedValue([
      {
        eventId: "event_review_done:follow-up-retry",
        designatedHandlerBotId: "bot_1",
      },
    ]);
    tx.task.findFirst.mockResolvedValue({
      assigneeSokoBotId: null,
      events: [{ id: "event_review_done", sokoBotId: null }],
    });
    tx.sokoBotTaskActionClaim.findUnique.mockResolvedValue(null);
    tx.sokoBotTaskActionClaim.create.mockResolvedValue({ id: "claim_retry" });
    tx.sokoBotTaskActionClaim.updateMany.mockResolvedValue({ count: 1 });
  });

  it("acts under the Task event the retry stands for", async () => {
    expect(await create()).toEqual({ allowed: true, claimId: "claim_retry" });
    expect(tx.sokoBotTaskActionClaim.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          triggeringEventId: "event_review_done",
          turnId: "retry_turn",
        }),
      }),
    );
  });

  it("takes over the claim the failed turn left without doing the work", async () => {
    tx.sokoBotTaskActionClaim.findUnique.mockResolvedValue({
      id: "claim_failed",
      turnId: "failed_turn",
      handlerBotId: "bot_1",
      receiptId: null,
    });
    tx.sokoBotTurn.findUnique.mockResolvedValue({ status: "FAILED" });
    expect(await create()).toEqual({ allowed: true, claimId: "claim_failed" });
    expect(tx.sokoBotTaskActionClaim.updateMany).toHaveBeenCalledWith({
      where: { id: "claim_failed", turnId: "failed_turn", receiptId: null },
      data: { turnId: "retry_turn" },
    });
  });

  it("never repeats work the failed turn committed, nor takes over a live turn's claim", async () => {
    tx.sokoBotTaskActionClaim.findUnique.mockResolvedValue({
      id: "claim_failed",
      turnId: "failed_turn",
      handlerBotId: "bot_1",
      receiptId: "receipt_1",
    });
    tx.sokoBotTurn.findUnique.mockResolvedValue({ status: "FAILED" });
    expect(await create()).toMatchObject({ allowed: false });

    tx.sokoBotTaskActionClaim.findUnique.mockResolvedValue({
      id: "claim_live",
      turnId: "other_turn",
      handlerBotId: "bot_1",
      receiptId: null,
    });
    tx.sokoBotTurn.findUnique.mockResolvedValue({ status: "RUNNING" });
    expect(await create()).toMatchObject({ allowed: false });
    expect(tx.sokoBotTaskActionClaim.updateMany).not.toHaveBeenCalled();
  });
});

describe("claimTaskEventAction when someone else answered first", () => {
  it("tells the bot it was superseded, not that it lacks permission", async () => {
    vi.clearAllMocks();
    tx.sokoBotEventInbox.findMany.mockResolvedValue([
      { eventId: "event_plan", designatedHandlerBotId: "bot_1" },
    ]);
    // Elena approved Hannah's plan four seconds before Joseph tried to.
    tx.task.findFirst.mockResolvedValue({
      assigneeSokoBotId: null,
      events: [{ id: "event_elena_approval", sokoBotId: null }],
    });
    const result = await claimTaskEventAction(
      tx as unknown as Prisma.TransactionClient,
      actor,
      "task_hannah",
      "TASK_STATE",
    );
    expect(result.allowed).toBe(false);
    expect(result.refusal).toMatch(/Someone else answered/);
    expect(result.refusal).toMatch(/not a permission problem/);
  });
});

describe("claimTaskEventAction for multiple CREATE_TASK calls in one EVENT turn", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    tx.sokoBotEventInbox.findMany.mockResolvedValue([
      {
        eventId: "event_source_done",
        designatedHandlerBotId: "bot_1",
      },
    ]);
    tx.task.findFirst.mockResolvedValue({
      assigneeSokoBotId: null,
      events: [{ id: "event_source_done", sokoBotId: null }],
    });
    tx.sokoBotTaskActionClaim.findUnique.mockResolvedValue(null);
    tx.sokoBotTaskActionClaim.create.mockResolvedValue({
      id: "claim_create_1",
    });
  });

  function makeStatefulTx(
    inboxEventId: string,
    initialClaim: {
      id: string;
      turnId: string;
      handlerBotId: string;
      receiptId: string | null;
    } | null = null,
    turnStatuses: Record<string, string> = {},
  ) {
    const state = { claimRow: initialClaim };
    const toolCallUpdates: Array<{ toolCallId: string; targetId: string }> = [];
    const claimUpdates: Array<{ id: string; receiptId: string }> = [];
    const statefulTx = {
      sokoBotEventInbox: {
        findMany: vi.fn(async () => [
          {
            eventId: inboxEventId,
            designatedHandlerBotId: "bot_1",
          },
        ]),
      },
      task: {
        findFirst: vi.fn(async () => ({
          assigneeSokoBotId: null,
          events: [{ id: "event_source_done", sokoBotId: null }],
        })),
      },
      sokoBotTurn: {
        findUnique: vi.fn(async ({ where }: { where: { id: string } }) => ({
          ...(where.id in turnStatuses
            ? { status: turnStatuses[where.id] }
            : {}),
          intentId: null,
          intentRevision: null,
        })),
      },
      sokoBotTaskActionClaim: {
        findUnique: vi.fn(async () => state.claimRow),
        create: vi.fn(
          async ({
            data,
          }: {
            data: { handlerBotId: string; turnId: string };
          }) => {
            state.claimRow = {
              id: "claim_create_1",
              turnId: data.turnId,
              handlerBotId: data.handlerBotId,
              receiptId: null,
            };
            return { id: "claim_create_1" };
          },
        ),
        update: vi.fn(
          async ({
            where,
            data,
          }: {
            where: {
              id: string;
              handlerBotId: string;
              turnId: string;
              receiptId: null;
            };
            data: { receiptId: string };
          }) => {
            if (
              !state.claimRow ||
              state.claimRow.id !== where.id ||
              state.claimRow.handlerBotId !== where.handlerBotId ||
              state.claimRow.turnId !== where.turnId ||
              state.claimRow.receiptId !== null
            ) {
              throw new Error("Claim row did not match update predicate");
            }
            state.claimRow = { ...state.claimRow, receiptId: data.receiptId };
            claimUpdates.push({ id: where.id, receiptId: data.receiptId });
            return state.claimRow;
          },
        ),
        updateMany: vi.fn(
          async ({
            where,
            data,
          }: {
            where: { id: string; turnId: string; receiptId: null };
            data: { turnId: string };
          }) => {
            if (
              !state.claimRow ||
              state.claimRow.id !== where.id ||
              state.claimRow.turnId !== where.turnId ||
              state.claimRow.receiptId !== null
            ) {
              return { count: 0 };
            }
            state.claimRow = { ...state.claimRow, turnId: data.turnId };
            return { count: 1 };
          },
        ),
      },
      sokoBotEffectOutbox: {
        upsert: vi.fn(async () => ({})),
      },
      sokoBotToolCall: {
        update: vi.fn(
          async ({
            where,
            data,
          }: {
            where: {
              turnId_toolCallId: { turnId: string; toolCallId: string };
            };
            data: { targetId: string };
          }) => {
            toolCallUpdates.push({
              toolCallId: where.turnId_toolCallId.toolCallId,
              targetId: data.targetId,
            });
            return {
              id: `receipt_${where.turnId_toolCallId.toolCallId}`,
              capability: "create_task",
            };
          },
        ),
      },
    } as unknown as Prisma.TransactionClient;

    return { statefulTx, state, toolCallUpdates, claimUpdates };
  }

  it("allows creating two follow-up Tasks in the same EVENT turn after the first claim committed", async () => {
    const { statefulTx, state, toolCallUpdates, claimUpdates } =
      makeStatefulTx("event_source_done");

    const first = await claimTaskEventAction(
      statefulTx,
      actor,
      "task_source",
      "CREATE_TASK",
    );
    expect(first).toEqual({ allowed: true, claimId: "claim_create_1" });
    await commitActionReceipt(statefulTx, {
      turnId: actor.turnId,
      toolCallId: "tc_first",
      actorBotId: actor.sokoBotId,
      targetId: "task_followup_1",
      effectEventId: "evt_followup_1",
      claimId: first.claimId,
      result: { id: "task_followup_1", status: "READY" },
    });

    // Second follow-up Task in the same turn is allowed with claimId: null
    // so the original claim receipt stays intact.
    const second = await claimTaskEventAction(
      statefulTx,
      actor,
      "task_source",
      "CREATE_TASK",
    );
    expect(second).toEqual({ allowed: true, claimId: null });
    await commitActionReceipt(statefulTx, {
      turnId: actor.turnId,
      toolCallId: "tc_second",
      actorBotId: actor.sokoBotId,
      targetId: "task_followup_2",
      effectEventId: "evt_followup_2",
      claimId: second.claimId,
      result: { id: "task_followup_2", status: "READY" },
    });

    expect(toolCallUpdates).toEqual([
      { toolCallId: "tc_first", targetId: "task_followup_1" },
      { toolCallId: "tc_second", targetId: "task_followup_2" },
    ]);
    expect(claimUpdates).toEqual([
      { id: "claim_create_1", receiptId: "receipt_tc_first" },
    ]);
    expect(state.claimRow?.receiptId).toBe("receipt_tc_first");
  });

  it("allows two follow-up Tasks on a retried follow-up wake after taking over a failed turn's uncommitted claim", async () => {
    const { statefulTx, state, toolCallUpdates, claimUpdates } = makeStatefulTx(
      "event_source_done:follow-up-retry",
      {
        id: "claim_failed_1",
        turnId: "failed_turn",
        handlerBotId: "bot_1",
        receiptId: null,
      },
      { failed_turn: "FAILED" },
    );
    const retryActor = { ...actor, turnId: "retry_turn" };

    const first = await claimTaskEventAction(
      statefulTx,
      retryActor,
      "task_source",
      "CREATE_TASK",
    );
    expect(first).toEqual({ allowed: true, claimId: "claim_failed_1" });
    await commitActionReceipt(statefulTx, {
      turnId: retryActor.turnId,
      toolCallId: "tc_retry_1",
      actorBotId: retryActor.sokoBotId,
      targetId: "task_followup_1",
      effectEventId: "evt_followup_1",
      claimId: first.claimId,
      result: { id: "task_followup_1", status: "READY" },
    });

    const second = await claimTaskEventAction(
      statefulTx,
      retryActor,
      "task_source",
      "CREATE_TASK",
    );
    expect(second).toEqual({ allowed: true, claimId: null });
    await commitActionReceipt(statefulTx, {
      turnId: retryActor.turnId,
      toolCallId: "tc_retry_2",
      actorBotId: retryActor.sokoBotId,
      targetId: "task_followup_2",
      effectEventId: "evt_followup_2",
      claimId: second.claimId,
      result: { id: "task_followup_2", status: "READY" },
    });

    expect(toolCallUpdates).toEqual([
      { toolCallId: "tc_retry_1", targetId: "task_followup_1" },
      { toolCallId: "tc_retry_2", targetId: "task_followup_2" },
    ]);
    expect(claimUpdates).toEqual([
      { id: "claim_failed_1", receiptId: "receipt_tc_retry_1" },
    ]);
    expect(state.claimRow?.turnId).toBe("retry_turn");
    expect(state.claimRow?.receiptId).toBe("receipt_tc_retry_1");
  });

  it("still returns the existing claimId while the same turn's first CREATE_TASK claim is uncommitted", async () => {
    tx.sokoBotTaskActionClaim.findUnique.mockResolvedValue({
      id: "claim_uncommitted",
      turnId: "turn_1",
      handlerBotId: "bot_1",
      receiptId: null,
    });
    const result = await claimTaskEventAction(
      tx as unknown as Prisma.TransactionClient,
      actor,
      "task_source",
      "CREATE_TASK",
    );
    expect(result).toEqual({ allowed: true, claimId: "claim_uncommitted" });
  });

  it("still refuses a second CREATE_TASK in the same turn when a newer event superseded the source Task", async () => {
    tx.task.findFirst.mockResolvedValue({
      assigneeSokoBotId: null,
      events: [{ id: "event_owner_stop", sokoBotId: null }],
    });
    const result = await claimTaskEventAction(
      tx as unknown as Prisma.TransactionClient,
      actor,
      "task_source",
      "CREATE_TASK",
    );
    expect(result.allowed).toBe(false);
    expect(result.refusal).toMatch(/Someone else answered/);
  });

  it("still refuses CREATE_TASK from another turn after the owning turn committed", async () => {
    tx.sokoBotTaskActionClaim.findUnique.mockResolvedValue({
      id: "claim_create_1",
      turnId: "turn_1",
      handlerBotId: "bot_1",
      receiptId: "receipt_tc_first",
    });
    const result = await claimTaskEventAction(
      tx as unknown as Prisma.TransactionClient,
      { ...actor, turnId: "turn_2" },
      "task_source",
      "CREATE_TASK",
    );
    expect(result).toMatchObject({ allowed: false, claimId: "claim_create_1" });
    expect(result.refusal).toMatch(/Someone else answered/);
  });

  it("still refuses a second non-CREATE_TASK action in the same turn after committing", async () => {
    tx.sokoBotTaskActionClaim.findUnique.mockResolvedValue({
      id: "claim_state_1",
      turnId: "turn_1",
      handlerBotId: "bot_1",
      receiptId: "receipt_state",
    });
    const result = await claimTaskEventAction(
      tx as unknown as Prisma.TransactionClient,
      actor,
      "task_source",
      "TASK_STATE",
    );
    expect(result).toMatchObject({ allowed: false, claimId: "claim_state_1" });
    expect(result.refusal).toMatch(/Someone else answered/);
  });
});
