"use server";

import { err, ok } from "neverthrow";

import {
  type ActionResultDto,
  toActionResult,
} from "@/lib/actions/action-result";
import { type ActionError, CommonErrorCode } from "@/lib/actions/errors";
import { assertAdminSession } from "@/lib/auth/admin-access";
import { isAdminAccessRequiredError } from "@/lib/auth/errors";
import {
  type AdminTaskListPage,
  adminTaskService,
  type ListAdminTasksParams,
} from "@/lib/services/admin-task.service";
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
  ActionResultDto<AdminTaskListPage, ActionError>
>(async ({ session, query, cursor, limit }) => {
  try {
    assertAdminSession(session);
    return toActionResult(
      ok(await adminTaskService.listTasks({ query, cursor, limit })),
    );
  } catch (error) {
    return toActionResult(err(mapError(error)));
  }
});
