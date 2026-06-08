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

import { stripeClient } from "@/lib/clients/stripe.client";
import prisma from "@/lib/db/prisma";
import {
  getCreditTopUpTotalMinorUnits,
  isPositiveIntegerCredits,
} from "@/lib/stripe/credit-topup-pricing";
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

interface ResolvedTarget {
  targetType: CreditGrantTargetType;
  id: string;
  name: string;
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
  target: { targetType: CreditGrantTargetType; id: string; name: string },
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

  async function resolveTarget(target: CreditGrantTarget): Promise<ResolvedTarget> {
    return target.targetType === "user"
      ? ensureUserStripeCustomerId(target.targetId)
      : ensureOrganizationStripeCustomerId(target.targetId);
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

    async createGrantInvoice(params: {
      target: CreditGrantTarget;
      credits: number;
      ttlDays: number | null;
      priceId: string | null;
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

      const target = await resolveTarget(params.target);

      const price = await resolvePrice(params.priceId);
      const totalMinorUnits = getCreditTopUpTotalMinorUnits(
        params.credits,
        price.amountPerCredit,
      );

      const invoice = await stripeClient.createCreditGrantInvoice({
        customerId: target.stripeCustomerId,
        credits: params.credits,
        totalMinorUnits,
        currency: price.currency,
        ttlDays: params.ttlDays ?? undefined,
      });

      const accountId = await stripeClient.getAccountId();
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

      let target: { targetType: CreditGrantTargetType; id: string; name: string };
      let expectedReferenceId: string;
      let grantedBucketWhere: {
        userId?: string;
        organizationId: string | null;
        referenceId: string;
      };

      if (user) {
        expectedReferenceId = buildUserInvoiceCreditReferenceId(
          user.id,
          invoiceId,
          "topup",
        );
        target = { targetType: "user", id: user.id, name: user.name };
        grantedBucketWhere = {
          userId: user.id,
          organizationId: null,
          referenceId: expectedReferenceId,
        };
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
        expectedReferenceId = buildOrganizationInvoiceCreditReferenceId(
          organization.id,
          invoiceId,
          "topup",
        );
        target = {
          targetType: "organization",
          id: organization.id,
          name: organization.name,
        };
        grantedBucketWhere = {
          organizationId: organization.id,
          referenceId: expectedReferenceId,
        };
      }

      // A non-zero invoice still open is marked paid out of band; a $0 invoice
      // is already "paid" on finalization, so we skip the pay call there.
      const paidInvoice =
        existing.status === "paid"
          ? existing
          : await stripeClient.payInvoiceOutOfBand(invoiceId);

      // Grant instantly via the shared automation. Idempotent against the
      // webhook that Stripe also fires for this invoice.
      await handleInvoicePaidEvent(paidInvoice);

      // handleInvoicePaidEvent can return early without granting (e.g. the
      // organization has no owner/members), leaving the invoice paid but no
      // credits issued. Verify the grant landed instead of reporting false
      // success; the invoice is already paid, so a re-run (after fixing
      // membership) is idempotent and will complete the grant.
      const grantedBucket = await prisma.creditBucket.findFirst({
        where: grantedBucketWhere,
        select: { id: true },
      });
      if (!grantedBucket) {
        throw new CreditGrantValidationError(
          "Invoice was marked paid but credits were not granted (the organization may have no owner). Resolve the issue and mark it paid again to retry.",
        );
      }

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
