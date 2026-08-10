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
  type AdminOrganizationOption,
  adminOrganizationService,
} from "@/lib/services/admin-organization.service";
import {
  type AdminUserOption,
  adminUserService,
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
    message: error instanceof Error ? error.message : "Failed to search",
  };
}

interface SearchParameters extends AuthenticatedRequest {
  query: string;
}

export const searchUsersAction = withSession<
  SearchParameters,
  ActionResultDto<AdminUserOption[], ActionError>
>(async ({ session, query }) => {
  try {
    assertAdminSession(session);
    return toActionResult(ok(await adminUserService.searchUsers(query)));
  } catch (error) {
    return toActionResult(err(mapError(error)));
  }
});

export const searchOrganizationsAction = withSession<
  SearchParameters,
  ActionResultDto<AdminOrganizationOption[], ActionError>
>(async ({ session, query }) => {
  try {
    assertAdminSession(session);
    return toActionResult(
      ok(await adminOrganizationService.searchOrganizations(query)),
    );
  } catch (error) {
    return toActionResult(err(mapError(error)));
  }
});
