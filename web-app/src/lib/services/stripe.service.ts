import "server-only";

import Stripe from "stripe";

import { getEnvSecrets } from "@/config/env.secrets";
import { UnAuthenticatedError } from "@/lib/auth/errors";
import { verifyUserId } from "@/lib/auth/utils";
import { Price, stripeClient } from "@/lib/clients/stripe.client";
import { convertCreditsToCents } from "@/lib/db";
import {
  fiatTransactionRepository,
  prisma,
  userRepository,
} from "@/lib/db/repositories";
import {
  CouponCurrencyError,
  CouponNotFoundError,
  CouponTypeError,
  PromotionCodeNotFoundError,
} from "@/lib/errors/coupon-errors";

export const stripeService = {
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
        const user = await userRepository.getUserById(userId, tx);
        if (!user) throw new Error("User not found");
        const amount = credits * price.amountPerCredit;
        const fiatTransaction =
          await fiatTransactionRepository.createFiatTransaction(
            userId,
            organizationId,
            convertCreditsToCents(credits),
            amount,
            price.currency,
            tx,
          );
        const { id: stripeSessionId, url } =
          await stripeClient.createCheckoutSession(
            user,
            fiatTransaction,
            price,
            promotionCode,
          );
        await fiatTransactionRepository.updateFiatTransaction(
          fiatTransaction.id,
          { servicePaymentId: stripeSessionId },
          tx,
        );
        return { stripeSessionId, url };
      } catch (error) {
        console.log("Error creating stripe checkout session", error);
        throw error;
      }
    });
  },

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

    const user = await userRepository.getUserById(userId);
    if (!user) {
      throw new Error("User not found");
    }

    const stripeCustomerId =
      await stripeClient.getOrCreateStripeCustomer(userId);
    if (!stripeCustomerId) {
      return null;
    }

    for (const couponId of couponIds) {
      try {
        const promotionCode = await stripeClient.getPromotionCode(
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
  },

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
    const user = await userRepository.getUserById(userId);
    if (!user) {
      throw new Error("User not found");
    }

    return await stripeClient.getOrCreatePromotionCode(
      user.id,
      couponId,
      maxRedemptions,
      metadata,
    );
  },

  async getCreditsForPromotionCode(
    promotionCode: string,
    price: Price,
  ): Promise<number> {
    const coupon = await stripeClient.getCouponByPromotionCode(promotionCode);
    if (!coupon) {
      throw new PromotionCodeNotFoundError(promotionCode);
    }
    return this.getCreditsForCoupon(coupon.id, price);
  },

  async getCreditsForCoupon(couponId: string, price: Price): Promise<number> {
    const coupon = await stripeClient.getCouponById(couponId);
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
  },
};
