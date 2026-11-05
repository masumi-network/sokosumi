import type { Prisma } from "@sokosumi/database";
import { beforeEach, describe, expect, it, vi } from "vitest";

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
  sokoBotTaskActionClaim: { findUnique: vi.fn(), create: vi.fn() },
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
