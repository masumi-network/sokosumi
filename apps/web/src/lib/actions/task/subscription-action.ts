"use server";

import { err, ok } from "neverthrow";
import { revalidatePath } from "next/cache";
import {
  type ActionResultDto,
  toActionResult,
} from "@/lib/actions/action-result";
import type { ActionError } from "@/lib/actions/errors/action-error";
import { toCoreApiActionError } from "@/lib/clients/core.client";
import { taskService } from "@/lib/services/task.service";
import {
  type AuthenticatedRequest,
  withSession,
} from "@/middleware/auth-middleware";

interface UnsubscribeTaskParameters extends AuthenticatedRequest {
  taskId: string;
}

/** Stop following a Task with your Soko Bot; you stay a participant. */
export const unsubscribeTask = withSession<
  UnsubscribeTaskParameters,
  ActionResultDto<{ taskId: string }, ActionError>
>(async ({ taskId }) => {
  try {
    await taskService.unsubscribeTask(taskId);
  } catch (error) {
    return toActionResult(err(toCoreApiActionError(error)));
  }
  revalidatePath("/tasks/[taskId]", "page");
  return toActionResult(ok({ taskId }));
});
