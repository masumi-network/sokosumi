import { headers } from "next/headers";
import { NextResponse } from "next/server";
import Stripe from "stripe";

import { getEnvSecrets } from "@/config/env.config";
import prisma from "@/lib/db/prisma";
import {
  getFiatTransactionByServicePaymentId,
  setFiatTransactionFailed,
  setFiatTransactionSucceeded,
} from "@/lib/db/services/fiatTransaction.service";
import {
  FiatTransaction,
  FiatTransactionStatus,
} from "@/prisma/generated/client";

const stripe = new Stripe(getEnvSecrets().STRIPE_SECRET_KEY);

export async function POST(req: Request) {
  let event: Stripe.Event;

  try {
    const stripeSignature = (await headers()).get("stripe-signature");

    event = stripe.webhooks.constructEvent(
      await req.text(),
      stripeSignature as string,
      getEnvSecrets().STRIPE_WEBHOOK_SECRET,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.log(`❌ Error message: ${message}`);
    return NextResponse.json(
      { message: `Webhook Error: ${message}` },
      { status: 400 },
    );
  }
  console.log(`Stripe event id: ${event.id}`);

  const permittedEvents: string[] = [
    "checkout.session.completed",
    "checkout.session.expired",
    "checkout.session.async_payment_succeeded",
    "checkout.session.async_payment_failed",
  ];

  if (permittedEvents.includes(event.type)) {
    const session = event.data.object as Stripe.Checkout.Session;
    try {
      switch (event.type) {
        case "checkout.session.completed":
        case "checkout.session.async_payment_succeeded":
          console.info(
            `💰 CheckoutSession payment status: ${session.payment_status}`,
          );
          handleSessionSuccessEvents(session)
            .then((fiatTransaction) => {
              console.info(
                `💰 Fiat transaction status: ${fiatTransaction.status}`,
              );
            })
            .catch((error) => {
              console.error(error);
            });
          break;
        case "checkout.session.expired":
        case "checkout.session.async_payment_failed":
          console.info(`❌ CheckoutSession Payment failed: ${session.id}`);
          handleSessionFailureEvents(session)
            .then((fiatTransaction) => {
              console.info(
                `💰 Fiat transaction status: ${fiatTransaction.status}`,
              );
            })
            .catch((error) => {
              console.error(error);
            });
          break;
        default:
          throw new Error(`Unhandled event: ${event.type}`);
      }
    } catch (error) {
      console.error(error);
      return NextResponse.json(
        { message: "Webhook handler failed" },
        { status: 500 },
      );
    }
  }

  // Return a response to acknowledge receipt of the event.
  return NextResponse.json({ message: "Received" }, { status: 200 });
}

const updateFiatTransactionStatus = async (
  session: Stripe.Checkout.Session,
  status: "SUCCEEDED" | "FAILED",
): Promise<FiatTransaction> => {
  return await prisma.$transaction(async (tx) => {
    const fiatTransaction = await getFiatTransactionByServicePaymentId(
      session.id,
      tx,
    );
    if (!fiatTransaction) {
      throw new Error(`Fiat transaction for session ${session.id} not found`);
    }

    if (session.client_reference_id !== fiatTransaction.id) {
      throw new Error(
        `Session client reference id ${session.client_reference_id} does not match fiat transaction id ${fiatTransaction.id}`,
      );
    }

    if (fiatTransaction.status !== FiatTransactionStatus.PENDING) {
      throw new Error("Fiat transaction is not pending");
    }

    switch (status) {
      case "SUCCEEDED":
        return await setFiatTransactionSucceeded(fiatTransaction, tx);
      case "FAILED":
        return await setFiatTransactionFailed(fiatTransaction, tx);
    }
  });
};

const handleSessionFailureEvents = async (session: Stripe.Checkout.Session) => {
  return await updateFiatTransactionStatus(session, "FAILED");
};

const handleSessionSuccessEvents = async (session: Stripe.Checkout.Session) => {
  const paymentStatus = session.payment_status;
  if (paymentStatus !== "paid") {
    throw new Error("Payment status is not paid");
  }
  return await updateFiatTransactionStatus(session, "SUCCEEDED");
};
