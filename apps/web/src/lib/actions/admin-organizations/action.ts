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
  type AdminOrganizationMemberOverviewPage,
  type AdminOrganizationOverviewPage,
  adminOrganizationService,
  type ListAdminOrganizationMembersParams,
  type ListAdminOrganizationsParams,
} from "@/lib/services/admin-organization.service";
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
  ActionResultDto<AdminOrganizationOverviewPage, ActionError>
>(async ({ session, query, cursor, limit }) => {
  try {
    assertAdminSession(session);
    return toActionResult(
      ok(
        await adminOrganizationService.listOrganizations({
          query,
          cursor,
          limit,
        }),
      ),
    );
  } catch (error) {
    return toActionResult(err(mapError(error)));
  }
});

interface ListAdminOrganizationMembersRequest
  extends AuthenticatedRequest,
    ListAdminOrganizationMembersParams {
  slug: string;
}

export const listAdminOrganizationMembersAction = withSession<
  ListAdminOrganizationMembersRequest,
  ActionResultDto<AdminOrganizationMemberOverviewPage, ActionError>
>(async ({ session, slug, cursor, limit }) => {
  try {
    assertAdminSession(session);
    return toActionResult(
      ok(
        await adminOrganizationService.listOrganizationMembers(slug, {
          cursor,
          limit,
        }),
      ),
    );
  } catch (error) {
    return toActionResult(err(mapError(error)));
  }
});
