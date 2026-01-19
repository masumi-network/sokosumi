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

import { getEnvSecrets } from "@/config/env.secrets";
import { stripeClient } from "@/lib/clients/stripe.client";
import prisma from "@/lib/db/prisma";

export async function handleCheckoutSessionCompletedEvent(
  session: Stripe.Checkout.Session,
): Promise<void> {
  try {
    // Validate payment status
    if (session.payment_status !== "paid") {
      console.log(`Payment status is not paid for session: ${session.id}`);
      return;
    }

    // Validate required fields
    if (!session.amount_total) {
      console.error(`Session amount total is null for session ${session.id}`);
      return;
    }

    if (!session.customer) {
      console.error(`Session has no customer for session ${session.id}`);
      return;
    }

    const stripeCustomerId =
      typeof session.customer === "string"
        ? session.customer
        : session.customer.id;

    // Look up the user or organization by stripeCustomerId
    let userId: string;
    let organizationId: string | null = null;

    const user = await userRepository.getUserByStripeCustomerId(
      stripeCustomerId,
      prisma,
    );

    if (user) {
      userId = user.id;
    } else {
      const organization =
        await organizationRepository.getOrganizationByStripeCustomerId(
          stripeCustomerId,
          prisma,
        );

      if (organization) {
        organizationId = organization.id;
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
        console.log(
          `Stripe customer ${stripeCustomerId} not found in our system for session ${session.id}`,
        );
        return;
      }
    }

    const metadata = session.metadata;
    let credits: number = 0;
    if (metadata?.credits) {
      credits = parseInt(metadata.credits);
    }

    if (credits === 0) {
      console.log("No credits found in session");
      return;
    }

    const cents = convertCreditsToCents(credits);

    // Create credit transaction directly
    await prisma.$transaction(async (tx) => {
      await creditTransactionRepository.createCreditTransactionFromPayment(
        userId,
        organizationId,
        cents,
        session.id,
        "STRIPE_SESSION",
        tx,
      );
    });

    console.log(
      `✅ Processed checkout session ${session.id}: Created credit transaction with ${convertCentsToCredits(cents)} credits for ${organizationId ? `organization ${organizationId}` : `user ${userId}`}`,
    );
  } catch (error) {
    console.error("Error handling checkout.session.completed event", error);
  }
}

export async function handleInvoicePaidEvent(
  invoice: Stripe.Invoice,
): Promise<void> {
  try {
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
    const metadata = invoice.metadata;
    if (metadata?.origin === "checkout_session") {
      // If invoice was created from a checkout session, credits are already processed
      // by the checkout.session.completed event handler
      console.log("Credits already processed by checkout session");
      return;
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

    // Get the allowed product ID and its default price
    const allowedProductId = getEnvSecrets().STRIPE_PRODUCT_ID;

    // Ensure we have line items - fetch full invoice if needed
    let lines = invoice.lines?.data || [];
    if (lines.length === 0) {
      console.log(`Fetching full invoice ${invoiceId} to get line items`);
      const expandedInvoice = await stripeClient.getInvoice(invoiceId);
      lines = expandedInvoice.lines?.data || [];
    }

    // Validate all line items are for the allowed product
    for (const lineItem of lines) {
      if (lineItem.pricing && typeof lineItem.pricing === "object") {
        // Get the product ID from the price
        const productId = lineItem.pricing.price_details?.product;

        if (productId !== allowedProductId) {
          console.log(
            `Invoice ${invoiceId} contains unauthorized product ${productId}. Only ${allowedProductId} is allowed.`,
          );
          return;
        }
      } else {
        console.log("Invoice contains line items with no pricing");
        return;
      }
    }

    // Calculate total credits from line items
    let totalCredits: number = 0;
    for (const lineItem of lines) {
      if (lineItem.pricing && typeof lineItem.pricing === "object") {
        totalCredits += lineItem.quantity ?? 1;
      } else {
        console.log("Invoice contains line items with no pricing");
        return;
      }
    }

    // If no credits, return
    if (totalCredits === 0) {
      console.log(`No line items found for invoice ${invoiceId}`);
      return;
    }

    const cents = convertCreditsToCents(totalCredits);

    console.log(
      `Invoice ${invoiceId}: Calculated ${cents} cents from ${lines.length} line items`,
    );

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
  } catch (error) {
    console.error("Error handling invoice.paid event", error);
  }
}

export async function handleCustomerUpdatedEvent(
  customer: Stripe.Customer,
): Promise<void> {
  try {
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
  } catch (error) {
    console.error("Error handling customer.updated event", error);
  }
}
