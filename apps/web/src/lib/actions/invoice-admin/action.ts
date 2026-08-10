"use server";

import { CORE_API_ERROR_KINDS } from "@sokosumi/utils";
import { err, ok } from "neverthrow";
import { revalidatePath } from "next/cache";
import {
  type ActionResultDto,
  toActionResult,
} from "@/lib/actions/action-result";

import { type ActionError, CommonErrorCode } from "@/lib/actions/errors";
import { assertAdminSession } from "@/lib/auth/admin-access";
import { isAdminAccessRequiredError } from "@/lib/auth/errors";
import { CoreApiRequestError } from "@/lib/clients/core.request";
import type { StripeCustomerBillingDetails } from "@/lib/clients/generated/core";
import {
  type InvoiceListItem,
  type InvoiceStatusFilter,
  type InvoiceSummary,
  type InvoiceTargetType,
  InvoiceValidationError,
  invoiceAdminService,
} from "@/lib/services/invoice-admin.service";
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
}

export const createAdminInvoiceAction = withSession<
  CreateAdminInvoiceParameters,
  ActionResultDto<InvoiceSummary, ActionError>
>(async ({ session, targetType, targetId, credits, ttlDays, priceId }) => {
  try {
    assertAdminSession(session);
    const summary = await invoiceAdminService.createInvoice({
      target: { targetType, targetId },
      credits,
      ttlDays,
      priceId,
    });
    revalidatePath("/admin/invoices");
    return toActionResult(ok(summary));
  } catch (error) {
    return toActionResult(err(mapError(error)));
  }
});

interface ListAdminInvoicesParameters extends AuthenticatedRequest {
  status: InvoiceStatusFilter;
  recipient: { targetType: InvoiceTargetType; targetId: string } | null;
}

export const listAdminInvoicesAction = withSession<
  ListAdminInvoicesParameters,
  ActionResultDto<InvoiceListItem[], ActionError>
>(async ({ session, status, recipient }) => {
  try {
    assertAdminSession(session);
    const invoices = await invoiceAdminService.listInvoices({
      status,
      recipient,
    });
    return toActionResult(ok(invoices));
  } catch (error) {
    return toActionResult(err(mapError(error)));
  }
});

interface GetAdminInvoiceParameters extends AuthenticatedRequest {
  invoiceId: string;
}

export const getAdminInvoiceAction = withSession<
  GetAdminInvoiceParameters,
  ActionResultDto<InvoiceSummary, ActionError>
>(async ({ session, invoiceId }) => {
  try {
    assertAdminSession(session);
    const summary = await invoiceAdminService.getInvoice(invoiceId);
    if (!summary) {
      return toActionResult(
        err({
          code: CommonErrorCode.NOT_FOUND,
          message: "Admin invoice not found",
        }),
      );
    }
    return toActionResult(ok(summary));
  } catch (error) {
    return toActionResult(err(mapError(error)));
  }
});

interface MarkAdminInvoicePaidParameters extends AuthenticatedRequest {
  invoiceId: string;
}

export const markAdminInvoicePaidAction = withSession<
  MarkAdminInvoicePaidParameters,
  ActionResultDto<InvoiceSummary, ActionError>
>(async ({ session, invoiceId }) => {
  try {
    assertAdminSession(session);
    const summary = await invoiceAdminService.markInvoicePaid(invoiceId);
    revalidatePath("/admin/invoices");
    return toActionResult(ok(summary));
  } catch (error) {
    return toActionResult(err(mapError(error)));
  }
});

interface DeleteAdminInvoiceParameters extends AuthenticatedRequest {
  invoiceId: string;
}

export const deleteAdminInvoiceAction = withSession<
  DeleteAdminInvoiceParameters,
  ActionResultDto<void, ActionError>
>(async ({ session, invoiceId }) => {
  try {
    assertAdminSession(session);
    await invoiceAdminService.deleteInvoice(invoiceId);
    revalidatePath("/admin/invoices");
    return toActionResult(ok(undefined));
  } catch (error) {
    return toActionResult(err(mapError(error)));
  }
});

interface GetAdminRecipientBillingDetailsParameters
  extends AuthenticatedRequest {
  targetType: InvoiceTargetType;
  targetId: string;
}

export const getAdminRecipientBillingDetailsAction = withSession<
  GetAdminRecipientBillingDetailsParameters,
  ActionResultDto<StripeCustomerBillingDetails, ActionError>
>(async ({ session, targetType, targetId }) => {
  try {
    assertAdminSession(session);
    const billingDetails = await invoiceAdminService.getRecipientBillingDetails(
      { targetType, targetId },
    );
    return toActionResult(ok(billingDetails));
  } catch (error) {
    return toActionResult(err(mapError(error)));
  }
});
