"use server";

import { type ActionError, CommonErrorCode } from "@/lib/actions/errors";
import { assertAdminSession } from "@/lib/auth/admin-access";
import { isAdminAccessRequiredError } from "@/lib/auth/errors";
import {
  type AdminTaskListPage,
  adminTaskService,
  type ListAdminTasksParams,
} from "@/lib/services/admin-task.service";
import { Err, Ok, type Result } from "@/lib/ts-res";
import {
  type AuthenticatedRequest,
  withSession,
} from "@/middleware/auth-middleware";

function mapError(error: unknown): ActionError {
  if (isAdminAccessRequiredError(error)) {
    return {
      code: CommonErrorCode.UNAUTHORIZED,
      message: error.message,
    };
  }

  return {
    code: CommonErrorCode.INTERNAL_SERVER_ERROR,
    message: error instanceof Error ? error.message : "Failed to list tasks",
  };
}

interface ListAdminTasksRequest
  extends AuthenticatedRequest,
    ListAdminTasksParams {}

export const listAdminTasksAction = withSession<
  ListAdminTasksRequest,
  Result<AdminTaskListPage, ActionError>
>(async ({ session, query, cursor, limit }) => {
  try {
    assertAdminSession(session);
    return Ok(await adminTaskService.listTasks({ query, cursor, limit }));
  } catch (error) {
    return Err(mapError(error));
  }
});
