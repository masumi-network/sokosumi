import "server-only";

import {
  CreditBucketReferenceType,
  MemberRole,
  Prisma,
  TaskEventOrigin,
  TaskStatus,
} from "@sokosumi/database";
import {
  buildOrganizationInvoiceCreditReferenceId,
  buildOrganizationMemberSubscriptionReferenceId,
  buildUserInvoiceCreditReferenceId,
  convertCentsToCredits,
  convertCreditsToCents,
  escapeStringForLike,
  FREE_CREDITS_EXPIRY_DAYS,
  getCreditExpiryDate,
  ORGANIZATION_MEMBER_SUBSCRIPTION_REFERENCE_PREFIX,
  PAID_TOPUP_CREDITS_EXPIRY_DAYS,
} from "@sokosumi/database/helpers";
import {
  memberRepository,
  organizationRepository,
  userRepository,
} from "@sokosumi/database/repositories";
import Stripe from "stripe";

import { getEnvSecrets } from "@/config/env.secrets";
import prisma from "@/lib/db/prisma";
import { stripeService } from "@/lib/services";
import { getSubscriptionCatalog } from "@/lib/stripe/subscription-catalog";

const stripeInstance = new Stripe(getEnvSecrets().STRIPE_SECRET_KEY);
const SUBSCRIPTION_METADATA_CREDIT_BILLING_REASONS = new Set([
  "subscription_create",
  "subscription_cycle",
]);
const SUBSCRIPTION_UPDATE_BILLING_REASON = "subscription_update";

interface InvoiceCreditGrant {
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
  buildGrantedCreditsWhere: (expiresAt: Date) => Prisma.CreditBucketWhereInput;
  resolveDefaultQuantity: () => Promise<number>;
}

interface SubscriptionCreditTotals {
  freeSubscriptionUpdateTargetCredits: number;
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
  organizationMemberUserIds: string[];
  skipOrganizationSubscriptionSplit: boolean;
  subscriptionCredits: number;
  subscriptionCreditsExpiry: Date | null;
  userId: string;
  invoiceId: string;
}

function isPrismaRecordNotFoundError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "P2025"
  );
}

async function markOutOfCreditsTasksAsToppedUp(params: {
  organizationId: string | null;
  tx: Prisma.TransactionClient;
  userId: string;
}): Promise<void> {
  const tasks = await params.tx.task.findMany({
    where: {
      ...(params.organizationId
        ? { organizationId: params.organizationId }
        : { userId: params.userId }),
      status: TaskStatus.OUT_OF_CREDITS,
    },
    select: {
      id: true,
    },
  });

  for (const task of tasks) {
    try {
      await params.tx.task.update({
        where: {
          id: task.id,
          status: TaskStatus.OUT_OF_CREDITS,
        },
        data: {
          status: TaskStatus.CREDITS_TOPPED_UP,
          events: {
            create: {
              status: TaskStatus.CREDITS_TOPPED_UP,
              origin: TaskEventOrigin.SOKOSUMI,
              userId: params.userId,
              coworkerId: null,
            },
          },
        },
      });
    } catch (error) {
      if (isPrismaRecordNotFoundError(error)) {
        continue;
      }

      throw error;
    }
  }
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

function resolveInvoiceCreatedAt(invoice: Stripe.Invoice): Date {
  if (typeof invoice.created === "number" && Number.isFinite(invoice.created)) {
    return new Date(invoice.created * 1000);
  }

  return new Date();
}

function resolveTopUpGrantPolicy(invoice: Stripe.Invoice): {
  expiresAt: Date;
  referenceType: CreditBucketReferenceType;
} {
  const invoiceCreatedAt = resolveInvoiceCreatedAt(invoice);

  if (invoice.amount_paid > 0) {
    return {
      expiresAt: getCreditExpiryDate(
        invoiceCreatedAt,
        PAID_TOPUP_CREDITS_EXPIRY_DAYS,
      ),
      referenceType: CreditBucketReferenceType.STRIPE_TOPUP,
    };
  }

  return {
    expiresAt: getCreditExpiryDate(invoiceCreatedAt, FREE_CREDITS_EXPIRY_DAYS),
    referenceType: CreditBucketReferenceType.STRIPE_FREE,
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
  freeSubscriptionProductId: string;
  invoiceAmountPaid: number;
  lineAmount: number;
  productId: string;
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

  if (params.productId === params.freeSubscriptionProductId) {
    return true;
  }

  return params.invoiceAmountPaid > 0 && params.lineAmount !== 0;
}

async function getGrantedSubscriptionCreditsForPeriod(
  where: Prisma.CreditBucketWhereInput,
): Promise<number> {
  const aggregateResult = await prisma.creditBucket.aggregate({
    _sum: {
      amount: true,
    },
    where,
  });

  const grantedCents = aggregateResult._sum.amount;
  if (grantedCents === null) {
    return 0;
  }

  return Math.max(0, Math.trunc(convertCentsToCredits(grantedCents)));
}

async function calculateSubscriptionCreditTotals(params: {
  invoiceId: string;
  isSubscriptionUpdate: boolean;
  maxSeatGrantQuantity: number | null;
  organizationId: string | null;
  resolveDefaultQuantity: () => Promise<number>;
  subscriptionLines: SubscriptionLine[];
}): Promise<SubscriptionCreditTotals> {
  let paidOrCycleSubscriptionCredits = 0;
  let freeSubscriptionUpdateTargetCredits = 0;
  let maxSubscriptionPeriodEndUnix: number | null = null;

  if (params.subscriptionLines.length === 0) {
    return {
      freeSubscriptionUpdateTargetCredits,
      maxSubscriptionPeriodEndUnix,
      paidOrCycleSubscriptionCredits,
    };
  }

  const subscriptionCatalog = await getSubscriptionCatalog(stripeInstance);
  const catalogByProductId = new Map(
    Object.values(subscriptionCatalog).map((plan) => [
      plan.productId,
      {
        credits: plan.credits,
        monthlyAmount: plan.monthlyAmount,
      },
    ]),
  );

  let maxFreePlanQuantity = 0;
  let freePlanCreditsPerSeat = 0;

  function logSeatCreditCapApplied(data: {
    activeMembers: number;
    billedSeats: number;
    grantedSeats: number;
    productId: string;
  }): void {
    console.log(
      `⚠️ seat_credit_cap_applied invoiceId=${params.invoiceId} organizationId=${params.organizationId ?? "none"} productId=${data.productId} billedSeats=${data.billedSeats} activeMembers=${data.activeMembers} grantedSeats=${data.grantedSeats} droppedSeats=${data.billedSeats - data.grantedSeats}`,
    );
  }

  function capSeatsToActiveMembers(
    billedSeats: number,
    productId: string,
  ): number {
    if (params.maxSeatGrantQuantity === null) {
      return billedSeats;
    }

    const grantedSeats = Math.min(billedSeats, params.maxSeatGrantQuantity);
    if (billedSeats > grantedSeats) {
      logSeatCreditCapApplied({
        activeMembers: params.maxSeatGrantQuantity,
        billedSeats,
        grantedSeats,
        productId,
      });
    }

    return grantedSeats;
  }

  for (const { lineItem, productId } of params.subscriptionLines) {
    const catalogPlan = catalogByProductId.get(productId);
    if (!catalogPlan) {
      throw new Error(
        `No credits found in subscription catalog for product ${productId}`,
      );
    }

    const lineAmount = lineItem.amount ?? 0;

    if (params.isSubscriptionUpdate) {
      if (catalogPlan.monthlyAmount === 0) {
        let quantity = lineItem.quantity ?? 0;
        if (quantity <= 0) {
          continue;
        }

        quantity = capSeatsToActiveMembers(quantity, productId);
        if (quantity <= 0) {
          continue;
        }

        maxFreePlanQuantity = Math.max(maxFreePlanQuantity, quantity);
        freePlanCreditsPerSeat = catalogPlan.credits;
      } else {
        let proratedCredits = calculateProratedSubscriptionCredits({
          invoiceId: params.invoiceId,
          lineAmount,
          monthlyAmount: catalogPlan.monthlyAmount,
          planCredits: catalogPlan.credits,
          productId,
        });

        const billedQuantity = lineItem.quantity ?? 0;
        if (billedQuantity > 0) {
          const grantedQuantity = capSeatsToActiveMembers(
            billedQuantity,
            productId,
          );
          if (grantedQuantity <= 0) {
            continue;
          }

          proratedCredits = Math.trunc(
            (proratedCredits * grantedQuantity) / billedQuantity,
          );
        }

        paidOrCycleSubscriptionCredits += proratedCredits;
      }
    } else {
      let quantity = lineItem.quantity ?? 0;
      if (quantity <= 0) {
        quantity = await params.resolveDefaultQuantity();
      }

      quantity = capSeatsToActiveMembers(quantity, productId);

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

  if (maxFreePlanQuantity > 0 && freePlanCreditsPerSeat > 0) {
    freeSubscriptionUpdateTargetCredits =
      freePlanCreditsPerSeat * maxFreePlanQuantity;
  }

  return {
    freeSubscriptionUpdateTargetCredits,
    maxSubscriptionPeriodEndUnix,
    paidOrCycleSubscriptionCredits,
  };
}

async function finalizeAppliedSubscriptionCredits(params: {
  creditScope: CreditScope;
  invoiceId: string;
  isSubscriptionUpdate: boolean;
  totals: SubscriptionCreditTotals;
}): Promise<AppliedSubscriptionCredits> {
  let paidOrCycleSubscriptionCredits =
    params.totals.paidOrCycleSubscriptionCredits;
  if (params.isSubscriptionUpdate && paidOrCycleSubscriptionCredits < 0) {
    paidOrCycleSubscriptionCredits = 0;
  }

  let freeSubscriptionUpdateCredits =
    params.totals.freeSubscriptionUpdateTargetCredits;
  const freeSubscriptionUpdateExpiry =
    params.totals.freeSubscriptionUpdateTargetCredits > 0 &&
    typeof params.totals.maxSubscriptionPeriodEndUnix === "number" &&
    params.totals.maxSubscriptionPeriodEndUnix > 0
      ? new Date(params.totals.maxSubscriptionPeriodEndUnix * 1000)
      : null;

  if (
    freeSubscriptionUpdateExpiry &&
    params.totals.freeSubscriptionUpdateTargetCredits > 0
  ) {
    const alreadyGrantedCredits = await getGrantedSubscriptionCreditsForPeriod(
      params.creditScope.buildGrantedCreditsWhere(freeSubscriptionUpdateExpiry),
    );
    freeSubscriptionUpdateCredits = Math.max(
      0,
      params.totals.freeSubscriptionUpdateTargetCredits - alreadyGrantedCredits,
    );
  }

  const subscriptionCredits =
    paidOrCycleSubscriptionCredits + freeSubscriptionUpdateCredits;

  const subscriptionCreditsExpiry =
    subscriptionCredits > 0
      ? params.isSubscriptionUpdate &&
        paidOrCycleSubscriptionCredits === 0 &&
        freeSubscriptionUpdateCredits > 0 &&
        freeSubscriptionUpdateExpiry
        ? freeSubscriptionUpdateExpiry
        : getSubscriptionCreditExpiry({
            invoiceId: params.invoiceId,
            maxPeriodEndUnix: params.totals.maxSubscriptionPeriodEndUnix,
          })
      : null;

  return {
    subscriptionCredits,
    subscriptionCreditsExpiry,
  };
}

function getSortedUniqueMemberUserIds(
  members: Array<{ userId: string }>,
): string[] {
  return Array.from(new Set(members.map((member) => member.userId))).sort();
}

function splitCreditsByMember(params: {
  memberUserIds: string[];
  totalCredits: number;
}): Array<{ credits: number; userId: string }> {
  const { memberUserIds, totalCredits } = params;
  if (totalCredits <= 0 || memberUserIds.length === 0) {
    return [];
  }

  const baseCredits = Math.floor(totalCredits / memberUserIds.length);
  const remainder = totalCredits % memberUserIds.length;

  return memberUserIds
    .map((memberUserId, index) => ({
      userId: memberUserId,
      credits: baseCredits + (index < remainder ? 1 : 0),
    }))
    .filter((allocation) => allocation.credits > 0);
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

  const subscriptionReferenceSuffix = `${params.invoiceId}:subscription`;
  const splitGrants = splitCreditsByMember({
    memberUserIds: params.organizationMemberUserIds,
    totalCredits: params.subscriptionCredits,
  });

  for (const splitGrant of splitGrants) {
    creditGrants.push({
      credits: splitGrant.credits,
      expiresAt: params.subscriptionCreditsExpiry,
      referenceId: buildOrganizationMemberSubscriptionReferenceId(
        splitGrant.userId,
        subscriptionReferenceSuffix,
      ),
      referenceType: "STRIPE_SUBSCRIPTION_PERIOD",
      userId: splitGrant.userId,
    });
  }

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
  let organizationMemberUserIds: string[] = [];

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

      // Get organization members to find the owner to attribute the transaction
      const members = await memberRepository.getMembersByOrganizationId(
        organizationId,
        prisma,
      );
      organizationMemberUserIds = getSortedUniqueMemberUserIds(members);
      if (organizationMemberUserIds.length === 0) {
        console.log(`No members found for organization ${organizationId}`);
        return;
      }
      const ownerMember = members.find((m) => m.role === MemberRole.OWNER);

      if (!ownerMember) {
        console.log(`No owner found for organization ${organizationId}`);
        return;
      }
      userId = ownerMember.userId;
    } else {
      // Customer not found in our system
      console.log(
        `Stripe customer ${stripeCustomerId} not found in our system for invoice ${invoiceId}`,
      );
      return;
    }
  }

  const creditScope: CreditScope = organizationId
    ? {
        resolveDefaultQuantity: async () => organizationMemberUserIds.length,
        buildGrantedCreditsWhere: (expiresAt) => ({
          expiresAt,
          organizationId,
          referenceType: "STRIPE_SUBSCRIPTION_PERIOD",
          referenceId: {
            startsWith: ORGANIZATION_MEMBER_SUBSCRIPTION_REFERENCE_PREFIX,
          },
        }),
      }
    : {
        resolveDefaultQuantity: async () => 1,
        buildGrantedCreditsWhere: (expiresAt) => ({
          expiresAt,
          organizationId: null,
          referenceType: "STRIPE_SUBSCRIPTION_PERIOD",
          userId,
        }),
      };

  const env = getEnvSecrets();
  const creditProductId = env.STRIPE_CREDIT_PRODUCT_ID;
  const freeSubscriptionProductId = env.STRIPE_FREE_SUBSCRIPTION_PRODUCT_ID;
  const subscriptionProductIds = new Set([
    freeSubscriptionProductId,
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
  const metadataTopUpCredits = getTopUpCreditsFromInvoiceMetadata(invoice);
  const oneTimeTopUpCreditsFromMetadata = metadataTopUpCredits;
  let oneTimeTopUpCredits = oneTimeTopUpCreditsFromMetadata ?? 0;
  const oneTimeTopUpGrantPolicy = resolveTopUpGrantPolicy(invoice);
  const subscriptionLines: SubscriptionLine[] = [];

  for (const lineItem of lineItems) {
    if (lineItem.pricing && typeof lineItem.pricing === "object") {
      const productId = lineItem.pricing.price_details?.product;
      if (!productId || typeof productId !== "string") {
        continue;
      }

      if (productId === creditProductId) {
        if (oneTimeTopUpCreditsFromMetadata === null) {
          oneTimeTopUpCredits += lineItem.quantity ?? 0;
        }
        continue;
      }

      if (!subscriptionProductIds.has(productId)) {
        continue;
      }

      const lineAmount = lineItem.amount ?? 0;
      if (
        !shouldGrantSubscriptionCreditsForLine({
          billingReason,
          freeSubscriptionProductId,
          invoiceAmountPaid: invoice.amount_paid,
          lineAmount,
          productId,
        })
      ) {
        continue;
      }

      subscriptionLines.push({ lineItem, productId });
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
    maxSeatGrantQuantity: organizationId
      ? organizationMemberUserIds.length
      : null,
    organizationId,
    resolveDefaultQuantity: creditScope.resolveDefaultQuantity,
    subscriptionLines,
  });
  const { subscriptionCredits, subscriptionCreditsExpiry } =
    await finalizeAppliedSubscriptionCredits({
      creditScope,
      invoiceId,
      isSubscriptionUpdate,
      totals: subscriptionCreditTotals,
    });

  let skipOrganizationSubscriptionSplit = false;
  if (subscriptionCredits > 0 && organizationId) {
    const existingOrganizationInvoiceSubscriptionBucket =
      await prisma.creditBucket.findFirst({
        where: {
          organizationId,
          referenceType: CreditBucketReferenceType.STRIPE_SUBSCRIPTION_PERIOD,
          referenceId: {
            startsWith: ORGANIZATION_MEMBER_SUBSCRIPTION_REFERENCE_PREFIX,
            endsWith: escapeStringForLike(`:${invoiceId}:subscription`),
          },
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
    organizationMemberUserIds,
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
              userId: grant.userId,
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

export async function handleCustomerCreatedEvent(
  customer: Stripe.Customer,
): Promise<void> {
  const metadata = customer.metadata;
  switch (metadata?.customerType) {
    case "user": {
      const userId = metadata.userId;
      await prisma.user.update({
        where: { id: userId },
        data: { stripeCustomerId: customer.id },
      });
      console.log(`✅ Set user ${userId} stripe customer id to ${customer.id}`);

      const freeSubscriptionResult =
        await stripeService.ensurePersonalFreeSubscription(userId);
      if (freeSubscriptionResult.status === "created") {
        console.log(
          `✅ Created free subscription for user ${userId} (${freeSubscriptionResult.subscriptionId})`,
        );
      } else if (freeSubscriptionResult.status === "skipped") {
        console.log(
          `ℹ️ Skipped free subscription for user ${userId}: ${freeSubscriptionResult.reason}`,
        );
      } else {
        console.log(
          `⚠️ Failed free subscription enrollment for user ${userId}: ${freeSubscriptionResult.reason}`,
        );
      }

      const { couponApplied, invoiceId } =
        await stripeService.claimWelcomeCoupon(userId);
      if (couponApplied && invoiceId) {
        console.log(
          `✅ Claimed welcome coupon for user ${userId}, invoice: ${invoiceId}`,
        );
      } else {
        console.log(`⚠️ Failed to claim welcome coupon for user ${userId}`);
      }
      break;
    }
    case "organization": {
      await prisma.organization.update({
        where: { id: metadata.organizationId },
        data: { stripeCustomerId: customer.id },
      });
      console.log(
        `✅ Set organization ${metadata.organizationId} stripe customer id to ${customer.id}`,
      );

      const freeSubscriptionResult =
        await stripeService.ensureOrganizationFreeSubscription(
          metadata.organizationId,
        );
      if (freeSubscriptionResult.status === "created") {
        console.log(
          `✅ Created free subscription for organization ${metadata.organizationId} (${freeSubscriptionResult.subscriptionId})`,
        );
      } else if (freeSubscriptionResult.status === "skipped") {
        console.log(
          `ℹ️ Skipped free subscription for organization ${metadata.organizationId}: ${freeSubscriptionResult.reason}`,
        );
      } else {
        console.log(
          `⚠️ Failed free subscription enrollment for organization ${metadata.organizationId}: ${freeSubscriptionResult.reason}`,
        );
      }
      break;
    }
    default: {
      console.log(`Unknown customer type ${metadata?.customerType}`);
      break;
    }
  }
}

export async function handleCustomerUpdatedEvent(
  customer: Stripe.Customer,
): Promise<void> {
  // Check if this is an organization customer
  const metadata = customer.metadata;
  if (metadata?.customerType === "organization" && metadata?.organizationId) {
    const organizationId = metadata.organizationId;
    const customerEmail =
      typeof customer.email === "string" ? customer.email : null;

    // Get the current organization to compare emails
    const organization =
      await organizationRepository.getOrganizationWithRelationsById(
        organizationId,
        prisma,
      );

    if (!organization) {
      console.log(
        `Organization ${organizationId} not found for customer ${customer.id}`,
      );
      return;
    }

    // Only update if the email has actually changed
    if (organization.invoiceEmail !== customerEmail) {
      await organizationRepository.updateOrganizationInvoiceEmail(
        organizationId,
        customerEmail,
        prisma,
      );
      console.log(
        `✅ Updated organization ${organizationId} invoice email from ${organization.invoiceEmail} to ${customerEmail}`,
      );
    }
  } else if (metadata?.type === "user" && metadata?.userId) {
    // For user customers, we could update the user email if needed
    // Currently, user emails are managed through the auth system
    console.log(`User customer ${customer.id} updated, no action taken`);
  }
}
