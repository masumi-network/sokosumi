import "server-only";

import {
  buildOrganizationInvoiceCreditReferenceId,
  buildUserInvoiceCreditReferenceId,
} from "@sokosumi/database/helpers";
import {
  organizationRepository,
  userRepository,
} from "@sokosumi/database/repositories";
import { getOrganizationMetadata } from "@sokosumi/utils";
import type Stripe from "stripe";
import { getEnvSecrets } from "@/config/env.secrets";
import { stripeClient } from "@/lib/clients/stripe.client";
import prisma from "@/lib/db/prisma";
import { isPositiveIntegerCredits } from "@/lib/stripe/credit-topup-pricing";
import { handleInvoicePaidEvent } from "@/lib/stripe/webhook-handlers";

const ADMIN_CREDIT_GRANT_SOURCE = "admin_one_time_credit";
const MAX_TTL_DAYS = 3650;

export type CreditGrantTargetType = "user" | "organization";

export interface CreditGrantTarget {
  targetType: CreditGrantTargetType;
  targetId: string;
}

export interface CreditGrantInvoiceSummary {
  invoiceId: string;
  targetType: CreditGrantTargetType;
  targetId: string;
  targetName: string;
  credits: number;
  ttlDays: number | null;
  currency: string;
  amountDue: number;
  status: Stripe.Invoice.Status | null;
  /** Stripe dashboard URL for the invoice (admin-facing, not the payment page). */
  dashboardUrl: string;
}

export interface CreditPriceOption {
  id: string;
  amountPerCredit: number;
  currency: string;
  nickname: string | null;
}

/** A credit-grant invoice surfaced in the admin list of unfinished invoices. */
export interface CreditGrantInvoiceListItem {
  invoiceId: string;
  targetType: CreditGrantTargetType | null;
  targetName: string | null;
  credits: number;
  ttlDays: number | null;
  currency: string;
  amountDue: number;
  status: Stripe.Invoice.Status | null;
  /** Invoice creation time as a Unix timestamp in milliseconds. */
  createdAt: number;
  /** Stripe dashboard URL for the invoice (admin-facing, not the payment page). */
  dashboardUrl: string;
}

/** Statuses of invoices that still need attention (not paid, void, or
 * uncollectible). This is the default filter for the admin list. */
const UNFINISHED_INVOICE_STATUSES: Stripe.Invoice.Status[] = ["draft", "open"];

/** Max number of invoices returned by the admin list (per filter). */
const DEFAULT_INVOICE_LIST_LIMIT = 50;

/**
 * Status filter accepted by {@link creditGrantAdminService.listGrantInvoices}:
 * `"unfinished"` (draft + open, the default), `"all"` (every status), or a
 * specific Stripe invoice status.
 */
export type CreditGrantInvoiceStatusFilter =
  | "unfinished"
  | "all"
  | Stripe.Invoice.Status;

export interface ListGrantInvoicesParams {
  status?: CreditGrantInvoiceStatusFilter;
  /** When set, only invoices for this user/organization are returned. */
  recipient?: CreditGrantTarget | null;
  limit?: number;
}

/** Identity of a grant target (user or organization) used for summaries and
 * credit-bucket verification, independent of Stripe billing details. */
interface TargetIdentity {
  targetType: CreditGrantTargetType;
  id: string;
  name: string;
}

interface ResolvedTarget extends TargetIdentity {
  stripeCustomerId: string;
}

/**
 * Builds the account-scoped Stripe dashboard URL for an invoice (the
 * admin-facing view), not the customer hosted-invoice/payment page. Scoping by
 * account id makes the link resolve to the correct sandbox (or live) account
 * — `livemode` alone can't distinguish a sandbox from legacy test mode.
 */
function buildInvoiceDashboardUrl(
  invoice: Stripe.Invoice,
  accountId: string,
): string {
  return `https://dashboard.stripe.com/${accountId}/invoices/${invoice.id}`;
}

export class CreditGrantValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CreditGrantValidationError";
  }
}

function toInvoiceSummary(
  invoice: Stripe.Invoice,
  target: TargetIdentity,
  credits: number,
  ttlDays: number | null,
  accountId: string,
): CreditGrantInvoiceSummary {
  if (!invoice.id) {
    throw new Error("Stripe invoice is missing an id");
  }

  return {
    invoiceId: invoice.id,
    targetType: target.targetType,
    targetId: target.id,
    targetName: target.name,
    credits,
    ttlDays,
    currency: invoice.currency ?? "",
    amountDue: invoice.amount_due ?? 0,
    status: invoice.status ?? null,
    dashboardUrl: buildInvoiceDashboardUrl(invoice, accountId),
  };
}

/** Reads a non-negative integer-ish value out of invoice metadata, returning
 * the fallback when it is missing or not a finite number. */
function parseMetadataNumber(
  value: string | undefined,
  fallback: number | null,
): number | null {
  if (value === undefined) {
    return fallback;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/** Resolves the grant target (type + display name) from an expanded invoice
 * customer. Returns nulls when the customer is unexpanded or deleted. */
function resolveTargetFromCustomer(customer: Stripe.Invoice["customer"]): {
  targetType: CreditGrantTargetType | null;
  targetName: string | null;
} {
  if (!customer || typeof customer === "string" || customer.deleted) {
    return { targetType: null, targetName: null };
  }
  const customerType = customer.metadata?.customerType;
  const targetType: CreditGrantTargetType | null =
    customerType === "user" || customerType === "organization"
      ? customerType
      : null;
  return { targetType, targetName: customer.name ?? null };
}

function toInvoiceListItem(
  invoice: Stripe.Invoice,
  accountId: string,
): CreditGrantInvoiceListItem | null {
  if (!invoice.id) {
    return null;
  }
  const { targetType, targetName } = resolveTargetFromCustomer(
    invoice.customer,
  );
  return {
    invoiceId: invoice.id,
    targetType,
    targetName,
    credits: parseMetadataNumber(invoice.metadata?.credits, 0) ?? 0,
    ttlDays: parseMetadataNumber(invoice.metadata?.ttl_days, null),
    currency: invoice.currency ?? "",
    amountDue: invoice.amount_due ?? 0,
    status: invoice.status ?? null,
    createdAt: invoice.created * 1000,
    dashboardUrl: buildInvoiceDashboardUrl(invoice, accountId),
  };
}

export const creditGrantAdminService = (() => {
  async function ensureOrganizationStripeCustomerId(
    organizationId: string,
  ): Promise<ResolvedTarget> {
    const organization =
      await organizationRepository.getOrganizationWithRelationsById(
        organizationId,
        prisma,
      );

    if (!organization) {
      throw new CreditGrantValidationError("Organization not found");
    }

    if (organization.stripeCustomerId) {
      return {
        targetType: "organization",
        id: organization.id,
        name: organization.name,
        stripeCustomerId: organization.stripeCustomerId,
      };
    }

    const { invoiceEmail } = getOrganizationMetadata(organization.metadata);
    const customer = await stripeClient.createOrganizationCustomer(
      organization.id,
      organization.slug,
      organization.name,
      invoiceEmail,
    );

    await prisma.organization.update({
      where: { id: organization.id },
      data: { stripeCustomerId: customer.id },
    });

    return {
      targetType: "organization",
      id: organization.id,
      name: organization.name,
      stripeCustomerId: customer.id,
    };
  }

  async function ensureUserStripeCustomerId(
    userId: string,
  ): Promise<ResolvedTarget> {
    const user = await userRepository.getUserById(userId, prisma);

    if (!user) {
      throw new CreditGrantValidationError("User not found");
    }

    if (user.stripeCustomerId) {
      return {
        targetType: "user",
        id: user.id,
        name: user.name,
        stripeCustomerId: user.stripeCustomerId,
      };
    }

    const customer = await stripeClient.createUserCustomer(
      user.id,
      user.name,
      user.email,
    );

    await prisma.user.update({
      where: { id: user.id },
      data: { stripeCustomerId: customer.id },
    });

    return {
      targetType: "user",
      id: user.id,
      name: user.name,
      stripeCustomerId: customer.id,
    };
  }

  async function resolveTarget(
    target: CreditGrantTarget,
  ): Promise<ResolvedTarget> {
    return target.targetType === "user"
      ? ensureUserStripeCustomerId(target.targetId)
      : ensureOrganizationStripeCustomerId(target.targetId);
  }

  /** Resolves a recipient to its existing Stripe customer id without creating
   * one. Returns null when the recipient has no Stripe customer yet (so no
   * invoices can exist for them). */
  async function resolveExistingStripeCustomerId(
    recipient: CreditGrantTarget,
  ): Promise<string | null> {
    if (recipient.targetType === "user") {
      const user = await userRepository.getUserById(recipient.targetId, prisma);
      return user?.stripeCustomerId ?? null;
    }
    const organization =
      await organizationRepository.getOrganizationWithRelationsById(
        recipient.targetId,
        prisma,
      );
    return organization?.stripeCustomerId ?? null;
  }

  async function resolvePrice(priceId: string | null) {
    if (!priceId) {
      return await stripeClient.getBaseCreditTopUpPrice();
    }
    try {
      return await stripeClient.getCreditTopUpPriceById(priceId);
    } catch {
      throw new CreditGrantValidationError("Selected price is not valid");
    }
  }

  /**
   * Grants the credits for an already-paid invoice via the shared invoice-paid
   * automation and verifies the grant landed. Idempotent against the
   * `invoice.paid` webhook Stripe also fires (shared reference-id dedup).
   */
  async function grantCreditsForPaidInvoice(
    paidInvoice: Stripe.Invoice,
    target: TargetIdentity,
  ): Promise<void> {
    if (!paidInvoice.id) {
      throw new Error("Stripe invoice is missing an id");
    }

    await handleInvoicePaidEvent(paidInvoice);

    const expectedReferenceId =
      target.targetType === "user"
        ? buildUserInvoiceCreditReferenceId(target.id, paidInvoice.id, "topup")
        : buildOrganizationInvoiceCreditReferenceId(
            target.id,
            paidInvoice.id,
            "topup",
          );
    const grantedBucketWhere =
      target.targetType === "user"
        ? {
            userId: target.id,
            organizationId: null,
            referenceId: expectedReferenceId,
          }
        : { organizationId: target.id, referenceId: expectedReferenceId };

    // handleInvoicePaidEvent can return early without granting (e.g. the
    // organization has no owner/members), leaving the invoice paid but no
    // credits issued. Verify the grant landed instead of reporting false
    // success; granting is idempotent, so a retry after fixing the cause
    // completes it.
    const grantedBucket = await prisma.creditBucket.findFirst({
      where: grantedBucketWhere,
      select: { id: true },
    });
    if (!grantedBucket) {
      throw new CreditGrantValidationError(
        "Invoice was paid but credits were not granted (the organization may have no owner). Resolve the issue and mark it paid again to retry.",
      );
    }
  }

  return {
    async listPrices(): Promise<CreditPriceOption[]> {
      const prices = await stripeClient.listCreditTopUpPrices();
      return prices.map((price) => ({
        id: price.id,
        amountPerCredit: price.amountPerCredit,
        currency: price.currency,
        nickname: price.nickname,
      }));
    },

    /**
     * Lists admin credit-grant invoices, most recent first. Defaults to
     * unfinished (draft + open) invoices but accepts a status filter
     * (`"all"` or a specific status) and an optional recipient filter. Only
     * invoices tagged with the admin grant source are returned, so normal
     * checkout/subscription invoices are filtered out.
     */
    async listGrantInvoices(
      params: ListGrantInvoicesParams = {},
    ): Promise<CreditGrantInvoiceListItem[]> {
      const status = params.status ?? "unfinished";
      const limit = params.limit ?? DEFAULT_INVOICE_LIST_LIMIT;

      let customerId: string | undefined;
      if (params.recipient) {
        const resolved = await resolveExistingStripeCustomerId(
          params.recipient,
        );
        // No Stripe customer means no invoices exist for the recipient yet.
        if (!resolved) {
          return [];
        }
        customerId = resolved;
      }

      const statuses =
        status === "all"
          ? undefined
          : status === "unfinished"
            ? UNFINISHED_INVOICE_STATUSES
            : [status];

      const [invoices, accountId] = await Promise.all([
        stripeClient.listInvoices({ statuses, customerId, limit }),
        stripeClient.getAccountId(),
      ]);

      return invoices
        .filter(
          (invoice) =>
            invoice.metadata?.grant_source === ADMIN_CREDIT_GRANT_SOURCE,
        )
        .map((invoice) => toInvoiceListItem(invoice, accountId))
        .filter((item): item is CreditGrantInvoiceListItem => item !== null)
        .sort((a, b) => b.createdAt - a.createdAt)
        .slice(0, limit);
    },

    async createGrantInvoice(params: {
      target: CreditGrantTarget;
      credits: number;
      ttlDays: number | null;
      priceId: string | null;
      /** When true, applies the support coupon so the invoice is free ($0). */
      markFree: boolean;
    }): Promise<CreditGrantInvoiceSummary> {
      if (!isPositiveIntegerCredits(params.credits)) {
        throw new CreditGrantValidationError(
          "Credits must be a positive integer",
        );
      }

      if (params.ttlDays !== null) {
        if (
          !Number.isInteger(params.ttlDays) ||
          params.ttlDays <= 0 ||
          params.ttlDays > MAX_TTL_DAYS
        ) {
          throw new CreditGrantValidationError(
            `Expiry must be a positive integer of at most ${MAX_TTL_DAYS} days`,
          );
        }
      }

      // These are independent reads (target lookup, price lookup, Stripe
      // account id) — run them concurrently rather than serially.
      const [target, price, accountId] = await Promise.all([
        resolveTarget(params.target),
        resolvePrice(params.priceId),
        stripeClient.getAccountId(),
      ]);

      const invoice = await stripeClient.createCreditGrantInvoice({
        customerId: target.stripeCustomerId,
        credits: params.credits,
        priceId: price.id,
        currency: price.currency,
        ttlDays: params.ttlDays ?? undefined,
        ...(params.markFree
          ? { couponId: getEnvSecrets().STRIPE_SUPPORT_COUPON }
          : {}),
      });

      // A free grant must be fully discounted to $0 by the support coupon. If
      // it isn't (e.g. the coupon is misconfigured as fixed-amount or <100%),
      // the invoice stays payable and would silently become a normal open
      // invoice — fail loudly instead so the misconfiguration is obvious.
      if (params.markFree && (invoice.amount_due ?? 0) !== 0) {
        throw new CreditGrantValidationError(
          "Free grant invoice was not fully discounted to $0. Check that STRIPE_SUPPORT_COUPON is a 100%-off coupon that applies to the credit product.",
        );
      }

      // A non-free grant must cost something. Billing `quantity × price` lets
      // Stripe round a tiny fractional total down to $0, which would finalize
      // as paid and silently grant credits for free. Reject it so the admin
      // raises the credit amount, picks a higher price, or marks it free —
      // this preserves the old `getCreditTopUpTotalMinorUnits` >= 1 invariant.
      if (!params.markFree && (invoice.amount_due ?? 0) === 0) {
        throw new CreditGrantValidationError(
          "Grant total rounded to $0. Increase the credit amount, choose a higher price, or mark the grant as free.",
        );
      }

      // A free ($0) grant finalizes as paid immediately, so grant the credits
      // now instead of waiting on the invoice.paid webhook. Non-free grants
      // stay open until an admin marks them paid (no "Mark as paid" step is
      // shown for an already-paid free grant).
      if (invoice.status === "paid") {
        await grantCreditsForPaidInvoice(invoice, target);
      }

      return toInvoiceSummary(
        invoice,
        target,
        params.credits,
        params.ttlDays,
        accountId,
      );
    },

    /**
     * Marks a credit-grant invoice as paid and grants the credits instantly by
     * running the same invoice-paid automation the webhook uses. Granting is
     * idempotent: the shared reference-id dedup prevents a double grant when the
     * `invoice.paid` webhook later arrives (or is retried).
     */
    async markGrantInvoicePaid(
      invoiceId: string,
    ): Promise<CreditGrantInvoiceSummary> {
      const existing = await stripeClient.getInvoice(invoiceId);

      if (existing.metadata?.grant_source !== ADMIN_CREDIT_GRANT_SOURCE) {
        throw new CreditGrantValidationError(
          "Invoice is not an admin credit grant",
        );
      }

      const stripeCustomerId =
        typeof existing.customer === "string"
          ? existing.customer
          : (existing.customer?.id ?? null);
      if (!stripeCustomerId) {
        throw new CreditGrantValidationError("Invoice has no customer");
      }

      // Resolve the target user-first to mirror the webhook
      // (`handleInvoicePaidEvent` resolves a user customer before falling back
      // to an organization). An org-first lookup would never resolve a user
      // customer.
      const user = await userRepository.getUserByStripeCustomerId(
        stripeCustomerId,
        prisma,
      );

      let target: TargetIdentity;

      if (user) {
        target = { targetType: "user", id: user.id, name: user.name };
      } else {
        const organization =
          await organizationRepository.getOrganizationByStripeCustomerId(
            stripeCustomerId,
            prisma,
          );
        if (!organization) {
          throw new CreditGrantValidationError(
            "Invoice does not belong to a user or organization",
          );
        }
        target = {
          targetType: "organization",
          id: organization.id,
          name: organization.name,
        };
      }

      // A non-zero invoice still open is marked paid out of band; a $0 invoice
      // is already "paid" on finalization, so we skip the pay call there.
      const paidInvoice =
        existing.status === "paid"
          ? existing
          : await stripeClient.payInvoiceOutOfBand(invoiceId);

      await grantCreditsForPaidInvoice(paidInvoice, target);

      const credits = Number(paidInvoice.metadata?.credits ?? 0);
      const ttlDaysRaw = paidInvoice.metadata?.ttl_days;
      const ttlDays = ttlDaysRaw ? Number(ttlDaysRaw) : null;

      const accountId = await stripeClient.getAccountId();
      return toInvoiceSummary(
        paidInvoice,
        target,
        Number.isFinite(credits) ? credits : 0,
        ttlDays !== null && Number.isFinite(ttlDays) ? ttlDays : null,
        accountId,
      );
    },
  };
})();
