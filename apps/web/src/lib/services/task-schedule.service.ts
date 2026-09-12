import "server-only";

import { coreClient } from "@/lib/clients/core.client";
import type {
  Task,
  TaskScheduleInput,
  TaskScheduleOccurrence,
  TaskScheduleOccurrenceView,
} from "@/lib/clients/generated/core/types.gen";

export interface ListTaskScheduleOccurrencesParams {
  view: TaskScheduleOccurrenceView;
  cursor?: string | null;
  limit?: number;
}

export interface TaskScheduleOccurrencesPage {
  /** Series revision the page was read at; keys the client's page state. */
  scheduleRevision: number;
  /**
   * Durable future exceptions the next full-series edit or removal would
   * cancel. The edit surface confirms a destructive discard only above zero.
   */
  futureExceptionCount: number;
  occurrences: TaskScheduleOccurrence[];
  nextCursor: string | null;
}

/**
 * One logical user operation: a UUID that survives retries of the same
 * semantic mutation, and the schedule revision that operation was decided on.
 */
export interface TaskScheduleSeriesPrecondition {
  operationId: string;
  expectedScheduleRevision: number;
}

export const taskScheduleService = (() => {
  /**
   * Replaces the rule of a live series. Always confirms the discard: Core
   * starts a new epoch on every full-series edit, so future exceptions cannot
   * survive it and the flag must not claim otherwise.
   */
  async function editCalendarSeries(
    taskId: string,
    precondition: TaskScheduleSeriesPrecondition,
    schedule: TaskScheduleInput,
  ): Promise<Task> {
    const result = await coreClient.putTaskCalendarSchedule(taskId, {
      operationId: precondition.operationId,
      expectedScheduleRevision: precondition.expectedScheduleRevision,
      discardFutureExceptions: true,
      schedule,
    });

    if (!result.data) {
      throw new Error("Failed to save Calendar task schedule");
    }

    return result.data;
  }

  /**
   * The legacy body-compatible write, kept only for arming a schedule on a Task
   * that has none: there is no revision to serialize against yet. Every change
   * to a live series goes through {@link editCalendarSeries}.
   */
  async function setSchedule(
    taskId: string,
    body: TaskScheduleInput,
  ): Promise<Task> {
    const result = await coreClient.putTaskSchedule(taskId, body);

    if (!result.data) {
      throw new Error("Failed to save task schedule");
    }

    return result.data;
  }

  async function removeCalendarSeries(
    taskId: string,
    precondition: TaskScheduleSeriesPrecondition,
  ): Promise<Task> {
    const result = await coreClient.deleteTaskSchedule(taskId, precondition);

    if (!result.data) {
      throw new Error("Failed to clear task schedule");
    }

    return result.data;
  }

  /**
   * Reads one page of the occurrence ledger. Core failures surface as
   * {@link CoreApiRequestError} with their stable `kind` intact — callers match
   * on `schedule_cursor_stale` to discard their pages — so this deliberately
   * does not wrap them in a generic error.
   */
  async function listOccurrences(
    taskId: string,
    params: ListTaskScheduleOccurrencesParams,
  ): Promise<TaskScheduleOccurrencesPage> {
    const result = await coreClient.getTaskScheduleOccurrences(taskId, {
      view: params.view,
      cursor: params.cursor ?? undefined,
      limit: params.limit,
    });

    return {
      scheduleRevision: result.data.scheduleRevision,
      futureExceptionCount: result.data.futureExceptionCount,
      occurrences: result.data.occurrences,
      nextCursor: result.meta?.pagination?.nextCursor ?? null,
    };
  }

  /**
   * Moves one unreleased occurrence to a new absolute time. Core keeps the
   * occurrence's original identity and audits the move; the series revision
   * advances so occurrence cursors refresh.
   */
  async function rescheduleOccurrence(
    taskId: string,
    occurrenceId: string,
    precondition: TaskScheduleSeriesPrecondition,
    scheduledAt: Date,
  ): Promise<{
    scheduleRevision: number;
    occurrence: TaskScheduleOccurrence;
  }> {
    const result = await coreClient.rescheduleTaskScheduleOccurrence(
      taskId,
      occurrenceId,
      {
        operationId: precondition.operationId,
        expectedScheduleRevision: precondition.expectedScheduleRevision,
        scheduledAt,
      },
    );

    return {
      scheduleRevision: result.data.scheduleRevision,
      occurrence: result.data.occurrence,
    };
  }

  return {
    editCalendarSeries,
    setSchedule,
    removeCalendarSeries,
    listOccurrences,
    rescheduleOccurrence,
  };
})();
