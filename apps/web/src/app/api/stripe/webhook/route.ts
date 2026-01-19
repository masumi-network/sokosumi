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
import { NextResponse } from "next/server";
import Stripe from "stripe";

import { getEnvSecrets } from "@/config/env.secrets";
import { stripeClient } from "@/lib/clients/stripe.client";
import prisma from "@/lib/db/prisma";

export async function POST(req: Request) {
  let event: Stripe.Event;

  try {
    const stripeSignature = req.headers.get("stripe-signature");

    event = await stripeClient.constructEvent(req, stripeSignature as string);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.log(`❌ Error message: ${message}`);
    return NextResponse.json(
      { message: `Webhook Error: ${message}` },
      { status: 400 },
    );
  }

  const permittedEvents: string[] = [
    "checkout.session.completed",
    "invoice.paid",
    "customer.updated",
  ];

  console.log(`🔍 Event id: ${event.id}`);

  if (permittedEvents.includes(event.type)) {
    try {
      switch (event.type) {
        case "checkout.session.completed": {
          const session = event.data.object as Stripe.Checkout.Session;
          return await handleCheckoutSessionCompletedEvent(session);
        }
        case "customer.updated": {
          const customer = event.data.object as Stripe.Customer;
          return await handleCustomerUpdatedEvent(customer);
        }
        case "invoice.paid": {
          const invoice = event.data.object as Stripe.Invoice;
          return await handleInvoicePaidEvent(invoice);
        }
        default:
          return NextResponse.json(
            { message: `Unhandled event: ${event.type}` },
            { status: 200 },
          );
      }
    } catch (error) {
      console.log(`🔍 Webhook handler failed for event: ${event.type}`);
      console.log(`🔍 Error: ${error}`);
      return NextResponse.json(
        { message: "Webhook handler failed" },
        { status: 500 },
      );
    }
  } else {
    return NextResponse.json(
      { message: `Unhandled event: ${event.type}` },
      { status: 200 },
    );
  }
}

const handleCheckoutSessionCompletedEvent = async (
  session: Stripe.Checkout.Session,
): Promise<NextResponse> => {
  try {
    // Validate payment status
    if (session.payment_status !== "paid") {
      return NextResponse.json(
        { message: `Payment status is not paid for session: ${session.id}` },
        { status: 200 },
      );
    }

    // Validate required fields
    if (!session.amount_total) {
      return NextResponse.json(
        { message: `Session amount total is null for session ${session.id}` },
        { status: 500 },
      );
    }

    if (!session.customer) {
      return NextResponse.json(
        { message: `Session has no customer for session ${session.id}` },
        { status: 500 },
      );
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
          return NextResponse.json(
            { message: "Organization owner not found" },
            { status: 200 },
          );
        }
        userId = ownerMember.userId;
      } else {
        console.log(
          `Stripe customer ${stripeCustomerId} not found in our system for session ${session.id}`,
        );
        return NextResponse.json(
          { message: "Customer not found in system" },
          { status: 200 },
        );
      }
    }

    const metadata = session.metadata;
    let credits: number = 0;
    if (metadata?.credits) {
      credits = parseInt(metadata.credits);
    }

    if (credits === 0) {
      return NextResponse.json(
        { message: "No credits found in session" },
        { status: 200 },
      );
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

    return NextResponse.json(
      {
        message: `Checkout session ${session.id} processed successfully`,
      },
      { status: 200 },
    );
  } catch (error) {
    console.error("Error handling checkout.session.completed event", error);
    return NextResponse.json(
      { message: "Failed to process checkout session" },
      { status: 500 },
    );
  }
};

const handleCustomerUpdatedEvent = async (
  customer: Stripe.Customer,
): Promise<NextResponse> => {
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
        return NextResponse.json(
          { message: `Organization not found` },
          { status: 200 },
        );
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

    return NextResponse.json(
      { message: "Customer update processed" },
      { status: 200 },
    );
  } catch (error) {
    console.error("Error handling customer.updated event", error);
    return NextResponse.json(
      { message: "Failed to process customer update" },
      { status: 500 },
    );
  }
};

const handleInvoicePaidEvent = async (
  invoice: Stripe.Invoice,
): Promise<NextResponse> => {
  try {
    // Validate invoice has required data
    if (!invoice.id) {
      console.log(`Invoice has no ID`);
      return NextResponse.json(
        { message: "Invoice has no ID" },
        { status: 200 },
      );
    }
    const invoiceId = invoice.id;

    if (!invoice.customer) {
      console.log(`Invoice ${invoiceId} has no customer`);
      return NextResponse.json(
        { message: "Invoice has no customer" },
        { status: 200 },
      );
    }

    if (invoice.amount_paid === null) {
      console.log(`Invoice ${invoiceId} has no amount paid`);
      return NextResponse.json(
        { message: "Invoice has no amount paid" },
        { status: 200 },
      );
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
          return NextResponse.json(
            { message: "Organization owner not found" },
            { status: 200 },
          );
        }
        userId = ownerMember.userId;
      } else {
        // Customer not found in our system
        console.log(
          `Stripe customer ${stripeCustomerId} not found in our system for invoice ${invoiceId}`,
        );
        return NextResponse.json(
          { message: "Customer not found in system" },
          { status: 200 },
        );
      }
    }

    const metadata = invoice.metadata;
    if (metadata?.origin === "checkout_session") {
      // If invoice was created from a checkout session, credits are already processed
      // by the checkout.session.completed event handler
      return NextResponse.json(
        { message: "Credits already processed by checkout session" },
        { status: 200 },
      );
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
      return NextResponse.json(
        { message: "Invoice already processed" },
        { status: 200 },
      );
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
          return NextResponse.json(
            { message: "Invoice contains unauthorized products" },
            { status: 200 },
          );
        }
      } else {
        return NextResponse.json(
          { message: "Invoice contains line items with no pricing" },
          { status: 200 },
        );
      }
    }

    // Calculate total credits from line items
    let totalCredits: number = 0;
    for (const lineItem of lines) {
      if (lineItem.pricing && typeof lineItem.pricing === "object") {
        totalCredits += lineItem.quantity ?? 1;
      } else {
        return NextResponse.json(
          { message: "Invoice contains line items with no pricing" },
          { status: 200 },
        );
      }
    }

    // If no credits, return 200
    if (totalCredits === 0) {
      console.log(`No line items found for invoice ${invoiceId}`);
      return NextResponse.json(
        { message: "No line items found" },
        { status: 200 },
      );
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

    return NextResponse.json(
      { message: `Invoice ${invoiceId} processed successfully` },
      { status: 200 },
    );
  } catch (error) {
    console.error("Error handling invoice.paid event", error);
    return NextResponse.json(
      { message: "Failed to process invoice payment" },
      { status: 500 },
    );
  }
};
