import { FiatTransactionStatus } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";

import { getEnvSecrets } from "@/config/env.config";
import {
  getFiatTransactionByServicePaymentId,
  updateFiatTransactionStatus,
} from "@/lib/db/services/fiatTransaction.service";

const stripe = new Stripe(getEnvSecrets().STRIPE_SECRET_KEY, {
  apiVersion: "2025-03-31.basil", // Corrected API version
});

const handleCheckoutSessionExpired = async (
  session: Stripe.Checkout.Session,
) => {
  console.log(`🔔  Payment expired for session ${session.id}`);

  const fiatTransaction = await getFiatTransactionByServicePaymentId(
    session.id,
  );
  if (!fiatTransaction) {
    console.error(`🔔  No fiat transaction found for session ${session.id}`);
    return;
  }
  console.log(`🔔  Updating fiat transaction ${fiatTransaction.id} to FAILED`);
  await updateFiatTransactionStatus(
    fiatTransaction.id,
    FiatTransactionStatus.FAILED,
  );
};

const handleCheckoutSessionCompleted = async (
  session: Stripe.Checkout.Session,
) => {
  console.log(`🔔  Payment received for session ${session.id}`);
  const fiatTransaction = await getFiatTransactionByServicePaymentId(
    session.id,
  );
  if (!fiatTransaction) {
    console.error(`🔔  No fiat transaction found for session ${session.id}`);
    return;
  }
  console.log(
    `🔔  Updating fiat transaction ${fiatTransaction.id} to SUCCEEDED`,
  );
  await updateFiatTransactionStatus(
    fiatTransaction.id,
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
  // Extract the object from the event.
  const data = event.data;
  const eventType = event.type;
  console.log(`⚠️  Webhook received: ${eventType}`);

  const session = data.object as Stripe.Checkout.Session;
  switch (eventType) {
    case "checkout.session.completed":
      await handleCheckoutSessionCompleted(session);
      break;
    case "checkout.session.expired":
      await handleCheckoutSessionExpired(session);
      break;
    default:
      break;
  }

  return NextResponse.json({ message: "Webhook received" }, { status: 200 });
}
