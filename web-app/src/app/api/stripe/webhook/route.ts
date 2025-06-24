import { NextResponse } from "next/server";
import Stripe from "stripe";

import {
  getFiatTransactionByServicePaymentId,
  prisma,
  setFiatTransactionStatusToFailed,
  setFiatTransactionStatusToSucceeded,
} from "@/lib/db";
import { constructEvent } from "@/lib/services";
import { FiatTransactionStatus } from "@/prisma/generated/client";

export async function POST(req: Request) {
  let event: Stripe.Event;

  try {
    const stripeSignature = req.headers.get("stripe-signature");

    event = await constructEvent(req, stripeSignature as string);
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
    "customer.created",
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

const handleCustomerCreatedEvent = async (customer: Stripe.Customer) => {
  const email = customer.email;
  if (!email) {
    return NextResponse.json(
      { message: `Customer email not found for customer: ${customer.id}` },
      { status: 500 },
    );
  }
  const user = await prisma.user.update({
    where: { email },
    data: { stripeCustomerId: customer.id },
  });
  if (!user) {
    return NextResponse.json(
      { message: `User not found for email: ${email}` },
      { status: 500 },
    );
  }
  return NextResponse.json(
    {
      message: `User ${user.id} updated with stripe customer id: ${customer.id}`,
    },
    { status: 200 },
  );
};

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
      const fiatTransaction = await getFiatTransactionByServicePaymentId(
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
            await setFiatTransactionStatusToSucceeded(
              fiatTransaction,
              BigInt(amountTotal),
              currency,
              tx,
            );
            return NextResponse.json(
              {
                message: `Fiat transaction ${fiatTransaction.id} status changed to SUCCEEDED`,
              },
              { status: 200 },
            );
          case "FAILED":
            await setFiatTransactionStatusToFailed(
              fiatTransaction,
              BigInt(amountTotal),
              currency,
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
