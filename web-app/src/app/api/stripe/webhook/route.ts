import { CreditTransaction, CreditTransactionStatus } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";

import { getEnvSecrets } from "@/config/env.config";
import {
  convertCreditsToBaseUnits,
  getCreditTransactionById,
  updateCreditTransactionStatus,
} from "@/lib/db/services/credit.service";

const stripe = new Stripe(getEnvSecrets().STRIPE_SECRET_KEY, {
  apiVersion: "2025-03-31.basil", // Corrected API version
});

const getCreditTransactionForSession = async (
  session: Stripe.Checkout.Session,
): Promise<CreditTransaction | null> => {
  const metadata = session.metadata;
  if (!metadata) {
    console.error("⚠️ Metadata missing from checkout session event");
    return null; // Or handle appropriately
  }

  const creditTransactionId = metadata.creditTransactionId;
  return await getCreditTransactionById(creditTransactionId);
};

const handleCheckoutSessionExpired = async (
  session: Stripe.Checkout.Session,
) => {
  console.log(`🔔  Payment expired!`);

  const creditTransaction = await getCreditTransactionForSession(session);
  if (!creditTransaction) {
    console.error("⚠️ Credit transaction not found");
    return; // Or handle appropriately
  }

  await updateCreditTransactionStatus(
    creditTransaction.id,
    CreditTransactionStatus.FAILED,
  );
};

const handleCheckoutSessionCompleted = async (
  session: Stripe.Checkout.Session,
) => {
  console.log(`🔔  Payment received!`);

  const creditTransaction = await getCreditTransactionForSession(session);

  const credits = session.metadata?.credits;
  if (!credits) {
    console.error("⚠️ Credits missing from checkout session completed event");
    return; // Or handle appropriately
  }
  const baseCredits = await convertCreditsToBaseUnits(Number(credits));

  if (!creditTransaction || creditTransaction.amount !== baseCredits) {
    console.error("⚠️ Credit transaction not found or amount does not match");
    return; // Or handle appropriately
  }

  await updateCreditTransactionStatus(
    creditTransaction.id,
    CreditTransactionStatus.SUCCEEDED,
  );
};

export async function POST(request: NextRequest) {
  console.log(request);

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
  console.log(`⚠️  Webhook data: ${JSON.stringify(data)}`);

  const session = data.object as Stripe.Checkout.Session;
  switch (eventType) {
    case "checkout.session.completed":
      await handleCheckoutSessionCompleted(session);
      break;
    case "checkout.session.expired":
      await handleCheckoutSessionExpired(session);
      break;
    default:
      console.error(`⚠️  Unhandled event type: ${eventType}`);
      break;
  }

  return NextResponse.json({ message: "Webhook received" }, { status: 200 });
}
