"use server";

import { createCheckoutSession, getConversionFactors } from "@/lib/actions";
import { UnAuthorizedError } from "@/lib/auth/errors";
import { verifyUserAuthentication } from "@/lib/auth/utils";
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
): Promise<{ stripeSessionId: string; url: string }> {
  return await prisma.$transaction(async (tx) => {
    const authorized = await verifyUserAuthentication(userId);
    if (!authorized) {
      throw new UnAuthorizedError();
    }

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
    );
    await updateFiatTransactionServicePaymentId(
      fiatTransaction.id,
      stripeSessionId,
      tx,
    );
    return { stripeSessionId, url };
  });
}
