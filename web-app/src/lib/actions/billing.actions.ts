"use server";

import Stripe from "stripe";

import { getEnvSecrets } from "@/config/env.config"; // Ensure this path is correct

const stripe = new Stripe(getEnvSecrets().STRIPE_SECRET_KEY, {
  apiVersion: "2025-03-31.basil", // Corrected API version
});

/**
 * Fetches the cost per credit from Stripe.
 * Throws an error if the price cannot be retrieved or is invalid.
 */
export async function getCostPerCredit(): Promise<{
  amountPerCredit: number;
  currency: string;
}> {
  const priceId = getEnvSecrets().STRIPE_PRICE_ID;
  console.log(`ACTION: Fetching Stripe price for ID: ${priceId}`);

  try {
    const price = await stripe.prices.retrieve(priceId);
    console.log("ACTION: Stripe price retrieved:", price);

    if (price.unit_amount === null) {
      console.error("ACTION: Stripe price is missing unit_amount.");
      throw new Error("Stripe price does not have a unit_amount.");
    }
    const result = {
      amountPerCredit: price.unit_amount / 100,
      currency: price.currency,
    };
    console.log("ACTION: Calculated cost per credit:", result);
    return result;
  } catch (error) {
    console.error("ACTION: Failed to fetch Stripe price:", error);
    throw error;
  }
}
