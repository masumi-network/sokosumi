import "server-only";

import { CoreApiRequestError, coreClient } from "@/lib/clients/core.client";
import type {
  CalendarTaskScheduleSource,
  CreateTaskScheduleRequest,
  MutateTaskScheduleOccurrenceRequest,
  Task,
  TaskSchedule,
  TaskScheduleInput,
  TaskScheduleOccurrence,
  TaskScheduleOccurrenceView,
  TaskScheduleRun,
  TaskScheduleSourceMutation,
  TaskScheduleState,
  UpdateTaskScheduleRequest,
} from "@/lib/clients/generated/core/types.gen";

export type TaskScheduleStateAction = "pause" | "resume" | "end";

export interface ListTaskSchedulesParams {
  projectId?: string | null;
  state?: TaskScheduleState | null;
  cursor?: string | null;
  limit?: number;
}

export interface TaskSchedulesPage {
  schedules: TaskSchedule[];
  nextCursor: string | null;
}

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

export interface TaskScheduleSeriesState {
  scheduleRevision: number;
  futureExceptionCount: number;
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

  async function moveCalendarSeriesSource(
    taskId: string,
    precondition: TaskScheduleSeriesPrecondition,
    source: CalendarTaskScheduleSource,
  ): Promise<TaskScheduleSourceMutation> {
    const result = await coreClient.putTaskCalendarSource(taskId, {
      operationId: precondition.operationId,
      expectedScheduleRevision: precondition.expectedScheduleRevision,
      discardFutureExceptions: true,
      source,
    });

    if (!result.data) {
      throw new Error("Failed to move Calendar task source");
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

  async function readSeriesState(
    taskId: string,
  ): Promise<TaskScheduleSeriesState> {
    const page = await listOccurrences(taskId, {
      view: "upcoming",
      limit: 1,
    });
    return {
      scheduleRevision: page.scheduleRevision,
      futureExceptionCount: page.futureExceptionCount,
    };
  }

  /** Changes one unreleased occurrence without changing its stable identity. */
  async function mutateOccurrence(
    taskId: string,
    occurrenceId: string,
    mutation: MutateTaskScheduleOccurrenceRequest,
  ): Promise<{
    scheduleRevision: number;
    occurrence: TaskScheduleOccurrence;
  }> {
    const result = await coreClient.mutateTaskScheduleOccurrence(
      taskId,
      occurrenceId,
      mutation,
    );

    return {
      scheduleRevision: result.data.scheduleRevision,
      occurrence: result.data.occurrence,
    };
  }

  async function listSchedules(
    params: ListTaskSchedulesParams = {},
  ): Promise<TaskSchedulesPage> {
    const result = await coreClient.listTaskSchedules({
      projectId: params.projectId ?? undefined,
      state: params.state ?? undefined,
      cursor: params.cursor ?? undefined,
      limit: params.limit,
    });
    return {
      schedules: result.data,
      nextCursor: result.meta?.pagination?.nextCursor ?? null,
    };
  }

  /** Null when the schedule is gone or the viewer may not read it. */
  async function getSchedule(id: string): Promise<TaskSchedule | null> {
    try {
      const result = await coreClient.getTaskSchedule(id);
      return result.data;
    } catch (error) {
      if (
        error instanceof CoreApiRequestError &&
        (error.status === 404 || error.status === 403)
      ) {
        return null;
      }
      throw error;
    }
  }

  async function createSchedule(
    body: CreateTaskScheduleRequest,
  ): Promise<TaskSchedule> {
    return (await coreClient.createTaskSchedule(body)).data;
  }

  async function updateSchedule(
    id: string,
    body: UpdateTaskScheduleRequest,
  ): Promise<TaskSchedule> {
    return (await coreClient.updateTaskSchedule(id, body)).data;
  }

  async function changeScheduleState(
    id: string,
    action: TaskScheduleStateAction,
  ): Promise<TaskSchedule> {
    return (await coreClient.changeTaskScheduleState(id, action)).data;
  }

  async function deleteSchedule(id: string): Promise<void> {
    await coreClient.deleteTaskScheduleById(id);
  }

  /** The next Runs from `from` on, in time order. */
  async function listUpcomingRuns(
    id: string,
    params: { from: Date; limit: number },
  ): Promise<TaskScheduleRun[]> {
    const result = await coreClient.listTaskScheduleRuns(id, {
      from: params.from,
      limit: params.limit,
    });
    return result.data;
  }

  return {
    editCalendarSeries,
    moveCalendarSeriesSource,
    setSchedule,
    removeCalendarSeries,
    listOccurrences,
    readSeriesState,
    mutateOccurrence,
    listSchedules,
    getSchedule,
    createSchedule,
    updateSchedule,
    changeScheduleState,
    deleteSchedule,
    listUpcomingRuns,
  };
})();
