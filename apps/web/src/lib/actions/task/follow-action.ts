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

interface FollowTaskParameters extends AuthenticatedRequest {
  taskId: string;
}

/** Follow a Task with your Soko Bot. Does not make you a participant. */
export const followTask = withSession<
  FollowTaskParameters,
  ActionResultDto<{ taskId: string }, ActionError>
>(async ({ taskId }) => {
  try {
    await taskService.followTask(taskId);
  } catch (error) {
    return toActionResult(err(toCoreApiActionError(error)));
  }
  revalidatePath("/tasks/[taskId]", "page");
  return toActionResult(ok({ taskId }));
});

/** Stop following a Task with your Soko Bot; participation is unchanged. */
export const unfollowTask = withSession<
  FollowTaskParameters,
  ActionResultDto<{ taskId: string }, ActionError>
>(async ({ taskId }) => {
  try {
    await taskService.unfollowTask(taskId);
  } catch (error) {
    return toActionResult(err(toCoreApiActionError(error)));
  }
  revalidatePath("/tasks/[taskId]", "page");
  return toActionResult(ok({ taskId }));
});
