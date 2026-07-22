"use server";

import { type ActionError, CommonErrorCode } from "@/lib/actions/errors";
import {
  type DeveloperTaskListPage,
  developerTaskService,
  type ListDeveloperTasksParams,
} from "@/lib/services/developer-task.service";
import { Err, Ok, type Result } from "@/lib/ts-res";
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
  Result<DeveloperTaskListPage, ActionError>
>(async ({ cursor, limit, coworkerId }) => {
  try {
    return Ok(
      await developerTaskService.listTasks({ cursor, limit, coworkerId }),
    );
  } catch (error) {
    return Err(mapError(error));
  }
});
