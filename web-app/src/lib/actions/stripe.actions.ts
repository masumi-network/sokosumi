"use server";

import Stripe from "stripe";

import { getEnvSecrets } from "@/config/env.config"; // Ensure this path is correct

const stripe = new Stripe(getEnvSecrets().STRIPE_SECRET_KEY, {
  apiVersion: "2025-03-31.basil", // Corrected API version
});

/**
 * Fetches the cost per credit from Stripe.
 *
 * @returns A promise that resolves to an object containing:
 *   - amountPerCredit: The cost per credit in the currency's base unit (e.g., dollars)
 *   - currency: The currency code (e.g., 'usd')
 * @throws Will throw an error if the Stripe price cannot be retrieved or is invalid
 */
export async function getCostPerCredit(
  priceId: string = getEnvSecrets().STRIPE_PRICE_ID,
): Promise<{
  amountPerCredit: number;
  currency: string;
}> {
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

/**
 * Creates a checkout session for purchasing credits.
 *
 * @returns A promise that resolves to an object containing:
 *   - id: The ID of the checkout session
 * @throws Will throw an error if the checkout session cannot be created
 */
export async function createCheckoutSession(
  priceId: string,
  credits: number,
  successURL: string,
  cancelURL: string,
): Promise<{
  id: string;
  url: string | null;
}> {
  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    line_items: [
      {
        price: priceId,
        quantity: credits,
      },
    ],
    success_url: successURL,
    cancel_url: cancelURL,
    // success_url: `${domainURL}/success.html?session_id={CHECKOUT_SESSION_ID}`,
    // cancel_url: `${domainURL}/canceled.html`,
  });
  return { id: session.id, url: session.url };
}
