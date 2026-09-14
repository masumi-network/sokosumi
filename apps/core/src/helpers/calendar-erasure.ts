import type { Prisma } from "@sokosumi/database";

import { SWEEPABLE_X402_STATUSES } from "@/helpers/task-deletion-payments";

export type CalendarErasureBlocker =
  | "task_payment_unresolved"
  | "task_payment_authorization_live";

export class CalendarErasureBlockedError extends Error {
  constructor(readonly blocker: CalendarErasureBlocker) {
    super(blocker);
    this.name = "CalendarErasureBlockedError";
  }
}

export async function lockCalendarErasureUser(
  tx: Prisma.TransactionClient,
  userId: string,
): Promise<boolean> {
  const user = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT id
    FROM "user"
    WHERE id = ${userId}
    FOR UPDATE
  `;
  return user.length === 1;
}

/**
 * Lock Calendar-owned data for one Workspace inside its parent's deletion
 * transaction. Callers lock the acting User first; this helper then owns the
 * canonical Workspace → Project → Task → child/payment order.
 */
export async function lockWorkspaceCalendarForErasure(
  tx: Prisma.TransactionClient,
  workspaceId: string,
): Promise<boolean> {
  const workspace = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT id
    FROM "workspace"
    WHERE id = ${workspaceId}::UUID
    FOR UPDATE
  `;
  if (workspace.length === 0) {
    return false;
  }

  await tx.$queryRaw`
    SELECT id
    FROM "project"
    WHERE "workspaceId" = ${workspaceId}::UUID
    ORDER BY id ASC
    FOR UPDATE
  `;
  await tx.$queryRaw`
    SELECT id
    FROM "task"
    WHERE "workspaceId" = ${workspaceId}::UUID
    ORDER BY id ASC
    FOR UPDATE
  `;
  await tx.$queryRaw`
    SELECT occurrence.id
    FROM "task_schedule_occurrence" AS occurrence
    LEFT JOIN "task" AS series_task
      ON series_task.id = occurrence."seriesTaskId"
    LEFT JOIN "task" AS released_task
      ON released_task.id = occurrence."releasedTaskId"
    WHERE occurrence."sourceWorkspaceId" = ${workspaceId}::UUID
      OR series_task."workspaceId" = ${workspaceId}::UUID
      OR released_task."workspaceId" = ${workspaceId}::UUID
    ORDER BY occurrence.id ASC
    FOR UPDATE OF occurrence
  `;
  await tx.$queryRaw`
    SELECT link.id
    FROM "task_link" AS link
    JOIN "task" AS source_task ON source_task.id = link."fromTaskId"
    JOIN "task" AS target_task ON target_task.id = link."toTaskId"
    WHERE source_task."workspaceId" = ${workspaceId}::UUID
      OR target_task."workspaceId" = ${workspaceId}::UUID
    ORDER BY link.id ASC
    FOR UPDATE OF link
  `;
  await tx.$queryRaw`
    SELECT payment.id
    FROM "task_x402_payment" AS payment
    JOIN "task" AS payment_task ON payment_task.id = payment."taskId"
    WHERE payment_task."workspaceId" = ${workspaceId}::UUID
    ORDER BY payment.id ASC
    FOR UPDATE OF payment
  `;

  const unresolvedPayment = await tx.taskX402Payment.findFirst({
    where: {
      task: { workspaceId },
      status: { notIn: SWEEPABLE_X402_STATUSES },
    },
    select: { id: true },
  });
  if (unresolvedPayment) {
    throw new CalendarErasureBlockedError("task_payment_unresolved");
  }

  const liveAuthorization = await tx.taskX402Payment.findFirst({
    where: {
      task: { workspaceId },
      xPaymentHeader: { not: null },
      OR: [{ validBefore: null }, { validBefore: { gt: new Date() } }],
    },
    select: { id: true },
  });
  if (liveAuthorization) {
    throw new CalendarErasureBlockedError("task_payment_authorization_live");
  }

  return true;
}

/** Delete only after locking with lockWorkspaceCalendarForErasure in this transaction. */
export async function eraseWorkspaceCalendarData(
  tx: Prisma.TransactionClient,
  workspaceId: string,
): Promise<void> {
  await tx.taskScheduleOccurrence.deleteMany({
    where: {
      OR: [
        { sourceWorkspaceId: workspaceId },
        { seriesTask: { workspaceId } },
        { releasedTask: { workspaceId } },
      ],
    },
  });
  await tx.taskLink.deleteMany({
    where: {
      OR: [{ fromTask: { workspaceId } }, { toTask: { workspaceId } }],
    },
  });
  await tx.taskX402Payment.deleteMany({
    where: {
      task: { workspaceId },
      status: { in: SWEEPABLE_X402_STATUSES },
    },
  });
  await tx.taskScheduleQuarantine.deleteMany({
    where: { task: { workspaceId } },
  });
  await tx.taskScheduleCreateOperation.deleteMany({ where: { workspaceId } });
  await tx.taskEvent.deleteMany({ where: { task: { workspaceId } } });
  await tx.task.deleteMany({ where: { workspaceId } });
  await tx.projectEvent.deleteMany({ where: { project: { workspaceId } } });
  await tx.projectCloseOperation.deleteMany({
    where: { project: { workspaceId } },
  });
  await tx.project.deleteMany({ where: { workspaceId } });
  await tx.notification.deleteMany({ where: { workspaceId } });
  await tx.calendarInvalidationOutbox.deleteMany({ where: { workspaceId } });
}
