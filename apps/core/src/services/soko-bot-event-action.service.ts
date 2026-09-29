import type { Prisma } from "@sokosumi/database";

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
): Promise<{ allowed: boolean; claimId: string | null }> {
  if (actor.source !== "EVENT") return { allowed: true, claimId: null };
  const inbox = await tx.sokoBotEventInbox.findMany({
    where: { turnId: actor.turnId, botId: actor.sokoBotId, entityId: taskId },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
  });
  if (!inbox.length) return { allowed: false, claimId: null };
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
  if (!task) return { allowed: false, claimId: null };
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
  if (!event) return { allowed: false, claimId: null };

  const handler = task.assigneeSokoBotId ?? event.designatedHandlerBotId;
  if (handler !== actor.sokoBotId) return { allowed: false, claimId: null };
  const key = { taskId, triggeringEventId: event.eventId, actionKind };
  const existing = await tx.sokoBotTaskActionClaim.findUnique({
    where: { taskId_triggeringEventId_actionKind: key },
  });
  if (existing) {
    return {
      allowed:
        existing.turnId === actor.turnId &&
        existing.handlerBotId === actor.sokoBotId &&
        !existing.receiptId,
      claimId: existing.id,
    };
  }
  const claim = await tx.sokoBotTaskActionClaim.create({
    data: { ...key, handlerBotId: actor.sokoBotId, turnId: actor.turnId },
    select: { id: true },
  });
  return { allowed: true, claimId: claim.id };
}
