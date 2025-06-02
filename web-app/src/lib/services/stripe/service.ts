"use server";

import { verifyUserId } from "@/lib/auth/utils";
import {
  convertCreditsToCents,
  createFiatTransaction,
  getUserById,
  prisma,
  updateFiatTransactionServicePaymentId,
} from "@/lib/db";

import { createCheckoutSession, getConversionFactors } from "./third-party";

export async function createStripeCheckoutSession(
  userId: string,
  credits: number,
  priceId: string,
  coupon: string | null = null,
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
