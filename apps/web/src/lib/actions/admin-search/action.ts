"use server";

import { type ActionError, CommonErrorCode } from "@/lib/actions/errors";
import { assertAdminSession } from "@/lib/auth/admin-access";
import { isAdminAccessRequiredError } from "@/lib/auth/errors";
import {
  type AdminOrganizationOption,
  adminOrganizationService,
} from "@/lib/services/admin-organization.service";
import {
  type AdminUserOption,
  adminUserService,
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
    message: error instanceof Error ? error.message : "Failed to search",
  };
}

interface SearchParameters extends AuthenticatedRequest {
  query: string;
}

export const searchUsersAction = withSession<
  SearchParameters,
  Result<AdminUserOption[], ActionError>
>(async ({ session, query }) => {
  try {
    assertAdminSession(session);
    return Ok(await adminUserService.searchUsers(query));
  } catch (error) {
    return Err(mapError(error));
  }
});

export const searchOrganizationsAction = withSession<
  SearchParameters,
  Result<AdminOrganizationOption[], ActionError>
>(async ({ session, query }) => {
  try {
    assertAdminSession(session);
    return Ok(await adminOrganizationService.searchOrganizations(query));
  } catch (error) {
    return Err(mapError(error));
  }
});
