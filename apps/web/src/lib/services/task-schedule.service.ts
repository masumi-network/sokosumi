import "server-only";

import { coreClient } from "@/lib/clients/core.client";
import type {
  PutTaskScheduleRequest,
  Task,
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
  occurrences: TaskScheduleOccurrence[];
  nextCursor: string | null;
}

export const taskScheduleService = (() => {
  async function setCalendarSchedule(
    taskId: string,
    body: PutTaskScheduleRequest,
  ): Promise<Task> {
    const result = await coreClient.putTaskCalendarSchedule(taskId, body);

    if (!result.data) {
      throw new Error("Failed to save Calendar task schedule");
    }

    return result.data;
  }

  async function setSchedule(
    taskId: string,
    body: PutTaskScheduleRequest,
  ): Promise<Task> {
    const result = await coreClient.putTaskSchedule(taskId, body);

    if (!result.data) {
      throw new Error("Failed to save task schedule");
    }

    return result.data;
  }

  async function clearSchedule(taskId: string): Promise<Task> {
    const result = await coreClient.deleteTaskSchedule(taskId);

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
      occurrences: result.data.occurrences,
      nextCursor: result.meta?.pagination?.nextCursor ?? null,
    };
  }

  return {
    setCalendarSchedule,
    setSchedule,
    clearSchedule,
    listOccurrences,
  };
})();
