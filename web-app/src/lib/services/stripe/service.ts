import "server-only";

import Stripe from "stripe";

import { getEnvSecrets } from "@/config/env.secrets";
import { verifyUserId } from "@/lib/auth/utils";
import { convertCreditsToCents } from "@/lib/db";
import {
  createFiatTransaction,
  prisma,
  retrieveUserById,
  updateFiatTransactionServicePaymentId,
} from "@/lib/db/repositories";
import {
  CouponCurrencyError,
  CouponNotFoundError,
  CouponTypeError,
} from "@/lib/errors/coupon-errors";

import {
  createCheckoutSession,
  createCustomer,
  getCouponById,
  getOrCreatePromotionCode,
  Price,
} from "./third-party";

// Unified private helper for creating Stripe checkout sessions
export async function createStripeCheckoutSession(
  userId: string,
  organizationId: string | null,
  credits: number,
  price: Price,
  promotionCode: string | null = null,
): Promise<{ stripeSessionId: string; url: string }> {
  await verifyUserId(userId);
  return await prisma.$transaction(async (tx) => {
    try {
      const user = await retrieveUserById(userId, tx);
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
      const { id: stripeSessionId, url } = await createCheckoutSession(
        user,
        fiatTransaction,
        price,
        promotionCode,
      );
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

export async function getWelcomePromotionCode(
  userId: string,
): Promise<Stripe.PromotionCode | null> {
  const couponId = getEnvSecrets().STRIPE_WELCOME_COUPON;
  if (!couponId) {
    return null;
  }
  return await getPromotionCode(userId, couponId, 1);
}

export async function getPromotionCode(
  userId: string,
  couponId: string,
  maxRedemptions: number = 1,
  metadata?: Record<string, string>,
): Promise<Stripe.PromotionCode | null> {
  await verifyUserId(userId);
  const user = await retrieveUserById(userId);
  if (!user) {
    throw new Error("User not found");
  }
  let stripeCustomerId = user.stripeCustomerId;
  stripeCustomerId ??= await createCustomer(user);

  return await getOrCreatePromotionCode(
    stripeCustomerId,
    couponId,
    maxRedemptions,
    metadata,
  );
}

export async function getCreditsForCoupon(
  couponId: string,
  price: Price,
): Promise<number> {
  const coupon = await getCouponById(couponId);
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
    throw new CouponCurrencyError(coupon.currency ?? "unknown", price.currency);
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
