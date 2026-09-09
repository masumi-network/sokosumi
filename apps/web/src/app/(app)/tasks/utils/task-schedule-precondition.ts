import "server-only";

import { hasActiveTaskSchedule } from "@sokosumi/utils";

import type { Task } from "@/lib/clients/generated/core";
import { taskScheduleService } from "@/lib/services/task-schedule.service";

export interface TaskScheduleSeriesPreconditionView {
  /** Revision every schedule write from this render must send. */
  scheduleRevision: number;
  /** Durable future exceptions a full-series edit would cancel. */
  futureExceptionCount: number;
}

/**
 * Reads what an edit surface needs before it may change a live series.
 *
 * The occurrence endpoint owns both values, so one bounded page read supplies
 * them. A Task with no live rule needs no read: it has nothing to discard, and
 * its own `scheduleRevision` is already the precondition for arming one.
 *
 * The read is Calendar-beta gated while schedule removal deliberately is not,
 * so a rejected read degrades to the Task's revision and no discard warning
 * rather than blocking the edit surface. Only SOK-885/886 create exceptions,
 * and both are beta features, so a non-beta series has none.
 */
export async function readTaskScheduleSeriesPrecondition(
  task: Task,
): Promise<TaskScheduleSeriesPreconditionView> {
  const fallback = {
    scheduleRevision: task.scheduleRevision ?? 0,
    futureExceptionCount: 0,
  };

  if (!hasActiveTaskSchedule(task.metadata, task.nextRunAt)) {
    return fallback;
  }

  try {
    const page = await taskScheduleService.listOccurrences(task.id, {
      view: "upcoming",
      limit: 1,
    });
    return {
      scheduleRevision: page.scheduleRevision,
      futureExceptionCount: page.futureExceptionCount,
    };
  } catch (error) {
    console.error("Failed to read the schedule series precondition", error);
    return fallback;
  }
}
