"use server";

import { type ActionError, CommonErrorCode } from "@/lib/actions/errors";
import { assertAdminSession } from "@/lib/auth/admin-access";
import { isAdminAccessRequiredError } from "@/lib/auth/errors";
import {
  type AdminOrganizationOverviewPage,
  adminOrganizationService,
  type ListAdminOrganizationsParams,
} from "@/lib/services/admin-organization.service";
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
    message:
      error instanceof Error ? error.message : "Failed to list organizations",
  };
}

interface ListAdminOrganizationsRequest
  extends AuthenticatedRequest,
    ListAdminOrganizationsParams {}

export const listAdminOrganizationsAction = withSession<
  ListAdminOrganizationsRequest,
  Result<AdminOrganizationOverviewPage, ActionError>
>(async ({ session, query, cursor, limit }) => {
  try {
    assertAdminSession(session);
    return Ok(
      await adminOrganizationService.listOrganizations({
        query,
        cursor,
        limit,
      }),
    );
  } catch (error) {
    return Err(mapError(error));
  }
});
