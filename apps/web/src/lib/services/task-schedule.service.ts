import "server-only";

import { coreClient } from "@/lib/clients/core.client";
import type {
  PutTaskScheduleRequest,
  Task,
} from "@/lib/clients/generated/core/types.gen";

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

  return {
    setCalendarSchedule,
    setSchedule,
    clearSchedule,
  };
})();
