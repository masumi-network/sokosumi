"use server";

import { CORE_API_ERROR_KINDS } from "@sokosumi/utils";
import { err, ok } from "neverthrow";
import { getEnvSecrets } from "@/config/env.secrets";
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
import type {
  PersonalWorkspaceCreated,
  PersonalWorkspaceDeleted,
} from "@/lib/clients/generated/core";
import {
  clearPendingOrganizationJoinToken,
  getPendingOrganizationJoinToken,
  shouldClearPendingJoinCookie,
} from "@/lib/pending-organization-join-cookie";
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

function toDeletePersonalWorkspaceError(error: unknown): ActionError {
  if (error instanceof CoreApiRequestError) {
    if (
      error.status === 409 &&
      error.kind === CORE_API_ERROR_KINDS.LAST_WORKSPACE
    ) {
      return {
        code: WorkspaceGateErrorCode.LAST_WORKSPACE,
        message: error.message,
      };
    }
    if (
      error.status === 409 &&
      error.kind === CORE_API_ERROR_KINDS.WORKSPACE_HAS_DEPENDENTS
    ) {
      return {
        code: WorkspaceGateErrorCode.WORKSPACE_HAS_DEPENDENTS,
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
 * Delete the signed-in user's personal workspace when an org workspace remains.
 */
export const deletePersonalWorkspaceAction = withSession<
  AuthenticatedRequest,
  ActionResultDto<PersonalWorkspaceDeleted, ActionError>
>(async () => {
  try {
    const { data } = await coreClient.deleteMyPersonalWorkspace();
    return toActionResult(ok(data));
  } catch (error) {
    console.error("Failed to delete personal workspace", error);
    return toActionResult(err(toDeletePersonalWorkspaceError(error)));
  }
});

interface ClearPendingOrganizationJoinCookieParameters
  extends AuthenticatedRequest {
  organizationSlug?: string;
  acceptedJoinToken?: string;
}

/**
 * Drop a recovered `/join` token after reject-all / decline, or after
 * accept/join when the cookie is that same org (or the accepted token).
 */
export const clearPendingOrganizationJoinCookieAction = withSession<
  ClearPendingOrganizationJoinCookieParameters,
  ActionResultDto<null, ActionError>
>(async ({ organizationSlug, acceptedJoinToken }) => {
  const env = getEnvSecrets();
  const secure =
    env.NODE_ENV === "production" ||
    env.VERCEL_ENV === "production" ||
    env.VERCEL_ENV === "preview";

  if (!organizationSlug && !acceptedJoinToken) {
    await clearPendingOrganizationJoinToken({ secure });
    return toActionResult(ok(null));
  }

  const cookieToken = await getPendingOrganizationJoinToken();
  if (!cookieToken) {
    return toActionResult(ok(null));
  }

  if (
    shouldClearPendingJoinCookie({
      cookieToken,
      acceptedJoinToken,
      joinedOrganizationSlug: organizationSlug ?? "",
    })
  ) {
    await clearPendingOrganizationJoinToken({ secure });
    return toActionResult(ok(null));
  }

  let cookieOrganizationSlug: string | null = null;
  if (organizationSlug) {
    try {
      const resolved =
        await coreClient.resolveOrganizationInviteLink(cookieToken);
      if (
        resolved.data.status === "valid" &&
        resolved.data.organization?.slug
      ) {
        cookieOrganizationSlug = resolved.data.organization.slug;
      }
    } catch (error) {
      console.error(
        "Failed to resolve pending organization join token for cookie clear",
        error,
      );
    }
  }

  if (
    !shouldClearPendingJoinCookie({
      cookieToken,
      acceptedJoinToken,
      cookieOrganizationSlug,
      joinedOrganizationSlug: organizationSlug ?? "",
    })
  ) {
    return toActionResult(ok(null));
  }

  await clearPendingOrganizationJoinToken({ secure });
  return toActionResult(ok(null));
});
