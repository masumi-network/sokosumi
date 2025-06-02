"use server";

import { verifyUserId } from "@/lib/auth/utils";
import {
  createFiatTransaction,
  getUserById,
  prisma,
  updateFiatTransactionServicePaymentId,
} from "@/lib/db";

import { createCheckoutSession, getConversionFactors } from "./third-party";

export async function createStripeCheckoutSession(
  userId: string,
  cents: bigint,
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
