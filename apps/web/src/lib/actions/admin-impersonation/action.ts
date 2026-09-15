"use server";

import { err, ok } from "neverthrow";

import {
  type ActionResultDto,
  toActionResult,
} from "@/lib/actions/action-result";
import { type ActionError, CommonErrorCode } from "@/lib/actions/errors";
import { assertAdminSession } from "@/lib/auth/admin-access";
import { isAdminAccessRequiredError } from "@/lib/auth/errors";
import { toCoreApiActionError } from "@/lib/clients/core.client";
import {
  adminImpersonationService,
  type ImpersonationUser,
  ImpersonationValidationError,
} from "@/lib/services/admin-impersonation.service";
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

  if (error instanceof ImpersonationValidationError) {
    return {
      code: CommonErrorCode.BAD_INPUT,
      message: error.message,
    };
  }

  return toCoreApiActionError(error);
}

interface StartImpersonationRequest extends AuthenticatedRequest {
  userId: string;
  reason: string;
}

export const startImpersonationAction = withSession<
  StartImpersonationRequest,
  ActionResultDto<ImpersonationUser, ActionError>
>(async ({ session, userId, reason }) => {
  try {
    // Conflict before the admin check, mirroring Core: an impersonated
    // caller holds the target's non-admin role, so the admin assertion
    // alone would mislabel this state as unauthorized.
    if (session.session.impersonatedBy) {
      throw new ImpersonationValidationError(
        "Already impersonating a user. Stop the current impersonation first.",
      );
    }
    assertAdminSession(session);
    return toActionResult(
      ok(
        await adminImpersonationService.startImpersonation({ userId, reason }),
      ),
    );
  } catch (error) {
    return toActionResult(err(mapError(error)));
  }
});

export const stopImpersonationAction = withSession<
  AuthenticatedRequest,
  ActionResultDto<ImpersonationUser, ActionError>
>(async () => {
  try {
    // No admin assertion: while impersonating, the caller holds the target's
    // non-admin role. Core rejects the stop when no impersonation is active.
    return toActionResult(
      ok(await adminImpersonationService.stopImpersonation()),
    );
  } catch (error) {
    return toActionResult(err(mapError(error)));
  }
});
