import "server-only";

import { CreditBucketReferenceType, MemberRole } from "@sokosumi/database";
import {
  convertCentsToCredits,
  convertCreditsToCents,
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
const ACTIVE_ORGANIZATION_SUBSCRIPTION_STATUSES = [
  "active",
  "trialing",
  "past_due",
  "unpaid",
] as const;

interface InvoiceCreditGrant {
  credits: number;
  expiresAt: Date | null;
  referenceId: string;
  referenceType: CreditBucketReferenceType;
}

function getUpgradeCreditExpiry(
  invoice: Stripe.Invoice,
  periodDurationSeconds: number,
): Date {
  if (typeof invoice.created !== "number" || invoice.created <= 0) {
    throw new Error(
      `Missing invoice created timestamp for upgrade invoice ${invoice.id ?? "unknown"}`,
    );
  }

  return new Date((invoice.created + periodDurationSeconds) * 1000);
}

function getSubscriptionCreditExpiry(params: {
  invoice: Stripe.Invoice;
  invoiceId: string;
  maxPeriodDurationSeconds: number | null;
  maxPeriodEndUnix: number | null;
}): Date {
  if (params.invoice.billing_reason === SUBSCRIPTION_UPDATE_BILLING_REASON) {
    if (params.maxPeriodDurationSeconds === null) {
      throw new Error(
        `Missing subscription period duration for upgrade invoice ${params.invoiceId}`,
      );
    }

    return getUpgradeCreditExpiry(
      params.invoice,
      params.maxPeriodDurationSeconds,
    );
  }

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
  if (params.lineAmount <= 0) {
    return 0;
  }

  if (params.monthlyAmount <= 0) {
    throw new Error(
      `Invalid monthly amount for subscription product ${params.productId} on invoice ${params.invoiceId}`,
    );
  }

  return Math.floor(
    (params.lineAmount * params.planCredits) / params.monthlyAmount,
  );
}

async function resolveOrganizationSeatCount(
  organizationId: string,
): Promise<number> {
  const latestSubscription = await prisma.subscription.findFirst({
    where: {
      referenceId: organizationId,
      status: {
        in: [...ACTIVE_ORGANIZATION_SUBSCRIPTION_STATUSES],
      },
    },
    orderBy: [{ periodEnd: "desc" }, { updatedAt: "desc" }],
    select: {
      seats: true,
    },
  });

  if (
    latestSubscription?.seats &&
    Number.isFinite(latestSubscription.seats) &&
    latestSubscription.seats > 0
  ) {
    return latestSubscription.seats;
  }

  return 1;
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

  const env = getEnvSecrets();
  const creditProductId = env.STRIPE_CREDIT_PRODUCT_ID;
  const subscriptionProductIds = new Set([
    env.STRIPE_FREE_SUBSCRIPTION_PRODUCT_ID,
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

  const isPaidSubscriptionUpdate =
    invoice.billing_reason === SUBSCRIPTION_UPDATE_BILLING_REASON &&
    invoice.amount_paid > 0;
  const shouldGrantSubscriptionCredits =
    invoice.billing_reason !== null &&
    (SUBSCRIPTION_METADATA_CREDIT_BILLING_REASONS.has(invoice.billing_reason) ||
      isPaidSubscriptionUpdate);
  let oneTimeTopUpCredits = 0;
  const matchedSubscriptionProducts = new Set<string>();

  for (const lineItem of lineItems) {
    if (lineItem.pricing && typeof lineItem.pricing === "object") {
      const productId = lineItem.pricing.price_details?.product;
      if (!productId || typeof productId !== "string") {
        continue;
      }

      if (productId === creditProductId) {
        oneTimeTopUpCredits += lineItem.quantity ?? 0;
        continue;
      }

      if (
        shouldGrantSubscriptionCredits &&
        subscriptionProductIds.has(productId)
      ) {
        if (
          invoice.billing_reason === SUBSCRIPTION_UPDATE_BILLING_REASON &&
          (lineItem.amount ?? 0) <= 0
        ) {
          continue;
        }
        matchedSubscriptionProducts.add(productId);
      }
    }
  }

  if (!shouldGrantSubscriptionCredits && invoice.billing_reason) {
    console.log(
      `Skipping subscription credits for invoice ${invoiceId} due to billing reason ${invoice.billing_reason}`,
    );
  }

  let subscriptionCredits = 0;
  let maxSubscriptionPeriodEndUnix: number | null = null;
  let maxSubscriptionPeriodDurationSeconds: number | null = null;
  let organizationSeatCount: number | null = null;
  if (matchedSubscriptionProducts.size > 0) {
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

    for (const lineItem of lineItems) {
      if (!lineItem.pricing || typeof lineItem.pricing !== "object") {
        continue;
      }
      const productId = lineItem.pricing.price_details?.product;
      if (!productId || typeof productId !== "string") {
        continue;
      }
      if (!matchedSubscriptionProducts.has(productId)) {
        continue;
      }

      const catalogPlan = catalogByProductId.get(productId);
      if (!catalogPlan) {
        throw new Error(
          `No credits found in subscription catalog for product ${productId}`,
        );
      }

      const lineAmount = lineItem.amount ?? 0;
      if (
        invoice.billing_reason === SUBSCRIPTION_UPDATE_BILLING_REASON &&
        lineAmount <= 0
      ) {
        continue;
      }

      if (invoice.billing_reason === SUBSCRIPTION_UPDATE_BILLING_REASON) {
        subscriptionCredits += calculateProratedSubscriptionCredits({
          invoiceId,
          lineAmount,
          monthlyAmount: catalogPlan.monthlyAmount,
          planCredits: catalogPlan.credits,
          productId,
        });
      } else {
        let quantity = lineItem.quantity ?? 0;
        if (quantity <= 0) {
          if (organizationId) {
            if (organizationSeatCount === null) {
              organizationSeatCount =
                await resolveOrganizationSeatCount(organizationId);
            }
            quantity = organizationSeatCount;
          } else {
            quantity = 1;
          }
        }

        if (quantity <= 0) {
          continue;
        }

        subscriptionCredits += catalogPlan.credits * quantity;
      }

      const periodStart = lineItem.period?.start;
      const periodEnd = lineItem.period?.end;
      if (typeof periodEnd === "number" && periodEnd > 0) {
        maxSubscriptionPeriodEndUnix = Math.max(
          periodEnd,
          maxSubscriptionPeriodEndUnix ?? 0,
        );
      }
      if (
        typeof periodStart === "number" &&
        periodStart > 0 &&
        typeof periodEnd === "number" &&
        periodEnd > periodStart
      ) {
        const periodDurationSeconds = periodEnd - periodStart;
        maxSubscriptionPeriodDurationSeconds = Math.max(
          periodDurationSeconds,
          maxSubscriptionPeriodDurationSeconds ?? 0,
        );
      }
    }
  }

  const subscriptionCreditsExpiry =
    subscriptionCredits > 0
      ? getSubscriptionCreditExpiry({
          invoice,
          invoiceId,
          maxPeriodDurationSeconds: maxSubscriptionPeriodDurationSeconds,
          maxPeriodEndUnix: maxSubscriptionPeriodEndUnix,
        })
      : null;

  const creditGrants: InvoiceCreditGrant[] = [];
  if (oneTimeTopUpCredits > 0) {
    creditGrants.push({
      credits: oneTimeTopUpCredits,
      expiresAt: null,
      referenceId: subscriptionCredits > 0 ? `${invoiceId}:topup` : invoiceId,
      referenceType: "STRIPE_TOPUP",
    });
  }
  if (subscriptionCredits > 0) {
    creditGrants.push({
      credits: subscriptionCredits,
      expiresAt: subscriptionCreditsExpiry,
      referenceId:
        oneTimeTopUpCredits > 0 ? `${invoiceId}:subscription` : invoiceId,
      referenceType: "STRIPE_SUBSCRIPTION_PERIOD",
    });
  }

  if (creditGrants.length === 0) {
    console.log(
      `Invoice ${invoiceId} has no grantable credits (billing reason: ${invoice.billing_reason})`,
    );
    return;
  }

  await prisma.$transaction(async (tx) => {
    const grantsToCreate: InvoiceCreditGrant[] = [];

    if (creditGrants.length > 1) {
      const legacyCombinedBucket = await tx.creditBucket.findUnique({
        where: {
          referenceId_referenceType: {
            referenceId: invoiceId,
            referenceType: "STRIPE_TOPUP",
          },
        },
      });

      if (legacyCombinedBucket) {
        console.log(
          `✅ Legacy combined bucket already exists for invoice ${invoiceId}, skipping split credit grants`,
        );
        return;
      }
    }

    for (const grant of creditGrants) {
      const existingBucket = await tx.creditBucket.findUnique({
        where: {
          referenceId_referenceType: {
            referenceId: grant.referenceId,
            referenceType: grant.referenceType,
          },
        },
      });

      if (existingBucket) {
        console.log(
          `✅ Bucket already exists for invoice reference ${grant.referenceId}, skipping creation`,
        );
        continue;
      }

      if (grant.referenceType === "STRIPE_SUBSCRIPTION_PERIOD") {
        const migratedLegacyBucket = await tx.creditBucket.findUnique({
          where: {
            referenceId_referenceType: {
              referenceId: grant.referenceId,
              referenceType: "STRIPE_TOPUP",
            },
          },
        });

        if (migratedLegacyBucket && migratedLegacyBucket.expiresAt !== null) {
          console.log(
            `✅ Legacy migrated subscription bucket already exists for invoice reference ${grant.referenceId}, skipping creation`,
          );
          continue;
        }
      }

      grantsToCreate.push(grant);
    }

    if (grantsToCreate.length === 0) {
      return;
    }

    for (const grant of grantsToCreate) {
      const cents = convertCreditsToCents(grant.credits);
      await tx.transaction.create({
        data: {
          amount: cents,
          user: { connect: { id: userId } },
          ...(organizationId && {
            organization: { connect: { id: organizationId } },
          }),
          sourceCreditBucket: {
            create: {
              amount: cents,
              expiresAt: grant.expiresAt,
              referenceId: grant.referenceId,
              referenceType: grant.referenceType,
              userId,
              organizationId,
            },
          },
        },
      });

      console.log(
        `✅ Processed invoice ${invoiceId}: Created transaction and bucket with ${convertCentsToCredits(cents)} credits for ${organizationId ? `organization ${organizationId}` : `user ${userId}`}${grant.expiresAt ? ` (expires ${grant.expiresAt.toISOString()})` : ""}`,
      );
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
