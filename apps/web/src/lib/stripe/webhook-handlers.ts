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

  // Get the allowed product ID and its default price
  const allowedProductId = getEnvSecrets().STRIPE_CREDIT_PRODUCT_ID;

  // Ensure invoice has line items
  const lineItems = invoice.lines?.data;
  if (!lineItems || lineItems.length === 0) {
    throw new Error(`No line items found for invoice ${invoiceId}`);
  }

  let totalCredits: number = 0;
  for (const lineItem of lineItems) {
    if (lineItem.pricing && typeof lineItem.pricing === "object") {
      const productId = lineItem.pricing.price_details?.product;

      if (productId !== allowedProductId) {
        throw new Error(
          `Invoice ${invoiceId} contains unauthorized product ${productId}. Only ${allowedProductId} is allowed.`,
        );
      }

      totalCredits += lineItem.quantity ?? 0;
    }
  }

  if (totalCredits <= 0) {
    throw new Error(
      `Invalid total credits ${totalCredits} for invoice ${invoiceId}`,
    );
  }

  const cents = convertCreditsToCents(totalCredits);
  const referenceId = invoiceId;
  const referenceType: CreditBucketReferenceType = "STRIPE_INVOICE";

  // Check if bucket already exists (idempotent check)
  await prisma.$transaction(async (tx) => {
    const existingBucket = await tx.creditBucket.findUnique({
      where: {
        referenceId_referenceType: {
          referenceId,
          referenceType,
        },
      },
      include: {
        sourceTransaction: true,
      },
    });

    if (existingBucket) {
      console.log(
        `✅ Bucket already exists for invoice ${invoiceId}, skipping creation`,
      );
    } else {
      // Create new transaction and bucket
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
              expiresAt: null,
              referenceId,
              referenceType,
              userId,
              organizationId,
            },
          },
        },
      });
      console.log(
        `✅ Processed invoice ${invoiceId}: Created transaction and bucket with ${convertCentsToCredits(cents)} credits for ${organizationId ? `organization ${organizationId}` : `user ${userId}`}`,
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
