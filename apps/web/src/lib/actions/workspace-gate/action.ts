"use server";

import { err, ok } from "neverthrow";

import {
  type ActionResultDto,
  toActionResult,
} from "@/lib/actions/action-result";
import {
  type ActionError,
  CommonErrorCode,
  WorkspaceGateErrorCode,
} from "@/lib/actions/errors";
import { CoreApiRequestError, coreClient } from "@/lib/clients/core.client";
import type { PersonalWorkspaceCreated } from "@/lib/clients/generated/core";
import { clearPendingOrganizationJoinToken } from "@/lib/pending-organization-join-cookie";
import {
  type AuthenticatedRequest,
  withSession,
} from "@/middleware/auth-middleware";

function toCreatePersonalWorkspaceError(error: unknown): ActionError {
  if (error instanceof CoreApiRequestError) {
    if (error.status === 409) {
      return {
        code: WorkspaceGateErrorCode.PERSONAL_WORKSPACE_ALREADY_EXISTS,
        message: error.message,
      };
    }
    if (error.status === 401) {
      return { code: CommonErrorCode.UNAUTHENTICATED, message: error.message };
    }
    if (error.status === 403) {
      return { code: CommonErrorCode.UNAUTHORIZED, message: error.message };
    }
    if (error.status === 404) {
      return { code: CommonErrorCode.NOT_FOUND, message: error.message };
    }
    if (error.status === 400) {
      return { code: CommonErrorCode.BAD_INPUT, message: error.message };
    }
  }

  return {
    code: CommonErrorCode.INTERNAL_SERVER_ERROR,
    message: error instanceof Error ? error.message : undefined,
  };
}

/**
 * Create exactly one personal workspace for the signed-in user.
 * Core clears preferredOrganizationId on success; 409 when one already exists.
 */
export const createPersonalWorkspaceAction = withSession<
  AuthenticatedRequest,
  ActionResultDto<PersonalWorkspaceCreated, ActionError>
>(async () => {
  try {
    const { data } = await coreClient.createMyPersonalWorkspace();
    return toActionResult(ok(data));
  } catch (error) {
    console.error("Failed to create personal workspace", error);
    return toActionResult(err(toCreatePersonalWorkspaceError(error)));
  }
});

/**
 * Drop a recovered `/join` token after accept, join, or reject-all.
 */
export const clearPendingOrganizationJoinCookieAction = withSession<
  AuthenticatedRequest,
  ActionResultDto<null, ActionError>
>(async () => {
  await clearPendingOrganizationJoinToken();
  return toActionResult(ok(null));
});
