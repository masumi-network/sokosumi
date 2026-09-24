import "server-only";

import { CoreApiRequestError, coreClient } from "@/lib/clients/core.client";
import type { TaskScheduleStateAction } from "@/lib/clients/core.shared";
import type {
  CreateTaskScheduleRequest,
  TaskSchedule,
  TaskScheduleRun,
  TaskScheduleRunUpdate,
  TaskScheduleState,
  UpdateTaskScheduleRequest,
  UpdateTaskScheduleRunRequest,
} from "@/lib/clients/generated/core/types.gen";

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

export const taskScheduleService = (() => {
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

  /** Skips, moves, or restores one upcoming Run; the rule stays as it is. */
  async function changeRun(
    id: string,
    runId: string,
    body: UpdateTaskScheduleRunRequest,
  ): Promise<TaskScheduleRunUpdate> {
    return (await coreClient.changeTaskScheduleRun(id, runId, body)).data;
  }

  return {
    listSchedules,
    getSchedule,
    createSchedule,
    updateSchedule,
    changeScheduleState,
    deleteSchedule,
    listUpcomingRuns,
    changeRun,
  };
})();
