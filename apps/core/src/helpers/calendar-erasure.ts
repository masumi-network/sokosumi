import { type Prisma, TaskX402PaymentStatus } from "@sokosumi/database";
import { netTable, netType, sharedTable } from "@sokosumi/database/sql-tables";

import {
  cancelNotificationEmails,
  EMAILED_NOTIFICATION_COLUMNS,
  type EmailedNotificationRow,
} from "@/helpers/notification-email-dispatch";
import { SWEEPABLE_X402_STATUSES } from "@/helpers/task-deletion-payments";
import { deleteTaskFileIfOwned } from "@/lib/blob";
import { networksThatAreOn } from "@/lib/network";

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
    FROM ${sharedTable("user")}
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
    FROM ${sharedTable("workspace")}
    WHERE id = ${workspaceId}::UUID
    FOR UPDATE
  `;
  if (workspace.length === 0) {
    return false;
  }

  await tx.$queryRaw`
    SELECT id
    FROM ${sharedTable("project")}
    WHERE "workspaceId" = ${workspaceId}::UUID
    ORDER BY id ASC
    FOR UPDATE
  `;
  await tx.$queryRaw`
    SELECT id
    FROM ${sharedTable("task")}
    WHERE "workspaceId" = ${workspaceId}::UUID
    ORDER BY id ASC
    FOR UPDATE
  `;
  await tx.$queryRaw`
    SELECT run.id
    FROM ${sharedTable("task_schedule_run")} AS run
    WHERE run.id IN (
      SELECT id FROM ${sharedTable("task_schedule_run")}
      WHERE "sourceWorkspaceId" = ${workspaceId}::UUID
      UNION
      SELECT released_run.id
      FROM ${sharedTable("task_schedule_run")} AS released_run
      JOIN ${sharedTable("task")} AS released_task ON released_task.id = released_run."releasedTaskId"
      WHERE released_task."workspaceId" = ${workspaceId}::UUID
    )
    ORDER BY run.id ASC
    FOR UPDATE OF run
  `;
  // After the Runs, like the release: it claims a Run, then its schedule.
  await tx.$queryRaw`
    SELECT id
    FROM ${sharedTable("task_schedule")}
    WHERE "workspaceId" = ${workspaceId}::UUID
    ORDER BY id ASC
    FOR UPDATE
  `;
  await tx.$queryRaw`
    SELECT link.id
    FROM ${sharedTable("task_link")} AS link
    WHERE link.id IN (
      SELECT source_link.id
      FROM ${sharedTable("task_link")} AS source_link
      JOIN ${sharedTable("task")} AS source_task ON source_task.id = source_link."fromTaskId"
      WHERE source_task."workspaceId" = ${workspaceId}::UUID
      UNION
      SELECT target_link.id
      FROM ${sharedTable("task_link")} AS target_link
      JOIN ${sharedTable("task")} AS target_task ON target_task.id = target_link."toTaskId"
      WHERE target_task."workspaceId" = ${workspaceId}::UUID
    )
    ORDER BY link.id ASC
    FOR UPDATE OF link
  `;
  // The payments are a Network's rows: every statement on them runs once per
  // Network that is on, in raw SQL, because `tx` is on the shared client.
  const networks = networksThatAreOn();
  for (const network of networks) {
    await tx.$queryRaw`
      SELECT payment.id
      FROM ${netTable(network, "task_x402_payment")} AS payment
      JOIN ${sharedTable("task")} AS payment_task ON payment_task.id = payment."taskId"
      WHERE payment_task."workspaceId" = ${workspaceId}::UUID
      ORDER BY payment.id ASC
      FOR UPDATE OF payment
    `;
  }

  for (const network of networks) {
    const [unresolvedPayment] = await tx.$queryRaw<
      { id: string; status: string }[]
    >`
      SELECT payment.id, payment.status::text AS status
      FROM ${netTable(network, "task_x402_payment")} AS payment
      JOIN ${sharedTable("task")} AS payment_task ON payment_task.id = payment."taskId"
      WHERE payment_task."workspaceId" = ${workspaceId}::UUID
        AND payment.status <> ALL(${SWEEPABLE_X402_STATUSES}::${netType(network, "TaskX402PaymentStatus")}[])
      LIMIT 1
    `;
    if (unresolvedPayment) {
      throw new CalendarErasureBlockedError(
        unresolvedPayment.status === TaskX402PaymentStatus.PENDING
          ? "task_payment_pending"
          : "task_payment_unresolved",
        unresolvedPayment.id,
        unresolvedPayment.status,
      );
    }
  }

  for (const network of networks) {
    const [liveAuthorization] = await tx.$queryRaw<{ id: string }[]>`
      SELECT payment.id
      FROM ${netTable(network, "task_x402_payment")} AS payment
      JOIN ${sharedTable("task")} AS payment_task ON payment_task.id = payment."taskId"
      WHERE payment_task."workspaceId" = ${workspaceId}::UUID
        AND payment."xPaymentHeader" IS NOT NULL
        AND (payment."validBefore" IS NULL OR payment."validBefore" > ${new Date()}::timestamp)
      LIMIT 1
    `;
    if (liveAuthorization) {
      throw new CalendarErasureBlockedError(
        "task_payment_authorization_live",
        liveAuthorization.id,
      );
    }
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
    FROM ${sharedTable("member")}
    JOIN ${sharedTable("workspace")}
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
        { releasedTask: { workspaceId } },
      ],
    },
  });
  await tx.taskLink.deleteMany({
    where: {
      OR: [{ fromTask: { workspaceId } }, { toTask: { workspaceId } }],
    },
  });
  for (const network of networksThatAreOn()) {
    await tx.$executeRaw`
      DELETE FROM ${netTable(network, "task_x402_payment")} AS payment
      USING ${sharedTable("task")} AS payment_task
      WHERE payment_task.id = payment."taskId"
        AND payment_task."workspaceId" = ${workspaceId}::UUID
        AND payment.status = ANY(${SWEEPABLE_X402_STATUSES}::${netType(network, "TaskX402PaymentStatus")}[])
    `;
  }
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
