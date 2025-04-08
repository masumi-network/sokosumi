import { CreditTransactionStatus } from "@prisma/client";
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

  switch (eventType) {
    case "checkout.session.completed":
      console.log(`🔔  Payment received!`);

      // Explicitly cast data.object to the correct type
      const session = data.object as Stripe.Checkout.Session;

      // Access metadata safely
      const metadata = session.metadata;
      if (!metadata) {
        console.error(
          "⚠️ Metadata missing from checkout session completed event",
        );
        break; // Or handle appropriately
      }

      const creditTransactionId = metadata.creditTransactionId;
      const credits = metadata.credits;
      console.log("metadata", metadata);

      const creditTransaction =
        await getCreditTransactionById(creditTransactionId);

      const baseCredits = await convertCreditsToBaseUnits(Number(credits));

      if (!creditTransaction || creditTransaction.amount !== baseCredits) {
        console.error(
          "⚠️ Credit transaction not found or amount does not match",
        );
        break; // Or handle appropriately
      }

      await updateCreditTransactionStatus(
        creditTransactionId,
        CreditTransactionStatus.SUCCEEDED,
      );
      break;
    default:
      console.log(`⚠️  Unhandled event type: ${eventType}`);
      break;
  }

  return NextResponse.json({ message: "Webhook received" }, { status: 200 });
}
