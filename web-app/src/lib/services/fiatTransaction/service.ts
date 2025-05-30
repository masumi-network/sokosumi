"use server";

import { headers } from "next/headers";

import { createCheckoutSession, getConversionFactors } from "@/lib/actions";
import { auth } from "@/lib/auth/auth";
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
  const session = await auth.api.getSession({
    headers: await headers(),
  });
  if (session?.user?.id !== userId) {
    throw new Error("User not identical to the one in the session");
  }
  return await prisma.$transaction(async (tx) => {
    const user = await getUserById(session.user.id, tx);
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
