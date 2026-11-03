import type { Prisma } from "@sokosumi/database";

export interface TaskEventClaim {
  allowed: boolean;
  claimId: string | null;
  /** What the bot is told when it may not act; it repeats this to the owner. */
  refusal?: string;
}

const SUPERSEDED =
  "Someone else answered or changed this Task after the update you woke for, so this turn does not act on it. Read it with get_task_status: if it no longer waits for an answer, there is nothing to do. This is not a permission problem; do not ask the owner to restore access.";
const NOT_IN_WAKE =
  "This turn woke for other Tasks and may not change this one. Mention what it needs in your report instead; you are woken again when it changes.";
const OTHER_HANDLER =
  "Another bot handles this Task; leave it to them and mention it in your report if it matters.";

const refuse = (refusal: string): TaskEventClaim => ({
  allowed: false,
  claimId: null,
  refusal,
});

/** The claim and effect must commit in the same transaction. No lease permits
 * replaying an action committed by another turn. */
export async function claimTaskEventAction(
  tx: Prisma.TransactionClient,
  actor: {
    turnId: string;
    sokoBotId: string;
    workspaceId: string;
    source: string;
  },
  taskId: string,
  actionKind: string,
): Promise<TaskEventClaim> {
  if (actor.source !== "EVENT") return { allowed: true, claimId: null };
  const inbox = await tx.sokoBotEventInbox.findMany({
    where: { turnId: actor.turnId, botId: actor.sokoBotId, entityId: taskId },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
  });
  if (!inbox.length) return claimBlockedTask(tx, actor, taskId, actionKind);
  const task = await tx.task.findFirst({
    where: { id: taskId, workspaceId: actor.workspaceId, archivedAt: null },
    select: {
      assigneeSokoBotId: true,
      events: {
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: 1,
        select: { id: true, sokoBotId: true },
      },
    },
  });
  if (!task) return refuse(NOT_IN_WAKE);
  const latest = task.events[0];
  // A delayed turn cannot act on an occurrence superseded by a human or
  // another worker. Its own committed effects may follow the triggering event.
  let event = inbox.find((entry) => entry.eventId === latest?.id);
  if (!event && latest?.sokoBotId === actor.sokoBotId) {
    const ownEffect = await tx.sokoBotToolCall.findFirst({
      where: {
        turnId: actor.turnId,
        effectEventId: latest.id,
        status: "COMPLETED",
        disposition: "APPLIED",
        verification: "LOCAL_TRANSACTION",
      },
      select: { id: true },
    });
    if (ownEffect) event = inbox[0];
  }
  if (!event) return refuse(SUPERSEDED);

  return claim(
    tx,
    actor,
    taskId,
    event.eventId,
    task.assigneeSokoBotId ?? event.designatedHandlerBotId,
    actionKind,
  );
}

/**
 * The wake reports a Task that BLOCKS this one and is now COMPLETED: starting
 * the blocked Task (Alex's presentation once Hannah's analysis is done) is
 * the follow-up the wake exists for, so it claims under the blocker's event.
 */
async function claimBlockedTask(
  tx: Prisma.TransactionClient,
  actor: { turnId: string; sokoBotId: string; workspaceId: string },
  taskId: string,
  actionKind: string,
): Promise<TaskEventClaim> {
  const blockers = await tx.taskLink.findMany({
    where: {
      toTaskId: taskId,
      type: "BLOCKS",
      fromTask: { workspaceId: actor.workspaceId, status: "COMPLETED" },
    },
    select: { fromTaskId: true },
  });
  if (!blockers.length) return refuse(NOT_IN_WAKE);
  const event = await tx.sokoBotEventInbox.findFirst({
    where: {
      turnId: actor.turnId,
      botId: actor.sokoBotId,
      entityId: { in: blockers.map((link) => link.fromTaskId) },
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
  });
  const task = await tx.task.findFirst({
    where: { id: taskId, workspaceId: actor.workspaceId, archivedAt: null },
    select: { assigneeSokoBotId: true },
  });
  if (!event || !task) return refuse(NOT_IN_WAKE);
  return claim(
    tx,
    actor,
    taskId,
    event.eventId,
    task.assigneeSokoBotId ?? event.designatedHandlerBotId,
    actionKind,
  );
}

async function claim(
  tx: Prisma.TransactionClient,
  actor: { turnId: string; sokoBotId: string },
  taskId: string,
  triggeringEventId: string,
  handler: string | null,
  actionKind: string,
): Promise<TaskEventClaim> {
  if (handler !== actor.sokoBotId) return refuse(OTHER_HANDLER);
  const key = { taskId, triggeringEventId, actionKind };
  const existing = await tx.sokoBotTaskActionClaim.findUnique({
    where: { taskId_triggeringEventId_actionKind: key },
  });
  if (existing) {
    const allowed =
      existing.turnId === actor.turnId &&
      existing.handlerBotId === actor.sokoBotId &&
      !existing.receiptId;
    return {
      allowed,
      claimId: existing.id,
      ...(allowed ? {} : { refusal: SUPERSEDED }),
    };
  }
  const created = await tx.sokoBotTaskActionClaim.create({
    data: { ...key, handlerBotId: actor.sokoBotId, turnId: actor.turnId },
    select: { id: true },
  });
  return { allowed: true, claimId: created.id };
}
