import { FiatTransactionStatus } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";

import { getEnvSecrets } from "@/config/env.config";
import { updateFiatTransactionStatus } from "@/lib/db/services/fiatTransaction.service";

const stripe = new Stripe(getEnvSecrets().STRIPE_SECRET_KEY, {
  apiVersion: "2025-03-31.basil", // Corrected API version
});

const handleFiatTransactionFailed = async (
  session: Stripe.Checkout.Session,
) => {
  console.log(`🔔  Payment failed for session ${session.id}`);

  await updateFiatTransactionStatus(session.id, FiatTransactionStatus.FAILED);
};

const checkSessionPayment = async (session: Stripe.Checkout.Session) => {
  console.log(`🔔  Check payment for session ${session.id}`);
  const paymentStatus = session.payment_status;
  if (paymentStatus !== "paid") {
    console.error(
      `🔔  Payment status is ${paymentStatus} for session ${session.id}`,
    );
    return;
  }

  await updateFiatTransactionStatus(
    session.id,
    FiatTransactionStatus.SUCCEEDED,
  );
};

export async function POST(request: NextRequest) {
  console.log("🔔  Stripe webhook received");

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
    console.log(`⚠️  Webhook signature verification failed.`);
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
      await checkSessionPayment(session);
      break;
    case "checkout.session.expired":
    case "checkout.session.async_payment_failed":
      await handleFiatTransactionFailed(session);
      break;
    default:
      break;
  }

  return NextResponse.json({ message: "Webhook received" }, { status: 200 });
}
