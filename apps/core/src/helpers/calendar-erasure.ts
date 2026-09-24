import { type Prisma, TaskX402PaymentStatus } from "@sokosumi/database";

import {
  cancelNotificationEmails,
  EMAILED_NOTIFICATION_COLUMNS,
  type EmailedNotificationRow,
} from "@/helpers/notification-email-dispatch";
import { SWEEPABLE_X402_STATUSES } from "@/helpers/task-deletion-payments";
import { deleteTaskFileIfOwned } from "@/lib/blob";

export type CalendarErasureBlocker =
  | "task_payment_pending"
  | "task_payment_unresolved"
  | "task_payment_authorization_live";

export class CalendarErasureBlockedError extends Error {
  constructor(
    readonly blocker: CalendarErasureBlocker,
    readonly paymentId: string,
    readonly paymentStatus?: string,
  ) {
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
 * canonical Workspace → Project → Task → Run → Task Schedule → child/payment
 * order.
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
    FROM "task_schedule_run" AS occurrence
    WHERE occurrence.id IN (
      SELECT id FROM "task_schedule_run"
      WHERE "sourceWorkspaceId" = ${workspaceId}::UUID
      UNION
      SELECT series_occurrence.id
      FROM "task_schedule_run" AS series_occurrence
      JOIN "task" AS series_task ON series_task.id = series_occurrence."seriesTaskId"
      WHERE series_task."workspaceId" = ${workspaceId}::UUID
      UNION
      SELECT released_occurrence.id
      FROM "task_schedule_run" AS released_occurrence
      JOIN "task" AS released_task ON released_task.id = released_occurrence."releasedTaskId"
      WHERE released_task."workspaceId" = ${workspaceId}::UUID
    )
    ORDER BY occurrence.id ASC
    FOR UPDATE OF occurrence
  `;
  // After the Runs, like the release: it claims a Run, then its schedule.
  await tx.$queryRaw`
    SELECT id
    FROM "task_schedule"
    WHERE "workspaceId" = ${workspaceId}::UUID
    ORDER BY id ASC
    FOR UPDATE
  `;
  await tx.$queryRaw`
    SELECT link.id
    FROM "task_link" AS link
    WHERE link.id IN (
      SELECT source_link.id
      FROM "task_link" AS source_link
      JOIN "task" AS source_task ON source_task.id = source_link."fromTaskId"
      WHERE source_task."workspaceId" = ${workspaceId}::UUID
      UNION
      SELECT target_link.id
      FROM "task_link" AS target_link
      JOIN "task" AS target_task ON target_task.id = target_link."toTaskId"
      WHERE target_task."workspaceId" = ${workspaceId}::UUID
    )
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
    select: { id: true, status: true },
  });
  if (unresolvedPayment) {
    throw new CalendarErasureBlockedError(
      unresolvedPayment.status === TaskX402PaymentStatus.PENDING
        ? "task_payment_pending"
        : "task_payment_unresolved",
      unresolvedPayment.id,
      unresolvedPayment.status,
    );
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
    throw new CalendarErasureBlockedError(
      "task_payment_authorization_live",
      liveAuthorization.id,
    );
  }

  return true;
}

export interface CalendarErasureCleanup {
  scheduledEmails: EmailedNotificationRow[];
  taskFiles: Array<{ fileUrl: string | null; taskId: string }>;
}

/** Run only after the erasure transaction commits. */
export async function cleanupCalendarErasureResources(
  cleanup: CalendarErasureCleanup,
): Promise<void> {
  await Promise.all([
    cancelNotificationEmails(cleanup.scheduledEmails),
    ...cleanup.taskFiles.map((file) =>
      deleteTaskFileIfOwned(file.fileUrl, file.taskId),
    ),
  ]);
}

/** Delete only after locking with lockWorkspaceCalendarForErasure in this transaction. */
export async function eraseWorkspaceCalendarData(
  tx: Prisma.TransactionClient,
  workspaceId: string,
): Promise<CalendarErasureCleanup> {
  // Dispatchers lock members before notifications/outbox rows. Own the members
  // in deletion mode now, before taking those child locks; KEY SHARE would
  // still allow a dispatcher to block the later organization cascade.
  await tx.$queryRaw`
    SELECT "member".id
    FROM "member"
    JOIN "workspace"
      ON "workspace"."organizationId" = "member"."organizationId"
    WHERE "workspace".id = ${workspaceId}::UUID
    ORDER BY "member".id ASC
    FOR UPDATE OF "member"
  `;

  // Fence the dispatcher before reading: its conditional email update must
  // either finish before this read or see a read/deleted notification.
  await tx.notification.updateMany({
    where: { workspaceId },
    data: { isRead: true },
  });
  const scheduledEmails = await tx.notification.findMany({
    where: { workspaceId, emailScheduledAt: { not: null } },
    select: EMAILED_NOTIFICATION_COLUMNS,
  });
  const taskFiles = await tx.taskFile.findMany({
    where: { task: { workspaceId } },
    select: { fileUrl: true, taskId: true },
  });

  await tx.taskScheduleRun.deleteMany({
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
  // Their Runs went with the ledger above (a Run's source is its schedule's
  // workspace). After the Tasks, so no created Task is updated on the way out.
  await tx.taskSchedule.deleteMany({ where: { workspaceId } });
  await tx.projectEvent.deleteMany({ where: { project: { workspaceId } } });
  await tx.projectCloseOperation.deleteMany({
    where: { project: { workspaceId } },
  });
  await tx.project.deleteMany({ where: { workspaceId } });
  await tx.notification.deleteMany({ where: { workspaceId } });
  await tx.calendarInvalidationOutbox.deleteMany({ where: { workspaceId } });
  return { scheduledEmails, taskFiles };
}
