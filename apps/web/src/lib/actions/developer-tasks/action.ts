"use server";

import { err, ok } from "neverthrow";

import {
  type ActionResultDto,
  toActionResult,
} from "@/lib/actions/action-result";
import { type ActionError, CommonErrorCode } from "@/lib/actions/errors";
import {
  type DeveloperTaskListPage,
  developerTaskService,
  type ListDeveloperTasksParams,
} from "@/lib/services/developer-task.service";
import {
  type AuthenticatedRequest,
  withSession,
} from "@/middleware/auth-middleware";

function mapError(error: unknown): ActionError {
  return {
    code: CommonErrorCode.INTERNAL_SERVER_ERROR,
    message: error instanceof Error ? error.message : "Failed to list tasks",
  };
}

interface ListDeveloperTasksRequest
  extends AuthenticatedRequest,
    ListDeveloperTasksParams {}

export const listDeveloperTasksAction = withSession<
  ListDeveloperTasksRequest,
  ActionResultDto<DeveloperTaskListPage, ActionError>
>(async ({ cursor, limit, coworkerId }) => {
  try {
    return toActionResult(
      ok(await developerTaskService.listTasks({ cursor, limit, coworkerId })),
    );
  } catch (error) {
    return toActionResult(err(mapError(error)));
  }
});
