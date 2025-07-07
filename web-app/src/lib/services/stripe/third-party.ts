import "server-only";

import { headers } from "next/headers";
import Stripe from "stripe";

import { getEnvSecrets } from "@/config/env.secrets";
import { updateUserStripeCustomerId } from "@/lib/db/repositories";
import { FiatTransaction, User } from "@/prisma/generated/client";

const stripe = new Stripe(getEnvSecrets().STRIPE_SECRET_KEY);

export interface Price {
  id: string;
  amountPerCredit: number;
  currency: string;
}

function validatePrice(price: Stripe.Price): Price {
  if (price.currency !== "usd") {
    throw new Error("Price is not in USD");
  }
  if (price.unit_amount === null) {
    throw new Error("Price unit_amount is null");
  }
  if (price.unit_amount === 0) {
    throw new Error(
      "Price unit_amount is 0 (free product) – cannot use for credit purchase",
    );
  }
  return {
    id: price.id,
    amountPerCredit: price.unit_amount!,
    currency: price.currency,
  };
}

export async function getPriceFromPriceId(priceId: string): Promise<Price> {
  try {
    const price = await stripe.prices.retrieve(priceId);
    return validatePrice(price);
  } catch (error) {
    console.error("Error retrieving price", error);
    throw error;
  }
}

/**
 * Retrieves the default price for a Stripe product.
 *
 * @param productId - The ID of the Stripe product to retrieve the price for
 * @returns A promise that resolves to the default Stripe.Price object for the product
 * @throws Will throw an error if the product does not have a default price configured
 *
 * @example
 * ```typescript
 * const productId = "prod_1234567890";
 * const price = await getPriceId(productId);
 * console.log(price.unit_amount); // Price in cents
 * console.log(price.currency); // Currency code (e.g., "usd")
 * ```
 */
export async function getPriceFromProductId(productId: string): Promise<Price> {
  try {
    const product = await stripe.products.retrieve(productId, {
      expand: ["default_price"],
    });
    if (
      typeof product.default_price !== "object" ||
      product.default_price === null
    ) {
      throw new Error("Product default price is not expanded");
    }
    return validatePrice(product.default_price);
  } catch (error) {
    console.error("Error retrieving price", error);
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
  fiatTransaction: FiatTransaction,
  price: Price,
  promotionCode: string | null = null,
): Promise<{
  id: string;
  url: string;
}> {
  const headerList = await headers();
  const origin = headerList.get("origin");
  // Prevent division by zero for price.unit_amount
  if (price.amountPerCredit === 0) {
    throw new Error(
      "Price amountPerCredit is 0 – cannot create checkout session for free product",
    );
  }
  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    line_items: [
      {
        price: price.id,
        quantity: Math.floor(
          Number(fiatTransaction.amount) / price.amountPerCredit,
        ),
      },
    ],
    ...(promotionCode
      ? { discounts: [{ promotion_code: promotionCode }] }
      : { allow_promotion_codes: false }),
    client_reference_id: fiatTransaction.id,
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
  await updateUserStripeCustomerId(user.id, customer.id);
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

export async function getCouponById(
  couponId: string,
): Promise<Stripe.Coupon | null> {
  try {
    return await stripe.coupons.retrieve(couponId);
  } catch {
    return null;
  }
}
