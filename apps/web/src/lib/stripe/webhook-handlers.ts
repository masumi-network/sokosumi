import "server-only";

import { MemberRole } from "@sokosumi/database";
import {
  convertCentsToCredits,
  convertCreditsToCents,
} from "@sokosumi/database/helpers";
import {
  creditTransactionRepository,
  memberRepository,
  organizationRepository,
  userRepository,
} from "@sokosumi/database/repositories";
import Stripe from "stripe";

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

  // Check if we already processed this invoice by looking for existing credit transaction
  const existingTransaction = await prisma.creditTransaction.findFirst({
    where: {
      referenceId: invoiceId,
      referenceType: "STRIPE_INVOICE",
    },
  });

  if (existingTransaction) {
    console.log(`Invoice ${invoiceId} already processed`);
    return;
  }

  const metadata = invoice.metadata;
  let totalCredits: number = 0;
  if (metadata?.credits) {
    totalCredits = parseInt(metadata.credits);
  }

  if (totalCredits === 0) {
    console.log("Invoice contains no credits");
    return;
  }

  const cents = convertCreditsToCents(totalCredits);

  // Create credit transaction directly
  await prisma.$transaction(async (tx) => {
    await creditTransactionRepository.createCreditTransactionFromPayment(
      userId,
      organizationId,
      cents,
      invoiceId,
      "STRIPE_INVOICE",
      tx,
    );
  });

  console.log(
    `✅ Processed invoice ${invoiceId}: Created credit transaction with ${convertCentsToCredits(cents)} credits for ${organizationId ? `organization ${organizationId}` : `user ${userId}`}`,
  );
}

export async function handleCustomerUpdatedEvent(
  customer: Stripe.Customer,
): Promise<void> {
  // Check if this is an organization customer
  const metadata = customer.metadata;
  if (metadata?.type === "organization" && metadata?.organizationId) {
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
