import "server-only";

import { headers } from "next/headers";
import Stripe from "stripe";

import { getEnvSecrets } from "@/config/env.secrets";
import { UnAuthenticatedError } from "@/lib/auth/errors";
import { verifyUserId } from "@/lib/auth/utils";
import { convertCreditsToCents } from "@/lib/db/helpers";
import {
  createFiatTransaction,
  updateFiatTransactionServicePaymentId,
} from "@/lib/db/repositories";
import prisma from "@/lib/db/repositories/prisma";
import {
  CouponCurrencyError,
  CouponNotFoundError,
  CouponTypeError,
} from "@/lib/errors/coupon-errors";
import { FiatTransaction, User } from "@/prisma/generated/client";

import { BaseService } from "./base.service";
import { UserService } from "./user.service";

const stripe = new Stripe(getEnvSecrets().STRIPE_SECRET_KEY);

export interface Price {
  id: string;
  amountPerCredit: number;
  currency: string;
}

export class StripeService extends BaseService<StripeService> {
  async createCustomer(userId: string): Promise<string> {
    const customer = await stripe.customers.create({
      email: userId,
    });
    return customer.id;
  }

  async getOrCreateStripeCustomer(userId: string): Promise<string | null> {
    return await prisma.$transaction(async (tx) => {
      try {
        const userService = UserService.getInstance(tx);
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
          user = await userService.setUserStripeCustomerId(
            user.id,
            customer.id,
          );
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

  validatePrice(price: Stripe.Price): Price {
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

  async getPriceFromPriceId(priceId: string): Promise<Price> {
    try {
      const price = await stripe.prices.retrieve(priceId);
      return this.validatePrice(price);
    } catch (error) {
      console.error("Error retrieving price", error);
      throw error;
    }
  }

  async getPriceFromProductId(productId: string): Promise<Price> {
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
      return this.validatePrice(product.default_price);
    } catch (error) {
      console.error("Error retrieving price", error);
      throw error;
    }
  }

  async createCheckoutSession(
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
      success_url: `${origin}/billing/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/billing/cancel`,
    });
    if (!session.url) {
      throw new Error("Stripe session URL is null");
    }
    return { id: session.id, url: session.url };
  }

  async constructEvent(req: Request, stripeSignature: string) {
    return stripe.webhooks.constructEvent(
      await req.text(),
      stripeSignature,
      getEnvSecrets().STRIPE_WEBHOOK_SECRET,
    );
  }

  async getPromotionCodeByCustomerAndCouponId(
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

  async getOrCreatePromotionCode(
    userId: string,
    couponId: string,
    maxRedemptions: number = 1,
    metadata?: Record<string, string>,
  ): Promise<Stripe.PromotionCode | null> {
    try {
      // Use the new atomic customer creation method
      const stripeCustomerId =
        await StripeService.getInstance().getOrCreateStripeCustomer(userId);
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

  async getCouponById(couponId: string): Promise<Stripe.Coupon | null> {
    try {
      return await stripe.coupons.retrieve(couponId);
    } catch {
      return null;
    }
  }

  async updateCustomerMetadata(
    customerId: string,
    userId: string,
  ): Promise<void> {
    await stripe.customers.update(customerId, {
      metadata: {
        userId: userId,
      },
    });
  }

  // Service functions
  async createStripeCheckoutSession(
    userId: string,
    organizationId: string | null,
    credits: number,
    price: Price,
    promotionCode: string | null = null,
  ): Promise<{ stripeSessionId: string; url: string }> {
    const isVerified = await verifyUserId(userId);
    if (!isVerified) {
      throw new UnAuthenticatedError("User not authorized");
    }
    return await prisma.$transaction(async (tx) => {
      try {
        const user = await UserService.getInstance(tx).getUserById(userId);
        if (!user) throw new Error("User not found");
        const amount = credits * price.amountPerCredit;
        const fiatTransaction = await createFiatTransaction(
          userId,
          organizationId,
          convertCreditsToCents(credits),
          amount,
          price.currency,
          tx,
        );
        const { id: stripeSessionId, url } = await StripeService.getInstance(
          tx,
        ).createCheckoutSession(user, fiatTransaction, price, promotionCode);
        await updateFiatTransactionServicePaymentId(
          fiatTransaction.id,
          stripeSessionId,
          tx,
        );
        return { stripeSessionId, url };
      } catch (error) {
        console.log("Error creating stripe checkout session", error);
        throw error;
      }
    });
  }

  async getPromotionCode(
    userId: string,
    couponId: string,
    maxRedemptions: number = 1,
    metadata?: Record<string, string>,
  ): Promise<Stripe.PromotionCode | null> {
    const isVerified = await verifyUserId(userId);
    if (!isVerified) {
      return null;
    }
    const user = await UserService.getInstance().getUserById(userId);
    if (!user) {
      throw new Error("User not found");
    }

    return await StripeService.getInstance().getOrCreatePromotionCode(
      user.id,
      couponId,
      maxRedemptions,
      metadata,
    );
  }

  async getWelcomePromotionCode(
    userId: string,
  ): Promise<Stripe.PromotionCode | null> {
    const couponIds = getEnvSecrets().STRIPE_WELCOME_COUPONS;
    if (couponIds.length === 0) {
      return null;
    }

    const isVerified = await verifyUserId(userId);
    if (!isVerified) {
      return null;
    }

    const user = await UserService.getInstance().getUserById(userId);
    if (!user) {
      throw new Error("User not found");
    }

    const stripeCustomerId =
      await StripeService.getInstance().getOrCreateStripeCustomer(userId);
    if (!stripeCustomerId) {
      return null;
    }

    for (const couponId of couponIds) {
      try {
        const promotionCode =
          await StripeService.getInstance().getPromotionCodeByCustomerAndCouponId(
            stripeCustomerId,
            couponId,
          );
        if (
          promotionCode?.times_redeemed &&
          promotionCode.times_redeemed >= 1
        ) {
          return null;
        }
      } catch {
        return null;
      }
    }

    const lastCouponId = couponIds.at(-1);
    if (!lastCouponId) {
      return null;
    }

    return await this.getPromotionCode(userId, lastCouponId, 1);
  }

  async getCreditsForCoupon(couponId: string, price: Price): Promise<number> {
    const coupon = await StripeService.getInstance().getCouponById(couponId);
    if (!coupon) {
      throw new CouponNotFoundError(couponId);
    }
    if (coupon.percent_off) {
      throw new CouponTypeError("Only fixed-amount coupons are supported");
    }
    if (!coupon.amount_off) {
      throw new CouponTypeError("Coupon must have a fixed amount");
    }

    if (coupon.currency?.toLowerCase() !== price.currency.toLowerCase()) {
      throw new CouponCurrencyError(
        coupon.currency ?? "unknown",
        price.currency,
      );
    }

    // Prevent division by zero for price.unit_amount
    if (price.amountPerCredit === 0) {
      throw new CouponTypeError(
        "Price amountPerCredit is 0 – cannot calculate credits for free product",
      );
    }
    const credits = Math.floor(coupon.amount_off / price.amountPerCredit);
    if (credits < 1) {
      throw new CouponTypeError("Coupon amount is too low");
    }
    return credits;
  }
}
