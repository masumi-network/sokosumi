"use server";

import { headers } from "next/headers";
import Stripe from "stripe";

import { getEnvSecrets } from "@/config/env.config"; // Ensure this path is correct
import { setStripeCustomerId } from "@/lib/db";
import { User } from "@/prisma/generated/client";

const stripe = new Stripe(getEnvSecrets().STRIPE_SECRET_KEY);

/**
 * Retrieves the cost per credit for a given Stripe price.
 *
 * @param priceId - The Stripe price ID to fetch (defaults to STRIPE_PRICE_ID from environment).
 * @returns An object containing:
 *   - centsPerUnitAmount: The price per credit in cents, adjusted for the app's credit base.
 *   - unitAmountPerCredit: The Stripe unit amount per credit (in the currency's smallest unit).
 *   - currency: The currency code (e.g., 'usd').
 * @throws If the Stripe price cannot be retrieved, is missing unit_amount, or is not in USD.
 */
export async function getConversionFactors(
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

    if (price.currency !== "usd") {
      throw new Error("Stripe price currency is not USD.");
    }
    const result = {
      amountPerCredit: price.unit_amount,
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
  quantity: number,
  promotionCode: string | null,
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
        quantity: quantity,
      },
    ],
    ...(promotionCode
      ? { discounts: [{ promotion_code: promotionCode }] }
      : { allow_promotion_codes: false }),
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

export async function constructEvent(req: Request, stripeSignature: string) {
  return stripe.webhooks.constructEvent(
    await req.text(),
    stripeSignature,
    getEnvSecrets().STRIPE_WEBHOOK_SECRET,
  );
}

export async function createCustomer(user: User): Promise<string> {
  const customer = await stripe.customers.create({ email: user.email });
  await setStripeCustomerId(user.id, customer.id);
  return customer.id;
}

export async function getOrCreatePromotionCode(
  customerId: string,
  couponId: string,
  maxRedemptions: number = 1,
  metadata?: Record<string, string>,
): Promise<Stripe.PromotionCode | null> {
  try {
    const promotionCodes = await stripe.promotionCodes.list({
      coupon: couponId,
      customer: customerId,
      limit: 1,
    });
    if (promotionCodes.data.length > 0) {
      return promotionCodes.data[0];
    }
    const promotionCode = await stripe.promotionCodes.create({
      customer: customerId,
      coupon: couponId,
      max_redemptions: maxRedemptions,
      metadata,
    });
    return promotionCode;
  } catch {
    return null;
  }
}
