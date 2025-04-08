import Stripe from "stripe";

import BillingForm from "@/components/billing/billing-form";
import { getEnvSecrets } from "@/config/env.config";

const stripe = new Stripe(getEnvSecrets().STRIPE_SECRET_KEY, {
  apiVersion: "2025-03-31.basil",
});

async function getCostPerCredit(): Promise<{
  amountPerCredit: number;
  currency: string;
}> {
  const priceId = getEnvSecrets().STRIPE_PRICE_ID;
  try {
    const price = await stripe.prices.retrieve(priceId);
    if (price.unit_amount === null) {
      throw new Error("Stripe price does not have a unit_amount.");
    }
    return {
      amountPerCredit: price.unit_amount / 100,
      currency: price.currency,
    };
  } catch (error) {
    console.error("Failed to fetch Stripe price:", error);
    throw error;
  }
}

export default async function BillingPage() {
  const costPerCredit = await getCostPerCredit();

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6">
      <BillingForm
        amountPerCredit={costPerCredit.amountPerCredit}
        currency={costPerCredit.currency}
      />
    </div>
  );
}
