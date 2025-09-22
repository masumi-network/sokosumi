import { NextResponse } from "next/server";
import Stripe from "stripe";

import { getEnvSecrets } from "@/config/env.secrets";
import { stripeClient } from "@/lib/clients/stripe.client";
import {
  convertCentsToCredits,
  convertCreditsToCents,
  MemberRole,
} from "@/lib/db";
import {
  fiatTransactionRepository,
  memberRepository,
  organizationRepository,
  prisma,
  userRepository,
} from "@/lib/db/repositories";
import { FiatTransactionStatus } from "@/prisma/generated/client";

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
    "checkout.session.expired",
    "checkout.session.async_payment_succeeded",
    "checkout.session.async_payment_failed",
    "invoice.paid",
    "customer.created",
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
        case "checkout.session.async_payment_succeeded": {
          const session = event.data.object as Stripe.Checkout.Session;
          return await handleCheckoutSessionAsyncPaymentSucceededEvent(session);
        }
        case "checkout.session.expired": {
          const session = event.data.object as Stripe.Checkout.Session;
          return await handleCheckoutSessionExpiredEvent(session);
        }
        case "checkout.session.async_payment_failed": {
          const session = event.data.object as Stripe.Checkout.Session;
          return await handleCheckoutSessionAsyncPaymentFailedEvent(session);
        }
        case "customer.created": {
          const customer = event.data.object as Stripe.Customer;
          return await handleCustomerCreatedEvent(customer);
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

const checkPaymentStatus = (session: Stripe.Checkout.Session) => {
  const paymentStatus = session.payment_status;
  if (paymentStatus !== "paid") {
    return NextResponse.json(
      { message: `Payment status is not paid for session: ${session.id}` },
      { status: 200 },
    );
  }
};

const handleCheckoutSessionCompletedEvent = async (
  session: Stripe.Checkout.Session,
) => {
  checkPaymentStatus(session);
  return await updateFiatTransactionStatus(session, "SUCCEEDED");
};

const handleCheckoutSessionExpiredEvent = async (
  session: Stripe.Checkout.Session,
) => {
  return await updateFiatTransactionStatus(session, "FAILED");
};

const handleCheckoutSessionAsyncPaymentSucceededEvent = async (
  session: Stripe.Checkout.Session,
) => {
  checkPaymentStatus(session);
  return await updateFiatTransactionStatus(session, "SUCCEEDED");
};

const handleCheckoutSessionAsyncPaymentFailedEvent = async (
  session: Stripe.Checkout.Session,
) => {
  return await updateFiatTransactionStatus(session, "FAILED");
};

const updateFiatTransactionStatus = async (
  session: Stripe.Checkout.Session,
  status: "SUCCEEDED" | "FAILED",
): Promise<NextResponse> => {
  const amountTotal = session.amount_total;
  if (amountTotal === null) {
    return NextResponse.json(
      { message: `Session amount total is null for session ${session.id}` },
      { status: 500 },
    );
  }
  const currency = session.currency;
  if (currency === null) {
    return NextResponse.json(
      { message: `Session currency is null for session ${session.id}` },
      { status: 500 },
    );
  }
  return await prisma.$transaction(async (tx) => {
    try {
      const fiatTransaction =
        await fiatTransactionRepository.getFiatTransactionByServicePaymentId(
          session.id,
          tx,
        );
      if (!fiatTransaction) {
        return NextResponse.json(
          { message: `Fiat transaction for session ${session.id} not found` },
          { status: status === "FAILED" ? 200 : 500 },
        );
      }

      if (session.client_reference_id !== fiatTransaction.id) {
        return NextResponse.json(
          {
            message: `Session client reference id ${session.client_reference_id} does not match fiat transaction id ${fiatTransaction.id}`,
          },
          { status: status === "FAILED" ? 200 : 500 },
        );
      }

      if (fiatTransaction.status !== FiatTransactionStatus.PENDING) {
        return NextResponse.json(
          { message: "Fiat transaction is not pending" },
          { status: 200 },
        );
      }

      try {
        switch (status) {
          case "SUCCEEDED":
            await fiatTransactionRepository.updateFiatTransactionStatus(
              fiatTransaction,
              BigInt(amountTotal),
              currency,
              FiatTransactionStatus.SUCCEEDED,
              tx,
            );
            return NextResponse.json(
              {
                message: `Fiat transaction ${fiatTransaction.id} status changed to SUCCEEDED`,
              },
              { status: 200 },
            );
          case "FAILED":
            await fiatTransactionRepository.updateFiatTransactionStatus(
              fiatTransaction,
              BigInt(amountTotal),
              currency,
              FiatTransactionStatus.FAILED,
              tx,
            );
            return NextResponse.json(
              {
                message: `Fiat transaction ${fiatTransaction.id} status changed to FAILED`,
              },
              { status: 200 },
            );
        }
      } catch {
        return NextResponse.json(
          { message: "Failed to update fiat transaction status" },
          { status: 500 },
        );
      }
    } catch (error) {
      console.log("Error updating fiat transaction status", error);
      throw error;
    }
  });
};

const handleCustomerCreatedEvent = async (
  customer: Stripe.Customer,
): Promise<NextResponse> => {
  try {
    return await prisma.$transaction(async (tx) => {
      const metadata = customer.metadata;
      switch (metadata?.type) {
        case "user": {
          const userId = metadata.userId;
          const user = await userRepository.getUserById(userId, tx);
          if (!user) {
            return NextResponse.json(
              { message: "User not found" },
              { status: 200 },
            );
          }
          if (user.email !== customer.email) {
            await stripeClient.updateCustomerEmail(customer.id, user.email);
          }
          if (user.stripeCustomerId === customer.id) {
            return NextResponse.json(
              { message: "User already has this stripe customer id" },
              { status: 200 },
            );
          }
          if (user.stripeCustomerId) {
            await stripeClient.deleteCustomer(customer.id);
            return NextResponse.json(
              { message: "User already has a stripe customer id" },
              { status: 200 },
            );
          }
          await userRepository.setUserStripeCustomerId(userId, customer.id, tx);
          return NextResponse.json(
            {
              message: `✅ Updated user ${userId} stripe customer id to ${customer.id}`,
            },
            { status: 200 },
          );
        }
        case "organization": {
          const organizationId = metadata.organizationId;
          const organization =
            await organizationRepository.getOrganizationWithRelationsById(
              organizationId,
              tx,
            );
          if (!organization) {
            return NextResponse.json(
              { message: "Organization not found" },
              { status: 200 },
            );
          }
          if (organization.stripeCustomerId === customer.id) {
            return NextResponse.json(
              { message: "Organization already has this stripe customer id" },
              { status: 200 },
            );
          }
          if (organization.stripeCustomerId) {
            await stripeClient.deleteCustomer(customer.id);
            return NextResponse.json(
              { message: "Organization already has a stripe customer id" },
              { status: 200 },
            );
          }
          await organizationRepository.setOrganizationStripeCustomerId(
            organizationId,
            customer.id,
            tx,
          );
          return NextResponse.json(
            {
              message: `✅ Updated organization ${organizationId} stripe customer id to ${customer.id}`,
            },
            { status: 200 },
          );
        }
        default: {
          return NextResponse.json(
            {
              message: `Unknown customer type ${metadata?.type} for customer ${customer.id}`,
            },
            { status: 200 },
          );
        }
      }
    });
  } catch (error) {
    console.error("Error handling customer.created event", error);
    return NextResponse.json(
      { message: "Failed to process customer creation" },
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
    const user =
      await userRepository.getUserByStripeCustomerId(stripeCustomerId);

    if (user) {
      // This is a user purchase
      userId = user.id;
    } else {
      // Try to find an organization with this stripeCustomerId
      const organization =
        await organizationRepository.getOrganizationByStripeCustomerId(
          stripeCustomerId,
        );

      if (organization) {
        // This is an organization purchase
        organizationId = organization.id;

        // Get organization members to find the owner to attribute the transaction
        const members =
          await memberRepository.getMembersByOrganizationId(organizationId);
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

    // Check if we already processed this invoice
    const existingTransaction =
      await fiatTransactionRepository.getFiatTransactionByServicePaymentId(
        invoiceId,
      );

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

    // Create the fiat transaction and credit transaction in a database transaction
    const transaction =
      await fiatTransactionRepository.createFiatTransactionFromInvoice(
        userId,
        organizationId,
        cents,
        invoiceId,
        invoice.amount_paid,
        invoice.currency,
      );

    console.log(
      `✅ Processed invoice ${invoiceId}: Created fiatTransaction ${transaction.id} with ${convertCentsToCredits(cents)} credits for ${organizationId ? `organization ${organizationId}` : `user ${userId}`}`,
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
