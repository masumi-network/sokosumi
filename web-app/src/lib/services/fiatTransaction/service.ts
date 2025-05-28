"use server";

import { createCheckoutSession, getConversionFactors } from "@/lib/actions";
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
  coupon: string | null = null,
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
    const { id: stripeSessionId, url } = await createCheckoutSession(
      user,
      fiatTransaction.id,
      priceId,
      Number(fiatTransaction.amount) /
        conversionFactorsPerCredit.amountPerCredit,
      coupon,
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
