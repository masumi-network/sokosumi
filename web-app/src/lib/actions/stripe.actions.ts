"use server";

import { headers } from "next/headers";
import Stripe from "stripe";

import { getEnvSecrets } from "@/config/env.config"; // Ensure this path is correct
import { User } from "@/prisma/generated/client";

const stripe = new Stripe(getEnvSecrets().STRIPE_SECRET_KEY);

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
  try {
    const price = await stripe.prices.retrieve(priceId);

    if (price.unit_amount === null) {
      console.error("ACTION: Stripe price is missing unit_amount.");
      throw new Error("Stripe price does not have a unit_amount.");
    }
    const result = {
      amountPerCredit: price.unit_amount / 100,
      currency: price.currency,
    };
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
  user: User,
  fiatTransactionId: string,
  priceId: string,
  credits: number,
): Promise<{
  id: string;
  url: string;
}> {
  const headerList = await headers();
  const origin = headerList.get("origin");

  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    line_items: [
      {
        price: priceId,
        quantity: credits,
      },
    ],
    client_reference_id: fiatTransactionId,
    ...(user.stripeCustomerId
      ? { customer: user.stripeCustomerId }
      : { customer_email: user.email, customer_creation: "always" }),
    billing_address_collection: "required",
    success_url: `${origin}/app/billing/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${origin}/app/billing/cancel`,
  });
  if (!session.url) {
    throw new Error("Stripe session URL is null");
  }
  return { id: session.id, url: session.url };
}
