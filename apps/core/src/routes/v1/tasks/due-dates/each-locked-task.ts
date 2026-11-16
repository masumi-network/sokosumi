import * as Sentry from "@sentry/node";
import type { Prisma, Task } from "@sokosumi/database";
import { calendarDateSchema } from "@sokosumi/utils";
import { HTTPException } from "hono/http-exception";

import { requireMutableTaskWriteAccess } from "@/helpers/access-control";
import { lockCalendarScope, lockTaskRows } from "@/helpers/calendar-locks";
import { requireAssignedOrganizationSeat } from "@/helpers/organization-assigned-seat";
import prisma from "@/lib/db/prisma";
import type { UserContext } from "@/middleware/auth";

/** The most Tasks one due-date move or Undo touches. */
export const MAX_DUE_DATE_MOVES = 100;

export const dueDaySchema = calendarDateSchema;

/** Midnight UTC of a `YYYY-MM-DD` day, as the `@db.Date` column stores it. */
export function dueDay(day: string): Date {
  return new Date(`${day}T00:00:00.000Z`);
}

/** `YYYY-MM-DD` of a stored due day. */
export function dueDayString(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * Runs `write` for each Task id, one transaction per Task, under the same
 * access checks and locks as a single due-day PATCH. `write` sees the Task
 * as read after locking and returns its result, or null when the Task is no
 * longer eligible. A Task that fails (no access, parked, another workspace,
 * a database error) is skipped and counted; Tasks already written stay in
 * `done`, so the caller always learns what changed.
 */
export async function eachLockedTask<R>(
  ids: string[],
  {
    userContext,
    workspaceId,
  }: { userContext: UserContext; workspaceId: string },
  write: (tx: Prisma.TransactionClient, task: Task) => Promise<R | null>,
): Promise<{ done: R[]; skipped: number }> {
  const done: R[] = [];
  let skipped = 0;
  for (const id of ids) {
    try {
      const result = await prisma.$transaction(async (tx) => {
        const snapshot = await requireMutableTaskWriteAccess(
          userContext,
          id,
          tx,
        );
        if (
          snapshot.workspaceId !== workspaceId ||
          !(await lockCalendarScope(
            tx,
            workspaceId,
            [snapshot.projectId],
            userContext.userId,
          )) ||
          !(await lockTaskRows(tx, [id]))
        ) {
          return null;
        }
        const task = await requireMutableTaskWriteAccess(userContext, id, tx);
        if (task.workspaceId !== workspaceId) return null;
        if (task.ownerId === userContext.userId) {
          await requireAssignedOrganizationSeat(
            userContext.userId,
            task.organizationId,
            tx,
          );
        }
        return write(tx, task);
      });
      if (result === null) skipped++;
      else done.push(result);
    } catch (error) {
      skipped++;
      // Access and state refusals are expected skips; anything else is a
      // fault worth seeing, but must not hide the Tasks already written.
      if (!(error instanceof HTTPException)) {
        Sentry.captureException(error, {
          tags: { error_type: "task_due_date_move" },
          extra: { taskId: id },
        });
      }
    }
  }
  return { done, skipped };
}
