"use server";

import { revalidatePath } from "next/cache";

import { type ActionError, CommonErrorCode } from "@/lib/actions/errors";
import { assertAdminSession } from "@/lib/auth/admin-access";
import { isAdminAccessRequiredError } from "@/lib/auth/errors";
import {
  type CreditGrantInvoiceListItem,
  type CreditGrantInvoiceStatusFilter,
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
  markFree: boolean;
}

export const createCreditGrantInvoiceAction = withSession<
  CreateCreditGrantInvoiceParameters,
  Result<CreditGrantInvoiceSummary, ActionError>
>(
  async ({
    session,
    targetType,
    targetId,
    credits,
    ttlDays,
    priceId,
    markFree,
  }) => {
    try {
      assertAdminSession(session);
      const summary = await creditGrantAdminService.createGrantInvoice({
        target: { targetType, targetId },
        credits,
        ttlDays,
        priceId,
        markFree,
      });
      revalidatePath("/admin/credit-grants");
      return Ok(summary);
    } catch (error) {
      return Err(mapError(error));
    }
  },
);

interface ListCreditGrantInvoicesParameters extends AuthenticatedRequest {
  status: CreditGrantInvoiceStatusFilter;
  recipient: { targetType: CreditGrantTargetType; targetId: string } | null;
}

export const listCreditGrantInvoicesAction = withSession<
  ListCreditGrantInvoicesParameters,
  Result<CreditGrantInvoiceListItem[], ActionError>
>(async ({ session, status, recipient }) => {
  try {
    assertAdminSession(session);
    const invoices = await creditGrantAdminService.listGrantInvoices({
      status,
      recipient,
    });
    return Ok(invoices);
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
