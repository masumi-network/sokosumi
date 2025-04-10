import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";

import { getEnvSecrets } from "@/config/env.config";
import prisma from "@/lib/db/prisma";
import {
  getFiatTransactionByServicePaymentId,
  setFiatTransactionFailed,
  setFiatTransactionSucceeded,
} from "@/lib/db/services/fiatTransaction.service";
import { FiatTransactionStatus } from "@/prisma/generated/client";

const stripe = new Stripe(getEnvSecrets().STRIPE_SECRET_KEY);

const updateFiatTransactionStatus = async (
  session: Stripe.Checkout.Session,
  status: "SUCCEEDED" | "FAILED",
) => {
  await prisma.$transaction(async (tx) => {
    const fiatTransaction = await getFiatTransactionByServicePaymentId(
      session.id,
      tx,
    );
    if (!fiatTransaction) {
      return NextResponse.json(
        {
          message: `Fiat transaction is not pending for session ${session.id}`,
        },
        { status: 400 },
      );
    }

    if (session.client_reference_id !== fiatTransaction.id) {
      return NextResponse.json(
        {
          message: `Session client reference id ${session.client_reference_id} does not match fiat transaction id ${fiatTransaction.id}`,
        },
        { status: 400 },
      );
    }

    if (fiatTransaction.status !== FiatTransactionStatus.PENDING) {
      return NextResponse.json(
        { message: "Fiat transaction is not pending" },
        { status: 400 },
      );
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
  console.info(`🔔  Payment failed for session ${session.id}`);
  await updateFiatTransactionStatus(session, "FAILED");
};

const handleSessionSuccessEvents = async (session: Stripe.Checkout.Session) => {
  const paymentStatus = session.payment_status;
  if (paymentStatus !== "paid") {
    return NextResponse.json(
      { message: "Payment status is not paid" },
      { status: 200 },
    );
  }
  await updateFiatTransactionStatus(session, "SUCCEEDED");
};

export async function POST(request: NextRequest) {
  const secret = getEnvSecrets().STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    return NextResponse.json(
      { message: "No stripe-webhook-secret found" },
      { status: 400 },
    );
  }

  // Retrieve the event by verifying the signature using the raw body and secret.
  const signature = request.headers.get("stripe-signature");
  if (!signature) {
    return NextResponse.json(
      { message: "No stripe-signature header found" },
      { status: 400 },
    );
  }

  let event: Stripe.Event | undefined;

  try {
    event = stripe.webhooks.constructEvent(
      await request.text(),
      signature,
      getEnvSecrets().STRIPE_WEBHOOK_SECRET,
    );
  } catch {
    console.error(`⚠️  Webhook signature verification failed.`);
    return NextResponse.json(
      { message: "Webhook signature verification failed" },
      { status: 400 },
    );
  }

  const eventType = event.type;
  console.log(`⚠️  Webhook received: ${eventType}`);

  const session = event.data.object as Stripe.Checkout.Session;
  switch (eventType) {
    case "checkout.session.completed":
    case "checkout.session.async_payment_succeeded":
      await handleSessionSuccessEvents(session);
      break;
    case "checkout.session.expired":
    case "checkout.session.async_payment_failed":
      await handleSessionFailureEvents(session);
      break;
    default:
      break;
  }

  return NextResponse.json({ message: "Webhook received" }, { status: 200 });
}
