"use server";

import { type ActionError, CommonErrorCode } from "@/lib/actions/errors";
import { assertAdminSession } from "@/lib/auth/admin-access";
import { isAdminAccessRequiredError } from "@/lib/auth/errors";
import {
  type AdminUserOverviewPage,
  adminUserService,
  type ListAdminUsersParams,
} from "@/lib/services/admin-user.service";
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
    message: error instanceof Error ? error.message : "Failed to list users",
  };
}

interface ListAdminUsersRequest
  extends AuthenticatedRequest,
    ListAdminUsersParams {}

export const listAdminUsersAction = withSession<
  ListAdminUsersRequest,
  Result<AdminUserOverviewPage, ActionError>
>(async ({ session, query, cursor, limit }) => {
  try {
    assertAdminSession(session);
    return Ok(await adminUserService.listUsers({ query, cursor, limit }));
  } catch (error) {
    return Err(mapError(error));
  }
});
