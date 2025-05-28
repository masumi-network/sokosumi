"use server";

import Stripe from "stripe";

import {
  createCheckoutSession,
  createCoupon,
  getConversionFactors,
} from "@/lib/actions";
import {
  createFiatTransaction,
  getUserById,
  prisma,
  updateFiatTransactionServicePaymentId,
} from "@/lib/db";

export async function createStripeCheckoutSession(
  userId: string,
  priceId: string,
  cents: bigint,
  percent_off: number | null = null,
): Promise<{ stripeSessionId: string; url: string }> {
  return await prisma.$transaction(async (tx) => {
    const user = await getUserById(userId, tx);
    if (!user) {
      throw new Error("User not found");
    }
    const conversionFactorsPerCredit = await getConversionFactors(priceId);
    const fiatTransaction = await createFiatTransaction(
      userId,
      cents,
      conversionFactorsPerCredit.centsPerAmount,
      conversionFactorsPerCredit.currency,
      tx,
    );
    let coupon: Stripe.Coupon | null = null;
    if (percent_off) {
      coupon = await createCoupon(percent_off);
    }
    const { id: stripeSessionId, url } = await createCheckoutSession(
      user,
      fiatTransaction.id,
      priceId,
      Number(fiatTransaction.amount) /
        conversionFactorsPerCredit.amountPerCredit,
      coupon?.id ?? null,
    );
    await updateFiatTransactionServicePaymentId(
      fiatTransaction.id,
      stripeSessionId,
      tx,
    );
    return { stripeSessionId, url };
  });
}

export async function createStripeFreeClaimCheckoutSession(
  userId: string,
): Promise<{ stripeSessionId: string; url: string }> {
  return await prisma.$transaction(async (tx) => {
    const user = await getUserById(userId, tx);
    if (!user) {
      throw new Error("User not found");
    }
    const { id: stripeSessionId, url } =
      await createFreeClaimCheckoutSession(user);
    return { stripeSessionId, url };
  });
}
