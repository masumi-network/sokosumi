import * as Sentry from "@sentry/node";
import { CreditBucketReferenceType } from "@sokosumi/database";
import {
  buildOrganizationInvoiceCreditReferenceId,
  buildUserInvoiceCreditReferenceId,
  getCreditExpiryDate,
  resolveOrganizationBillingPlan,
  resolvePurchasedSeats,
} from "@sokosumi/database/helpers";
import {
  organizationRepository,
  subscriptionRepository,
  userRepository,
} from "@sokosumi/database/repositories";
import { convertCreditsToCents } from "@sokosumi/utils";
import type Stripe from "stripe";

import { stripeClient } from "@/clients/stripe.client";
import { getEnv } from "@/config/env";
import { notifyInvoicePaid } from "@/helpers/billing-notifications";
import { isPrismaRecordNotFoundError } from "@/helpers/prisma";
import prisma from "@/lib/db/prisma";
import { getSubscriptionCatalog } from "@/services/subscription-catalog.service";
import { markOutOfCreditsTasksAsToppedUp } from "@/services/task-topup.service";

/**
 * Port of the web app's `handleInvoicePaidEvent`
 * (Core `stripe-backed-subscription.service.ts`).
 *
 * Unknown `cus_` is not a silent 200: retrieve the Stripe Customer and try
 * metadata / email write-back (same owner fields as `customer.created`).
 * Permanent misses (deleted customer, no metadata, no email match) ack after
 * Sentry so Stripe stops retrying. Transient Stripe/DB failures still throw.
 */

const SUBSCRIPTION_METADATA_CREDIT_BILLING_REASONS = new Set([
  "subscription_create",
  "subscription_cycle",
]);
const SUBSCRIPTION_UPDATE_BILLING_REASON = "subscription_update";

interface InvoiceCreditGrant {
  bucketUserId: string | null;
  credits: number;
  expiresAt: Date | null;
  referenceId: string;
  referenceType: CreditBucketReferenceType;
  userId: string | null;
}

interface SubscriptionLine {
  lineItem: Stripe.InvoiceLineItem;
  productId: string;
}

interface CreditScope {
  resolveDefaultQuantity: () => Promise<number>;
}

interface SubscriptionCreditTotals {
  maxSubscriptionPeriodEndUnix: number | null;
  paidOrCycleSubscriptionCredits: number;
}

interface AppliedSubscriptionCredits {
  subscriptionCredits: number;
  subscriptionCreditsExpiry: Date | null;
}

interface BuildInvoiceCreditGrantsParams {
  oneTimeTopUpExpiresAt: Date | null;
  oneTimeTopUpCredits: number;
  oneTimeTopUpReferenceType: CreditBucketReferenceType;
  organizationId: string | null;
  skipOrganizationSubscriptionSplit: boolean;
  subscriptionCredits: number;
  subscriptionCreditsExpiry: Date | null;
  userId: string | null;
  invoiceId: string;
}

function getTopUpCreditsFromInvoiceMetadata(
  invoice: Stripe.Invoice,
): number | null {
  const metadataCredits = invoice.metadata?.credits;
  if (!metadataCredits) {
    return null;
  }

  const credits = Number(metadataCredits);
  if (!Number.isInteger(credits) || credits <= 0) {
    return null;
  }

  return credits;
}

/**
 * Reads `ttl_days` from invoice metadata for credit grants.
 * - Missing, empty, invalid, negative, or zero → no expiry (`expiresAt` null).
 * - Positive integer → expiry after that many days from the invoice time.
 */
function getTopUpExpiryDaysFromInvoiceMetadata(
  invoice: Stripe.Invoice,
): number | null {
  const ttlDaysRaw = invoice.metadata?.ttl_days;
  if (ttlDaysRaw === undefined) {
    return null;
  }

  const normalizedTtlDays = ttlDaysRaw.trim();
  if (!normalizedTtlDays) {
    return null;
  }

  const ttlDays = Number(normalizedTtlDays);
  if (!Number.isInteger(ttlDays) || ttlDays <= 0) {
    return null;
  }

  return ttlDays;
}

function resolveInvoiceCreatedAt(invoice: Stripe.Invoice): Date {
  if (typeof invoice.created === "number" && Number.isFinite(invoice.created)) {
    return new Date(invoice.created * 1000);
  }

  return new Date();
}

function resolveTopUpGrantPolicy(invoice: Stripe.Invoice): {
  expiresAt: Date | null;
  referenceType: CreditBucketReferenceType;
} {
  // Honor an explicit `ttl_days` expiry whenever it is present, regardless of
  // the paid amount. Standard paid top-ups never set `ttl_days`, so they keep
  // their non-expiring behavior; admin-granted credits can opt into an expiry
  // even on non-zero invoices.
  const invoiceCreatedAt = resolveInvoiceCreatedAt(invoice);
  const topUpExpiryDays = getTopUpExpiryDaysFromInvoiceMetadata(invoice);
  const expiresAt =
    topUpExpiryDays === null
      ? null
      : getCreditExpiryDate(invoiceCreatedAt, topUpExpiryDays);

  return {
    expiresAt,
    referenceType:
      invoice.amount_paid > 0
        ? CreditBucketReferenceType.STRIPE_TOPUP
        : CreditBucketReferenceType.STRIPE_FREE,
  };
}

function getSubscriptionCreditExpiry(params: {
  invoiceId: string;
  maxPeriodEndUnix: number | null;
}): Date {
  if (params.maxPeriodEndUnix === null) {
    throw new Error(
      `Missing subscription period end for invoice ${params.invoiceId}`,
    );
  }

  return new Date(params.maxPeriodEndUnix * 1000);
}

function calculateProratedSubscriptionCredits(params: {
  invoiceId: string;
  lineAmount: number;
  monthlyAmount: number;
  planCredits: number;
  productId: string;
}): number {
  if (params.lineAmount === 0) {
    return 0;
  }

  if (params.monthlyAmount <= 0) {
    throw new Error(
      `Invalid monthly amount for subscription product ${params.productId} on invoice ${params.invoiceId}`,
    );
  }

  return Math.trunc(
    (params.lineAmount * params.planCredits) / params.monthlyAmount,
  );
}

function shouldGrantSubscriptionCreditsForLine(params: {
  billingReason: Stripe.Invoice.BillingReason | null;
  invoiceAmountPaid: number;
  lineAmount: number;
}): boolean {
  const { billingReason } = params;
  if (billingReason === null) {
    return false;
  }

  if (SUBSCRIPTION_METADATA_CREDIT_BILLING_REASONS.has(billingReason)) {
    return true;
  }

  if (billingReason !== SUBSCRIPTION_UPDATE_BILLING_REASON) {
    return false;
  }

  return params.invoiceAmountPaid > 0 && params.lineAmount !== 0;
}

async function calculateSubscriptionCreditTotals(params: {
  invoiceId: string;
  isSubscriptionUpdate: boolean;
  resolveDefaultQuantity: () => Promise<number>;
  subscriptionLines: SubscriptionLine[];
}): Promise<SubscriptionCreditTotals> {
  let paidOrCycleSubscriptionCredits = 0;
  let maxSubscriptionPeriodEndUnix: number | null = null;

  if (params.subscriptionLines.length === 0) {
    return {
      maxSubscriptionPeriodEndUnix,
      paidOrCycleSubscriptionCredits,
    };
  }

  const subscriptionCatalog = await getSubscriptionCatalog();
  const catalogPlans = [
    subscriptionCatalog.free,
    subscriptionCatalog.starter,
    subscriptionCatalog.standard,
    subscriptionCatalog.pro,
  ];
  const catalogByProductId = new Map(
    catalogPlans.map((plan) => [
      plan.productId,
      {
        credits: plan.credits,
        monthlyAmount: plan.monthlyAmount,
      },
    ]),
  );

  for (const { lineItem, productId } of params.subscriptionLines) {
    const catalogPlan = catalogByProductId.get(productId);
    if (!catalogPlan) {
      throw new Error(
        `No credits found in subscription catalog for product ${productId}`,
      );
    }

    const lineAmount = lineItem.amount ?? 0;

    if (params.isSubscriptionUpdate) {
      paidOrCycleSubscriptionCredits += calculateProratedSubscriptionCredits({
        invoiceId: params.invoiceId,
        lineAmount,
        monthlyAmount: catalogPlan.monthlyAmount,
        planCredits: catalogPlan.credits,
        productId,
      });
    } else {
      let quantity = lineItem.quantity ?? 0;
      if (quantity <= 0) {
        quantity = await params.resolveDefaultQuantity();
      }

      if (quantity <= 0) {
        continue;
      }

      paidOrCycleSubscriptionCredits += catalogPlan.credits * quantity;
    }

    const periodEnd = lineItem.period?.end;
    if (typeof periodEnd === "number" && periodEnd > 0) {
      maxSubscriptionPeriodEndUnix = Math.max(
        periodEnd,
        maxSubscriptionPeriodEndUnix ?? 0,
      );
    }
  }

  return {
    maxSubscriptionPeriodEndUnix,
    paidOrCycleSubscriptionCredits,
  };
}

async function finalizeAppliedSubscriptionCredits(params: {
  invoiceId: string;
  isSubscriptionUpdate: boolean;
  totals: SubscriptionCreditTotals;
}): Promise<AppliedSubscriptionCredits> {
  let paidOrCycleSubscriptionCredits =
    params.totals.paidOrCycleSubscriptionCredits;
  if (params.isSubscriptionUpdate && paidOrCycleSubscriptionCredits < 0) {
    paidOrCycleSubscriptionCredits = 0;
  }

  const subscriptionCredits = paidOrCycleSubscriptionCredits;

  const subscriptionCreditsExpiry =
    subscriptionCredits > 0
      ? getSubscriptionCreditExpiry({
          invoiceId: params.invoiceId,
          maxPeriodEndUnix: params.totals.maxSubscriptionPeriodEndUnix,
        })
      : null;

  return {
    subscriptionCredits,
    subscriptionCreditsExpiry,
  };
}

function buildInvoiceCreditGrants(
  params: BuildInvoiceCreditGrantsParams,
): InvoiceCreditGrant[] {
  const creditGrants: InvoiceCreditGrant[] = [];

  if (params.oneTimeTopUpCredits > 0) {
    if (params.organizationId) {
      creditGrants.push({
        bucketUserId: null,
        credits: params.oneTimeTopUpCredits,
        expiresAt: params.oneTimeTopUpExpiresAt,
        referenceId: buildOrganizationInvoiceCreditReferenceId(
          params.organizationId,
          params.invoiceId,
          "topup",
        ),
        referenceType: params.oneTimeTopUpReferenceType,
        userId: null,
      });
    } else {
      if (params.userId === null) {
        throw new Error(
          `Missing user for personal invoice ${params.invoiceId}`,
        );
      }
      creditGrants.push({
        bucketUserId: params.userId,
        credits: params.oneTimeTopUpCredits,
        expiresAt: params.oneTimeTopUpExpiresAt,
        referenceId: buildUserInvoiceCreditReferenceId(
          params.userId,
          params.invoiceId,
          "topup",
        ),
        referenceType: params.oneTimeTopUpReferenceType,
        userId: params.userId,
      });
    }
  }

  if (params.subscriptionCredits <= 0) {
    return creditGrants;
  }

  if (!params.organizationId) {
    if (params.userId === null) {
      throw new Error(`Missing user for personal invoice ${params.invoiceId}`);
    }
    creditGrants.push({
      bucketUserId: params.userId,
      credits: params.subscriptionCredits,
      expiresAt: params.subscriptionCreditsExpiry,
      referenceId: buildUserInvoiceCreditReferenceId(
        params.userId,
        params.invoiceId,
        "subscription",
      ),
      referenceType: "STRIPE_SUBSCRIPTION_PERIOD",
      userId: params.userId,
    });

    return creditGrants;
  }

  if (params.skipOrganizationSubscriptionSplit) {
    return creditGrants;
  }

  creditGrants.push({
    bucketUserId: null,
    credits: params.subscriptionCredits,
    expiresAt: params.subscriptionCreditsExpiry,
    referenceId: buildOrganizationInvoiceCreditReferenceId(
      params.organizationId,
      params.invoiceId,
      "subscription",
    ),
    referenceType: "STRIPE_SUBSCRIPTION_PERIOD",
    userId: null,
  });

  return creditGrants;
}

interface InvoiceCreditOwner {
  organizationId: string | null;
  userId: string | null;
}

function isStripeResourceMissing(error: unknown): boolean {
  return (
    error !== null &&
    typeof error === "object" &&
    "code" in error &&
    (error as { code: unknown }).code === "resource_missing"
  );
}

async function writeBackUserStripeCustomerId(
  userId: string,
  stripeCustomerId: string,
): Promise<boolean> {
  try {
    await prisma.user.update({
      where: { id: userId },
      data: { stripeCustomerId },
    });
    return true;
  } catch (error) {
    if (isPrismaRecordNotFoundError(error)) {
      return false;
    }
    throw error;
  }
}

async function writeBackOrganizationStripeCustomerId(
  organizationId: string,
  stripeCustomerId: string,
): Promise<boolean> {
  try {
    await prisma.organization.update({
      where: { id: organizationId },
      data: { stripeCustomerId },
    });
    return true;
  } catch (error) {
    if (isPrismaRecordNotFoundError(error)) {
      return false;
    }
    throw error;
  }
}

async function retrieveStripeCustomerForInvoice(
  stripeCustomerId: string,
): Promise<Stripe.Customer | null> {
  try {
    const customer = await stripeClient.retrieveCustomer(stripeCustomerId);
    if (customer.deleted) {
      return null;
    }
    return customer;
  } catch (error) {
    // Missing/deleted on Stripe is permanent. Timeouts, 5xx, and rate limits
    // stay thrown so Stripe retries.
    if (isStripeResourceMissing(error)) {
      return null;
    }
    throw error;
  }
}

async function resolveOwnerFromStripeCustomer(
  customer: Stripe.Customer,
): Promise<InvoiceCreditOwner | null> {
  const metadata = customer.metadata;
  if (metadata?.customerType === "user" && metadata.userId) {
    const written = await writeBackUserStripeCustomerId(
      metadata.userId,
      customer.id,
    );
    return written ? { organizationId: null, userId: metadata.userId } : null;
  }

  if (metadata?.customerType === "organization" && metadata.organizationId) {
    const written = await writeBackOrganizationStripeCustomerId(
      metadata.organizationId,
      customer.id,
    );
    return written
      ? { organizationId: metadata.organizationId, userId: null }
      : null;
  }

  const email = customer.email?.trim();
  if (!email) {
    return null;
  }

  const user = await prisma.user.findFirst({
    where: { email: { equals: email, mode: "insensitive" } },
    select: { id: true, stripeCustomerId: true },
  });
  if (!user) {
    return null;
  }
  if (user.stripeCustomerId && user.stripeCustomerId !== customer.id) {
    return null;
  }
  if (!user.stripeCustomerId) {
    const written = await writeBackUserStripeCustomerId(user.id, customer.id);
    return written ? { organizationId: null, userId: user.id } : null;
  }

  return { organizationId: null, userId: user.id };
}

async function resolveInvoiceCreditOwner(
  stripeCustomerId: string,
): Promise<InvoiceCreditOwner | null> {
  const user = await userRepository.getUserByStripeCustomerId(
    stripeCustomerId,
    prisma,
  );
  if (user) {
    return { organizationId: null, userId: user.id };
  }

  const organization =
    await organizationRepository.getOrganizationByStripeCustomerId(
      stripeCustomerId,
      prisma,
    );
  if (organization) {
    return { organizationId: organization.id, userId: null };
  }

  const customer = await retrieveStripeCustomerForInvoice(stripeCustomerId);
  if (!customer) {
    return null;
  }

  return await resolveOwnerFromStripeCustomer(customer);
}

function capturePermanentUnknownInvoiceCustomer(params: {
  invoiceId: string;
  stripeCustomerId: string;
}): void {
  Sentry.captureException(
    new Error(
      `Stripe customer ${params.stripeCustomerId} is not linked to a user or organization for invoice ${params.invoiceId}`,
    ),
    {
      extra: {
        invoiceId: params.invoiceId,
        stripeCustomerId: params.stripeCustomerId,
      },
      tags: {
        context: "invoice_paid_unknown_customer",
        stripeEventType: "invoice.paid",
      },
    },
  );
}

export async function handleInvoicePaidEvent(
  invoice: Stripe.Invoice,
): Promise<void> {
  if (!invoice.id) {
    return;
  }
  const invoiceId = invoice.id;

  if (!invoice.customer) {
    return;
  }

  if (invoice.amount_paid === null) {
    return;
  }

  const stripeCustomerId =
    typeof invoice.customer === "string"
      ? invoice.customer
      : invoice.customer.id;

  const owner = await resolveInvoiceCreditOwner(stripeCustomerId);
  if (!owner) {
    capturePermanentUnknownInvoiceCustomer({
      invoiceId,
      stripeCustomerId,
    });
    return;
  }

  const userId = owner.userId;
  const organizationId = owner.organizationId;
  let purchasedSeats = 1;

  if (organizationId) {
    const subscription =
      await subscriptionRepository.resolveActiveSubscriptionByReferenceId(
        organizationId,
        prisma,
      );

    purchasedSeats = resolvePurchasedSeats(subscription?.seats);
  }

  const creditScope: CreditScope = organizationId
    ? {
        resolveDefaultQuantity: async () => purchasedSeats,
      }
    : {
        resolveDefaultQuantity: async () => 1,
      };

  const env = getEnv();
  const creditProductId = env.STRIPE_CREDIT_PRODUCT_ID;
  const subscriptionProductIds = new Set([
    env.STRIPE_STARTER_SUBSCRIPTION_PRODUCT_ID,
    env.STRIPE_STANDARD_SUBSCRIPTION_PRODUCT_ID,
    env.STRIPE_PRO_SUBSCRIPTION_PRODUCT_ID,
  ]);

  const lineItems = invoice.lines?.data;
  if (!lineItems || lineItems.length === 0) {
    return;
  }

  const billingReason = invoice.billing_reason;
  const topUpCreditsFromMetadata = getTopUpCreditsFromInvoiceMetadata(invoice);
  let oneTimeTopUpCredits = topUpCreditsFromMetadata ?? 0;
  const oneTimeTopUpGrantPolicy = resolveTopUpGrantPolicy(invoice);
  const subscriptionLines: SubscriptionLine[] = [];

  for (const lineItem of lineItems) {
    if (lineItem.pricing && typeof lineItem.pricing === "object") {
      const productId = lineItem.pricing.price_details?.product;
      if (!productId || typeof productId !== "string") {
        continue;
      }

      if (productId === creditProductId) {
        if (topUpCreditsFromMetadata === null) {
          oneTimeTopUpCredits += lineItem.quantity ?? 0;
        }
        continue;
      }

      const lineAmount = lineItem.amount ?? 0;
      if (
        !shouldGrantSubscriptionCreditsForLine({
          billingReason,
          invoiceAmountPaid: invoice.amount_paid,
          lineAmount,
        })
      ) {
        continue;
      }

      if (subscriptionProductIds.has(productId)) {
        subscriptionLines.push({ lineItem, productId });
      }
    }
  }

  const isSubscriptionUpdate =
    billingReason === SUBSCRIPTION_UPDATE_BILLING_REASON;
  const subscriptionCreditTotals = await calculateSubscriptionCreditTotals({
    invoiceId,
    isSubscriptionUpdate,
    resolveDefaultQuantity: creditScope.resolveDefaultQuantity,
    subscriptionLines,
  });
  const { subscriptionCredits, subscriptionCreditsExpiry } =
    await finalizeAppliedSubscriptionCredits({
      invoiceId,
      isSubscriptionUpdate,
      totals: subscriptionCreditTotals,
    });

  let skipOrganizationSubscriptionSplit = false;
  // True once any grant for this invoice is known to exist, from this attempt
  // or an earlier one: a retry after a crash between the commit and the
  // notification must still settle the warnings the credits answer.
  let creditsLanded = false;
  if (subscriptionCredits > 0 && organizationId) {
    const billingPlan = await resolveOrganizationBillingPlan(
      organizationId,
      prisma,
    );
    if (
      billingPlan.mode === "enterprise_contract" &&
      billingPlan.isConsumable
    ) {
      skipOrganizationSubscriptionSplit = true;
    }
  }
  if (
    subscriptionCredits > 0 &&
    organizationId &&
    !skipOrganizationSubscriptionSplit
  ) {
    const existingOrganizationInvoiceSubscriptionBucket =
      await prisma.creditBucket.findUnique({
        where: {
          referenceId_referenceType: {
            referenceId: buildOrganizationInvoiceCreditReferenceId(
              organizationId,
              invoiceId,
              "subscription",
            ),
            referenceType: CreditBucketReferenceType.STRIPE_SUBSCRIPTION_PERIOD,
          },
        },
        select: {
          id: true,
        },
      });

    if (existingOrganizationInvoiceSubscriptionBucket) {
      skipOrganizationSubscriptionSplit = true;
      creditsLanded = true;
    }
  }

  const creditGrants = buildInvoiceCreditGrants({
    invoiceId,
    oneTimeTopUpExpiresAt: oneTimeTopUpGrantPolicy.expiresAt,
    oneTimeTopUpCredits,
    oneTimeTopUpReferenceType: oneTimeTopUpGrantPolicy.referenceType,
    organizationId,
    skipOrganizationSubscriptionSplit,
    subscriptionCredits,
    subscriptionCreditsExpiry,
    userId,
  });

  const wallet = { userId, organizationId };

  if (creditGrants.length === 0) {
    // Nothing to grant now, but a paid invoice still answers a failed payment.
    await notifyInvoicePaid(wallet, {
      invoiceId,
      topUpCredits: 0,
      creditsGranted: creditsLanded,
    });
    return;
  }

  let creditsGranted = false;

  await prisma.$transaction(async (tx) => {
    for (const grant of creditGrants) {
      const existingBucket = await tx.creditBucket.findUnique({
        where: {
          referenceId_referenceType: {
            referenceId: grant.referenceId,
            referenceType: grant.referenceType,
          },
        },
        select: { id: true },
      });

      if (existingBucket) {
        creditsLanded = true;
        continue;
      }

      const cents = convertCreditsToCents(grant.credits);
      if (organizationId) {
        await tx.transaction.create({
          data: {
            amount: cents,
            organizationId,
            userId: null,
            sourceCreditBucket: {
              create: {
                amount: cents,
                expiresAt: grant.expiresAt,
                referenceId: grant.referenceId,
                referenceType: grant.referenceType,
                userId: grant.bucketUserId,
                organizationId,
              },
            },
          },
        });
      } else {
        if (grant.userId === null) {
          throw new Error(
            `Missing user for personal invoice grant ${grant.referenceId}`,
          );
        }
        await tx.transaction.create({
          data: {
            amount: cents,
            user: { connect: { id: grant.userId } },
            sourceCreditBucket: {
              create: {
                amount: cents,
                expiresAt: grant.expiresAt,
                referenceId: grant.referenceId,
                referenceType: grant.referenceType,
                userId: grant.bucketUserId,
                organizationId,
              },
            },
          },
        });
      }

      creditsGranted = true;
      creditsLanded = true;
    }

    if (creditsGranted) {
      await markOutOfCreditsTasksAsToppedUp({
        userId,
        organizationId,
        tx,
      });
    }
  });

  // After the commit, because the receipt publishes over realtime and a
  // grant that rolled back must not be announced.
  await notifyInvoicePaid(wallet, {
    invoiceId,
    topUpCredits: oneTimeTopUpCredits,
    creditsGranted: creditsLanded,
  });
}
