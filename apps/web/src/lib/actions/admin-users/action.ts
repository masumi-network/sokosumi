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
  type AdminUserOverviewPage,
  adminUserService,
  type ListAdminUsersParams,
} from "@/lib/services/admin-user.service";
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
    message: error instanceof Error ? error.message : "Failed to list users",
  };
}

interface ListAdminUsersRequest
  extends AuthenticatedRequest,
    ListAdminUsersParams {}

export const listAdminUsersAction = withSession<
  ListAdminUsersRequest,
  ActionResultDto<AdminUserOverviewPage, ActionError>
>(async ({ session, query, cursor, limit }) => {
  try {
    assertAdminSession(session);
    return toActionResult(
      ok(await adminUserService.listUsers({ query, cursor, limit })),
    );
  } catch (error) {
    return toActionResult(err(mapError(error)));
  }
});
