import { CreditBucketReferenceType } from "@sokosumi/database";
import {
  buildOrganizationInvoiceCreditReferenceId,
  buildUserInvoiceCreditReferenceId,
  escapeStringForLike,
  getCreditExpiryDate,
  ORGANIZATION_MEMBER_SUBSCRIPTION_REFERENCE_PREFIX,
  resolveOrganizationBillingPlan,
  resolvePurchasedSeats,
} from "@sokosumi/database/helpers";
import {
  memberRepository,
  organizationRepository,
  subscriptionRepository,
  userRepository,
} from "@sokosumi/database/repositories";
import { convertCentsToCredits, convertCreditsToCents } from "@sokosumi/utils";
import type Stripe from "stripe";

import { getEnv } from "@/config/env";
import prisma from "@/lib/db/prisma";
import { getSubscriptionCatalog } from "@/services/subscription-catalog.service";
import { markOutOfCreditsTasksAsToppedUp } from "@/services/task-topup.service";

/**
 * Port of the web app's `handleInvoicePaidEvent`
 * (Core `stripe-backed-subscription.service.ts`). One deliberate behavior
 * change: an unknown Stripe customer THROWS instead of silently returning, so
 * the webhook responds 5xx and Stripe retries — the web path's silent 200
 * permanently lost the credits when the customer-id write-back had not landed
 * yet.
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
  userId: string;
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
  userId: string;
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
    const topUpReferenceId = params.organizationId
      ? buildOrganizationInvoiceCreditReferenceId(
          params.organizationId,
          params.invoiceId,
          "topup",
        )
      : buildUserInvoiceCreditReferenceId(
          params.userId,
          params.invoiceId,
          "topup",
        );

    creditGrants.push({
      bucketUserId: params.organizationId ? null : params.userId,
      credits: params.oneTimeTopUpCredits,
      expiresAt: params.oneTimeTopUpExpiresAt,
      referenceId: topUpReferenceId,
      referenceType: params.oneTimeTopUpReferenceType,
      userId: params.userId,
    });
  }

  if (params.subscriptionCredits <= 0) {
    return creditGrants;
  }

  if (!params.organizationId) {
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
    userId: params.userId,
  });

  return creditGrants;
}

export async function handleInvoicePaidEvent(
  invoice: Stripe.Invoice,
): Promise<void> {
  // Validate invoice has required data
  if (!invoice.id) {
    console.log(`Invoice has no ID`);
    return;
  }
  const invoiceId = invoice.id;

  if (!invoice.customer) {
    console.log(`Invoice ${invoiceId} has no customer`);
    return;
  }

  if (invoice.amount_paid === null) {
    console.log(`Invoice ${invoiceId} has no amount paid`);
    return;
  }

  // Get the Stripe customer ID from the invoice
  const stripeCustomerId =
    typeof invoice.customer === "string"
      ? invoice.customer
      : invoice.customer.id;

  // Look up the user or organization by stripeCustomerId
  let userId: string;
  let organizationId: string | null = null;
  let purchasedSeats = 1;

  // First, try to find a user with this stripeCustomerId
  const user = await userRepository.getUserByStripeCustomerId(
    stripeCustomerId,
    prisma,
  );

  if (user) {
    // This is a user purchase
    userId = user.id;
  } else {
    // Try to find an organization with this stripeCustomerId
    const organization =
      await organizationRepository.getOrganizationByStripeCustomerId(
        stripeCustomerId,
        prisma,
      );

    if (organization) {
      // This is an organization purchase
      organizationId = organization.id;

      const [members, subscription] = await Promise.all([
        memberRepository.getMembersByOrganizationId(organizationId, prisma),
        subscriptionRepository.resolveActiveSubscriptionByReferenceId(
          organizationId,
          prisma,
        ),
      ]);

      if (members.length === 0) {
        console.log(`No members found for organization ${organizationId}`);
        return;
      }

      purchasedSeats = resolvePurchasedSeats(subscription?.seats);

      const ownerUserId = await memberRepository.getOrganizationOwnerUserId(
        organizationId,
        prisma,
      );

      if (!ownerUserId) {
        console.log(`No owner found for organization ${organizationId}`);
        return;
      }
      userId = ownerUserId;
    } else {
      // Unlike the web handler, throw so the webhook responds 5xx and Stripe
      // retries — a silent 200 permanently drops the credits when the
      // customer-id write-back has not landed yet.
      throw new Error(
        `Stripe customer ${stripeCustomerId} not found in our system for invoice ${invoiceId}`,
      );
    }
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

  // Ensure invoice has line items
  const lineItems = invoice.lines?.data;
  if (!lineItems || lineItems.length === 0) {
    console.log(`Invoice ${invoiceId} has no line items to process`);
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

  if (
    billingReason &&
    !SUBSCRIPTION_METADATA_CREDIT_BILLING_REASONS.has(billingReason) &&
    billingReason !== SUBSCRIPTION_UPDATE_BILLING_REASON
  ) {
    console.log(
      `Skipping subscription credits for invoice ${invoiceId} due to billing reason ${billingReason}`,
    );
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
      await prisma.creditBucket.findFirst({
        where: {
          organizationId,
          referenceType: CreditBucketReferenceType.STRIPE_SUBSCRIPTION_PERIOD,
          OR: [
            {
              referenceId: buildOrganizationInvoiceCreditReferenceId(
                organizationId,
                invoiceId,
                "subscription",
              ),
            },
            {
              referenceId: {
                startsWith: ORGANIZATION_MEMBER_SUBSCRIPTION_REFERENCE_PREFIX,
                endsWith: escapeStringForLike(`:${invoiceId}:subscription`),
              },
            },
          ],
        },
        select: {
          id: true,
        },
      });

    if (existingOrganizationInvoiceSubscriptionBucket) {
      console.log(
        `✅ Organization invoice ${invoiceId} subscription grants already exist; skipping replay split`,
      );
      skipOrganizationSubscriptionSplit = true;
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

  if (creditGrants.length === 0) {
    console.log(
      `Invoice ${invoiceId} has no grantable credits (billing reason: ${invoice.billing_reason})`,
    );
    return;
  }

  await prisma.$transaction(async (tx) => {
    let creditsGranted = false;

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
        console.log(
          `✅ Bucket already exists for invoice reference ${grant.referenceId}, skipping creation`,
        );
        continue;
      }

      const cents = convertCreditsToCents(grant.credits);
      await tx.transaction.create({
        data: {
          amount: cents,
          user: { connect: { id: grant.userId } },
          ...(organizationId && {
            organization: { connect: { id: organizationId } },
          }),
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

      creditsGranted = true;

      console.log(
        `✅ Processed invoice ${invoiceId}: Created transaction and bucket with ${convertCentsToCredits(cents)} credits for ${organizationId ? `organization ${organizationId} member ${grant.userId}` : `user ${grant.userId}`}${grant.expiresAt ? ` (expires ${grant.expiresAt.toISOString()})` : ""}`,
      );
    }

    if (creditsGranted) {
      await markOutOfCreditsTasksAsToppedUp({
        userId,
        organizationId,
        tx,
      });
    }
  });
}
