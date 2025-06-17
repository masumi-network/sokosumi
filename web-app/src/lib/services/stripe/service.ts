"use server";

import Stripe from "stripe";

import { getEnvSecrets } from "@/config/env.config";
import { getSessionOrThrow, verifyUserId } from "@/lib/auth/utils";
import {
  convertCreditsToCents,
  createFiatTransaction,
  getUserById,
  prisma,
  updateFiatTransactionServicePaymentId,
} from "@/lib/db";

import {
  createCheckoutSession,
  createCustomer,
  getConversionFactors,
  getOrCreatePromotionCode,
} from "./third-party";

export async function createStripeCheckoutSession(
  userId: string,
  credits: number,
  priceId: string,
  promotionCode: string | null = null,
): Promise<{ stripeSessionId: string; url: string }> {
  // Verify that the user is the one initiating the transaction
  await verifyUserId(userId);

  // Create the fiat transaction and the checkout session
  return await prisma.$transaction(async (tx) => {
    const user = await getUserById(userId, tx);
    if (!user) {
      throw new Error("User not found");
    }
    const conversionFactorsPerCredit = await getConversionFactors(priceId);
    const amount = credits * conversionFactorsPerCredit.amountPerCredit;
    const fiatTransaction = await createFiatTransaction(
      userId,
      convertCreditsToCents(credits),
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
      promotionCode,
    );

    await updateFiatTransactionServicePaymentId(
      fiatTransaction.id,
      stripeSessionId,
      tx,
    );
    return { stripeSessionId, url };
  });
}

export async function getWelcomePromotionCode(): Promise<Stripe.PromotionCode | null> {
  const couponId = getEnvSecrets().STRIPE_WELCOME_COUPON;
  if (!couponId) {
    return null;
  }
  return await getPromotionCode(couponId, 1);
}

export async function getPromotionCode(
  couponId: string,
  maxRedemptions: number = 1,
  metadata?: Record<string, string>,
): Promise<Stripe.PromotionCode | null> {
  const session = await getSessionOrThrow();
  const user = await getUserById(session.user.id);
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
