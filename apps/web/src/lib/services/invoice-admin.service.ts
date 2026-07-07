import "server-only";

import { CORE_API_ERROR_KINDS } from "@sokosumi/utils";

import { coreClient } from "@/lib/clients/core.client";
import { CoreApiRequestError } from "@/lib/clients/core.shared";
import type { StripeCustomerBillingDetails } from "@/lib/clients/generated/core";

export type InvoiceTargetType = "user" | "organization";

export interface InvoiceTarget {
  targetType: InvoiceTargetType;
  targetId: string;
}

/** Stripe invoice statuses surfaced through the admin invoice API. */
export type InvoiceStatus =
  | "draft"
  | "open"
  | "paid"
  | "uncollectible"
  | "void";

export interface InvoiceSummary {
  invoiceId: string;
  targetType: InvoiceTargetType;
  targetId: string;
  targetName: string;
  credits: number;
  ttlDays: number | null;
  currency: string;
  amountDue: number;
  status: InvoiceStatus | null;
  /** Stripe dashboard URL for the invoice (admin-facing, not the payment page). */
  dashboardUrl: string;
}

export interface CreditPriceOption {
  id: string;
  amountPerCredit: number;
  currency: string;
  nickname: string | null;
}

/** An admin invoice surfaced in the admin invoice list. */
export interface InvoiceListItem {
  invoiceId: string;
  targetType: InvoiceTargetType | null;
  targetName: string | null;
  credits: number;
  ttlDays: number | null;
  currency: string;
  amountDue: number;
  status: InvoiceStatus | null;
  /** Invoice creation time as a Unix timestamp in milliseconds. */
  createdAt: number;
  /** Stripe dashboard URL for the invoice (admin-facing, not the payment page). */
  dashboardUrl: string;
}

/**
 * Status filter accepted by {@link invoiceAdminService.listInvoices}:
 * `"unfinished"` (draft + open, the default), `"all"` (every status), or a
 * specific Stripe invoice status.
 */
export type InvoiceStatusFilter = "unfinished" | "all" | InvoiceStatus;

export interface ListInvoicesParams {
  status?: InvoiceStatusFilter;
  /** When set, only invoices for this user/organization are returned. */
  recipient?: InvoiceTarget | null;
  limit?: number;
}

export class InvoiceValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvoiceValidationError";
  }
}

/**
 * Re-throws a Core `invoice_invalid` error as the local
 * `InvoiceValidationError` (preserving the core message) so action-level
 * error mapping keeps working; rethrows everything else.
 */
function mapCoreError(error: unknown): never {
  if (
    error instanceof CoreApiRequestError &&
    error.kind === CORE_API_ERROR_KINDS.INVOICE_INVALID
  ) {
    throw new InvoiceValidationError(error.message);
  }

  throw error;
}

/**
 * Admin one-time credit invoices. All Stripe and database work lives in the
 * Core API (`/v1/admin/invoices`); this service is a thin
 * session-authenticated wrapper that preserves the original interface.
 */
export const invoiceAdminService = {
  async listPrices(): Promise<CreditPriceOption[]> {
    const response = await coreClient.listCreditPrices();
    return response.data;
  },

  /**
   * Lists admin invoices, most recent first. Defaults to
   * unfinished (draft + open) invoices but accepts a status filter
   * (`"all"` or a specific status) and an optional recipient filter.
   */
  async listInvoices(
    params: ListInvoicesParams = {},
  ): Promise<InvoiceListItem[]> {
    const response = await coreClient.listAdminInvoices({
      status: params.status,
      ...(params.recipient
        ? {
            recipientType: params.recipient.targetType,
            recipientId: params.recipient.targetId,
          }
        : {}),
      limit: params.limit,
    });
    return response.data;
  },

  async createInvoice(params: {
    target: InvoiceTarget;
    credits: number;
    ttlDays: number | null;
    priceId: string | null;
  }): Promise<InvoiceSummary> {
    const response = await coreClient
      .createAdminInvoice({
        targetType: params.target.targetType,
        targetId: params.target.targetId,
        credits: params.credits,
        ttlDays: params.ttlDays,
        priceId: params.priceId,
      })
      .catch(mapCoreError);
    return response.data;
  },

  /**
   * Fetches a single admin invoice as a detail summary. Returns
   * null when the invoice does not exist or is not an admin invoice, so
   * the caller can surface a 404.
   */
  async getInvoice(invoiceId: string): Promise<InvoiceSummary | null> {
    try {
      const response = await coreClient.getAdminInvoice(invoiceId);
      return response.data;
    } catch (error) {
      if (
        error instanceof CoreApiRequestError &&
        (error.kind === CORE_API_ERROR_KINDS.INVOICE_NOT_FOUND ||
          error.status === 404)
      ) {
        return null;
      }
      throw error;
    }
  },

  /**
   * Marks an admin invoice as paid and grants the credits instantly via
   * the Core invoice-paid automation. Granting is idempotent against the
   * `invoice.paid` webhook.
   */
  async markInvoicePaid(invoiceId: string): Promise<InvoiceSummary> {
    const response = await coreClient
      .markAdminInvoicePaid(invoiceId)
      .catch(mapCoreError);
    return response.data;
  },

  /**
   * Deletes or voids an admin invoice in Stripe. Draft invoices are
   * permanently deleted; open invoices are voided.
   */
  async deleteInvoice(invoiceId: string): Promise<void> {
    await coreClient.deleteAdminInvoice(invoiceId).catch(mapCoreError);
  },

  async getRecipientBillingDetails(
    target: InvoiceTarget,
  ): Promise<StripeCustomerBillingDetails> {
    const response =
      target.targetType === "user"
        ? await coreClient.getUserBillingDetails(target.targetId)
        : await coreClient.getOrganizationBillingDetails(target.targetId);
    return response.data;
  },
};
