"use server";

import { CORE_API_ERROR_KINDS } from "@sokosumi/utils";
import { revalidatePath } from "next/cache";

import { type ActionError, CommonErrorCode } from "@/lib/actions/errors";
import { assertAdminSession } from "@/lib/auth/admin-access";
import { isAdminAccessRequiredError } from "@/lib/auth/errors";
import { CoreApiRequestError } from "@/lib/clients/core.shared";
import {
  type InvoiceListItem,
  type InvoiceStatusFilter,
  type InvoiceSummary,
  type InvoiceTargetType,
  InvoiceValidationError,
  invoiceAdminService,
} from "@/lib/services/invoice-admin.service";
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

  if (error instanceof InvoiceValidationError) {
    return {
      code: CommonErrorCode.BAD_INPUT,
      message: error.message,
    };
  }

  if (
    error instanceof CoreApiRequestError &&
    (error.kind === CORE_API_ERROR_KINDS.INVOICE_NOT_FOUND ||
      error.status === 404)
  ) {
    return {
      code: CommonErrorCode.NOT_FOUND,
      message: error.message,
    };
  }

  return {
    code: CommonErrorCode.INTERNAL_SERVER_ERROR,
    message:
      error instanceof Error
        ? error.message
        : "Failed to process admin invoice",
  };
}

interface CreateAdminInvoiceParameters extends AuthenticatedRequest {
  targetType: InvoiceTargetType;
  targetId: string;
  credits: number;
  ttlDays: number | null;
  priceId: string | null;
  markFree: boolean;
}

export const createAdminInvoiceAction = withSession<
  CreateAdminInvoiceParameters,
  Result<InvoiceSummary, ActionError>
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
      const summary = await invoiceAdminService.createInvoice({
        target: { targetType, targetId },
        credits,
        ttlDays,
        priceId,
        markFree,
      });
      revalidatePath("/admin/invoices");
      return Ok(summary);
    } catch (error) {
      return Err(mapError(error));
    }
  },
);

interface ListAdminInvoicesParameters extends AuthenticatedRequest {
  status: InvoiceStatusFilter;
  recipient: { targetType: InvoiceTargetType; targetId: string } | null;
}

export const listAdminInvoicesAction = withSession<
  ListAdminInvoicesParameters,
  Result<InvoiceListItem[], ActionError>
>(async ({ session, status, recipient }) => {
  try {
    assertAdminSession(session);
    const invoices = await invoiceAdminService.listInvoices({
      status,
      recipient,
    });
    return Ok(invoices);
  } catch (error) {
    return Err(mapError(error));
  }
});

interface GetAdminInvoiceParameters extends AuthenticatedRequest {
  invoiceId: string;
}

export const getAdminInvoiceAction = withSession<
  GetAdminInvoiceParameters,
  Result<InvoiceSummary, ActionError>
>(async ({ session, invoiceId }) => {
  try {
    assertAdminSession(session);
    const summary = await invoiceAdminService.getInvoice(invoiceId);
    if (!summary) {
      return Err({
        code: CommonErrorCode.NOT_FOUND,
        message: "Admin invoice not found",
      });
    }
    return Ok(summary);
  } catch (error) {
    return Err(mapError(error));
  }
});

interface MarkAdminInvoicePaidParameters extends AuthenticatedRequest {
  invoiceId: string;
}

export const markAdminInvoicePaidAction = withSession<
  MarkAdminInvoicePaidParameters,
  Result<InvoiceSummary, ActionError>
>(async ({ session, invoiceId }) => {
  try {
    assertAdminSession(session);
    const summary = await invoiceAdminService.markInvoicePaid(invoiceId);
    revalidatePath("/admin/invoices");
    return Ok(summary);
  } catch (error) {
    return Err(mapError(error));
  }
});
