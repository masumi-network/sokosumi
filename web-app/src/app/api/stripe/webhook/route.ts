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
  status: FiatTransactionStatus,
) => {
  await prisma.$transaction(async (tx) => {
    const fiatTransaction = await getFiatTransactionByServicePaymentId(
      session.id,
      tx,
    );
    if (!fiatTransaction) {
      console.error(
        `🔔  Fiat transaction is not pending for session ${session.id}`,
      );
      return;
    }

    if (fiatTransaction.status !== FiatTransactionStatus.PENDING) {
      console.error(
        `🔔  Fiat transaction is not pending for session ${session.id}`,
      );
      return;
    }
    switch (status) {
      case FiatTransactionStatus.SUCCEEDED:
        await setFiatTransactionSucceeded(fiatTransaction, tx);
        break;
      case FiatTransactionStatus.FAILED:
        await setFiatTransactionFailed(fiatTransaction, tx);
        break;
      default:
        throw new Error(`Invalid status: ${status}`);
    }
  });
};

const handleSessionFailureEvents = async (session: Stripe.Checkout.Session) => {
  console.info(`🔔  Payment failed for session ${session.id}`);
  await updateFiatTransactionStatus(session, FiatTransactionStatus.FAILED);
};

const handleSessionSuccessEvents = async (session: Stripe.Checkout.Session) => {
  const paymentStatus = session.payment_status;
  if (paymentStatus !== "paid") {
    console.error(
      `🔔  Payment status is ${paymentStatus} for session ${session.id}`,
    );
    return;
  }
  await updateFiatTransactionStatus(session, FiatTransactionStatus.SUCCEEDED);
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
