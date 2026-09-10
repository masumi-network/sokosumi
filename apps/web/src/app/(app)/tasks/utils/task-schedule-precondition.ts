import "server-only";

import { hasActiveTaskSchedule } from "@sokosumi/utils";

import type { Task } from "@/lib/clients/generated/core";
import { taskScheduleService } from "@/lib/services/task-schedule.service";

export interface TaskScheduleSeriesPreconditionView {
  /** Revision every schedule write from this render must send. */
  scheduleRevision: number;
  /**
   * Durable future exceptions a full-series edit would cancel, or `null` when
   * the ledger could not be read. `null` is not zero: it means the surface
   * cannot tell the user what a full-series edit would destroy.
   */
  futureExceptionCount: number | null;
}

/**
 * Reads what an edit surface needs before it may change a live series.
 *
 * The occurrence endpoint owns both values, so one bounded page read supplies
 * them. A Task with no live rule needs no read: it has nothing to discard, and
 * its own `scheduleRevision` is already the precondition for arming one.
 *
 * A failed read keeps the Task's own revision — non-destructive field edits and
 * the always-confirmed removal still work — but reports the count as unknown so
 * no caller can mistake it for "nothing would be discarded".
 */
export async function readTaskScheduleSeriesPrecondition(
  task: Task,
): Promise<TaskScheduleSeriesPreconditionView> {
  const taskRevision = task.scheduleRevision ?? 0;

  if (!hasActiveTaskSchedule(task.metadata, task.nextRunAt)) {
    return { scheduleRevision: taskRevision, futureExceptionCount: 0 };
  }

  try {
    const page = await taskScheduleService.listOccurrences(task.id, {
      view: "upcoming",
      limit: 1,
    });
    if (page.scheduleRevision !== taskRevision) {
      return { scheduleRevision: taskRevision, futureExceptionCount: null };
    }
    return {
      scheduleRevision: taskRevision,
      futureExceptionCount: page.futureExceptionCount,
    };
  } catch (error) {
    console.error("Failed to read the schedule series precondition", error);
    return { scheduleRevision: taskRevision, futureExceptionCount: null };
  }
}
