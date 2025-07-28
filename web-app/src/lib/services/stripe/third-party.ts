import "server-only";

import { headers } from "next/headers";
import Stripe from "stripe";

import { getEnvSecrets } from "@/config/env.secrets";
import prisma from "@/lib/db/repositories/prisma";
import { UserService } from "@/lib/services/user.service";
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

/**
 * Atomically gets or creates a Stripe customer for a user.
 * Handles race conditions by using database transactions and unique constraints.
 * Also checks Stripe for existing customers to maintain idempotency.
 *
 * @param userId - The user ID to get or create a Stripe customer for
 * @returns The Stripe customer ID, or null if the operation fails
 */
export async function getOrCreateStripeCustomer(
  userId: string,
): Promise<string | null> {
  return await prisma.$transaction(async (tx) => {
    try {
      const userService = new UserService(tx);
      let user = await userService.getUserById(userId);

      if (!user) {
        return null;
      }

      // If user already has a Stripe customer ID, return it
      if (user.stripeCustomerId) {
        return user.stripeCustomerId;
      }

      // Check if a customer already exists in Stripe for this email
      // This handles cases where a customer was created outside our system
      const existingCustomers = await stripe.customers.list({
        email: user.email,
        limit: 1,
      });

      if (existingCustomers.data.length > 0) {
        const existingCustomer = existingCustomers.data[0];
        try {
          // Attempt to associate the existing customer with the user
          user = await userService.setUserStripeCustomerId(
            user.id,
            existingCustomer.id,
          );
          return user.stripeCustomerId;
        } catch (_error) {
          // If there's a unique constraint violation, another process may have
          // already associated this customer. Fetch the updated user record.
          const updatedUser = await userService.getUserById(userId);
          return updatedUser?.stripeCustomerId ?? null;
        }
      }

      // Create a new Stripe customer
      const customer = await stripe.customers.create({
        email: user.email,
        metadata: {
          userId: user.id,
        },
      });

      try {
        // Attempt to save the customer ID to the database
        user = await userService.setUserStripeCustomerId(user.id, customer.id);
        return user.stripeCustomerId;
      } catch (_error) {
        // If there's a unique constraint violation, clean up the Stripe customer
        // and return the existing customer ID from the database
        try {
          await stripe.customers.del(customer.id);
        } catch (cleanupError) {
          console.warn(
            `Failed to cleanup duplicate Stripe customer ${customer.id}:`,
            cleanupError,
          );
        }

        // Fetch the updated user record to get the existing customer ID
        const updatedUser = await userService.getUserById(userId);
        return updatedUser?.stripeCustomerId ?? null;
      }
    } catch (error) {
      console.error(
        `Error in getOrCreateStripeCustomer for user ${userId}:`,
        error,
      );
      return null;
    }
  });
}

export async function getPromotionCodeByCustomerAndCouponId(
  customerId: string,
  couponId: string,
): Promise<Stripe.PromotionCode | null> {
  const promotionCodes = await stripe.promotionCodes.list({
    coupon: couponId,
    customer: customerId,
    limit: 1,
  });

  if (promotionCodes.data.length === 0) {
    return null;
  }

  return promotionCodes.data[0];
}

export async function updateStripeCustomerEmail(
  userId: string,
  email: string,
): Promise<void> {
  const stripeCustomerId = await getOrCreateStripeCustomer(userId);
  if (!stripeCustomerId) {
    throw new Error("Stripe customer not found");
  }
  await stripe.customers.update(stripeCustomerId, { email });
}

export async function getOrCreatePromotionCode(
  userId: string,
  couponId: string,
  maxRedemptions: number = 1,
  metadata?: Record<string, string>,
): Promise<Stripe.PromotionCode | null> {
  try {
    // Use the new atomic customer creation method
    const stripeCustomerId = await getOrCreateStripeCustomer(userId);
    if (!stripeCustomerId) {
      return null;
    }

    // Check for existing promotion codes
    const promotionCodes = await stripe.promotionCodes.list({
      coupon: couponId,
      customer: stripeCustomerId,
      limit: 1,
    });

    if (promotionCodes.data.length > 0) {
      return promotionCodes.data[0];
    }

    // Create new promotion code
    const promotionCode = await stripe.promotionCodes.create({
      customer: stripeCustomerId,
      coupon: couponId,
      max_redemptions: maxRedemptions,
      metadata,
    });

    return promotionCode;
  } catch (error) {
    console.error(
      `Error in getOrCreatePromotionCode for user ${userId}:`,
      error,
    );
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

export async function updateCustomerMetadata(
  customerId: string,
  userId: string,
): Promise<void> {
  await stripe.customers.update(customerId, {
    metadata: {
      userId: userId,
    },
  });
}
