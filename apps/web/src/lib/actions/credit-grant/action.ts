"use server";

import { revalidatePath } from "next/cache";

import { type ActionError, CommonErrorCode } from "@/lib/actions/errors";
import { assertAdminSession } from "@/lib/auth/admin-access";
import { isAdminAccessRequiredError } from "@/lib/auth/errors";
import {
  type CreditGrantInvoiceSummary,
  type CreditGrantTargetType,
  CreditGrantValidationError,
  creditGrantAdminService,
} from "@/lib/services/credit-grant-admin.service";
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

  if (error instanceof CreditGrantValidationError) {
    return {
      code: CommonErrorCode.BAD_INPUT,
      message: error.message,
    };
  }

  return {
    code: CommonErrorCode.INTERNAL_SERVER_ERROR,
    message:
      error instanceof Error ? error.message : "Failed to process credit grant",
  };
}

interface CreateCreditGrantInvoiceParameters extends AuthenticatedRequest {
  targetType: CreditGrantTargetType;
  targetId: string;
  credits: number;
  ttlDays: number | null;
  priceId: string | null;
}

export const createCreditGrantInvoiceAction = withSession<
  CreateCreditGrantInvoiceParameters,
  Result<CreditGrantInvoiceSummary, ActionError>
>(async ({ session, targetType, targetId, credits, ttlDays, priceId }) => {
  try {
    assertAdminSession(session);
    const summary = await creditGrantAdminService.createGrantInvoice({
      target: { targetType, targetId },
      credits,
      ttlDays,
      priceId,
    });
    revalidatePath("/admin/credit-grants");
    return Ok(summary);
  } catch (error) {
    return Err(mapError(error));
  }
});

interface MarkCreditGrantInvoicePaidParameters extends AuthenticatedRequest {
  invoiceId: string;
}

export const markCreditGrantInvoicePaidAction = withSession<
  MarkCreditGrantInvoicePaidParameters,
  Result<CreditGrantInvoiceSummary, ActionError>
>(async ({ session, invoiceId }) => {
  try {
    assertAdminSession(session);
    const summary =
      await creditGrantAdminService.markGrantInvoicePaid(invoiceId);
    revalidatePath("/admin/credit-grants");
    return Ok(summary);
  } catch (error) {
    return Err(mapError(error));
  }
});
