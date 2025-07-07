import "server-only";

import Stripe from "stripe";

import { getEnvSecrets } from "@/config/env.secrets";
import { verifyUserId } from "@/lib/auth/utils";
import { convertCreditsToCents } from "@/lib/db";
import {
  createOrganizationFiatTransaction,
  createUserFiatTransaction,
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
  getConversionFactors,
  getCouponById,
  getOrCreatePromotionCode,
} from "./third-party";

interface FiatTransaction {
  id: string;
  amount: bigint;
}

// Unified private helper for creating Stripe checkout sessions
async function createStripeCheckoutSession({
  userId,
  credits,
  priceId,
  promotionCode,
  createFiatTransaction,
}: {
  userId: string;
  credits: number;
  priceId: string;
  promotionCode?: string | null;
  createFiatTransaction: (
    userId: string,
    credits: number,
    amount: number,
    currency: string,
    tx: Parameters<typeof retrieveUserById>[1],
  ) => Promise<FiatTransaction>;
}): Promise<{ stripeSessionId: string; url: string }> {
  await verifyUserId(userId);
  return await prisma.$transaction(async (tx) => {
    try {
      const user = await retrieveUserById(userId, tx);
      if (!user) throw new Error("User not found");
      const conversionFactorsPerCredit = await getConversionFactors(priceId);
      const amount = credits * conversionFactorsPerCredit.amountPerCredit;
      const fiatTransaction = await createFiatTransaction(
        userId,
        credits,
        amount,
        conversionFactorsPerCredit.currency,
        tx,
      );
      const { id: stripeSessionId, url } = await createCheckoutSession(
        user,
        fiatTransaction.id,
        priceId,
        Number(fiatTransaction.amount) /
          conversionFactorsPerCredit.amountPerCredit,
        promotionCode ?? null,
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

export async function createUserStripeCheckoutSession(
  userId: string,
  credits: number,
  priceId: string,
  promotionCode: string | null = null,
): Promise<{ stripeSessionId: string; url: string }> {
  return createStripeCheckoutSession({
    userId,
    credits,
    priceId,
    promotionCode,
    createFiatTransaction: async (userId, credits, amount, currency, tx) =>
      createUserFiatTransaction(
        userId,
        convertCreditsToCents(credits),
        amount,
        currency,
        tx,
      ),
  });
}

export async function createOrganizationStripeCheckoutSession(
  userId: string,
  organizationId: string,
  credits: number,
  priceId: string,
  promotionCode: string | null = null,
): Promise<{ stripeSessionId: string; url: string }> {
  return createStripeCheckoutSession({
    userId,
    credits,
    priceId,
    promotionCode,
    createFiatTransaction: async (userId, credits, amount, currency, tx) =>
      createOrganizationFiatTransaction(
        userId,
        organizationId,
        convertCreditsToCents(credits),
        amount,
        currency,
        tx,
      ),
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
  priceId: string,
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

  const conversionFactors = await getConversionFactors(priceId);

  if (
    coupon.currency?.toLowerCase() !== conversionFactors.currency.toLowerCase()
  ) {
    throw new CouponCurrencyError(
      coupon.currency ?? "unknown",
      conversionFactors.currency,
    );
  }

  const credits = Math.floor(
    coupon.amount_off / conversionFactors.amountPerCredit,
  );
  if (credits < 1) {
    throw new CouponTypeError("Coupon amount is too low");
  }
  return credits;
}
