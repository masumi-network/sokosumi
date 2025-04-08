import Stripe from "stripe";

import BillingForm from "@/components/billing/billing-form";
import { getEnvSecrets } from "@/config/env.config";

const stripe = new Stripe(getEnvSecrets().STRIPE_SECRET_KEY, {
  apiVersion: "2025-03-31.basil",
});

async function getCostPerCreditUSD(): Promise<number> {
  const priceId = getEnvSecrets().STRIPE_PRICE_ID;
  try {
    const price = await stripe.prices.retrieve(priceId);
    if (price.currency !== "usd") {
      throw new Error("Stripe price is not in USD.");
    }
    if (price.unit_amount === null) {
      throw new Error("Stripe price does not have a unit_amount.");
    }
    return price.unit_amount / 100;
  } catch (error) {
    console.error("Failed to fetch Stripe price:", error);
    throw error;
  }
}

export default async function BillingPage() {
  const costPerCreditUSD = await getCostPerCreditUSD();

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6">
      <BillingForm costPerCreditUSD={costPerCreditUSD} />
    </div>
  );
}
