"use server";

import { revalidatePath } from "next/cache";

import { type ActionError, CommonErrorCode } from "@/lib/actions/errors";
import { assertAdminSession } from "@/lib/auth/admin-access";
import { isAdminAccessRequiredError } from "@/lib/auth/errors";
import {
  type SupportCreditGrant,
  type SupportCreditTargetType,
  SupportCreditValidationError,
  supportCreditAdminService,
} from "@/lib/services/support-credit-admin.service";
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

  if (error instanceof SupportCreditValidationError) {
    return {
      code: CommonErrorCode.BAD_INPUT,
      message: error.message,
    };
  }

  return {
    code: CommonErrorCode.INTERNAL_SERVER_ERROR,
    message:
      error instanceof Error
        ? error.message
        : "Failed to grant support credits",
  };
}

interface GrantSupportCreditsParameters extends AuthenticatedRequest {
  targetType: SupportCreditTargetType;
  targetId: string;
  credits: number;
  ttlDays: number | null;
  referenceNote: string | null;
}

export const grantSupportCreditsAction = withSession<
  GrantSupportCreditsParameters,
  Result<SupportCreditGrant, ActionError>
>(
  async ({
    session,
    targetType,
    targetId,
    credits,
    ttlDays,
    referenceNote,
  }) => {
    try {
      assertAdminSession(session);
      const grant = await supportCreditAdminService.grantSupportCredits({
        target: { targetType, targetId },
        credits,
        ttlDays,
        referenceNote,
      });
      revalidatePath("/admin/support-credits");
      revalidatePath("/admin/users");
      revalidatePath("/admin/organizations", "layout");
      return Ok(grant);
    } catch (error) {
      return Err(mapError(error));
    }
  },
);
