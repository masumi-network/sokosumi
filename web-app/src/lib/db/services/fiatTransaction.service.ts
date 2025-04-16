"use server";

import {
  createCheckoutSession,
  getConversionFactors,
} from "@/lib/actions/stripe.actions";
import prisma from "@/lib/db/prisma";
import {
  FiatTransaction,
  FiatTransactionStatus,
  Prisma,
} from "@/prisma/generated/client";

import { getUserById } from "./user.service";

async function createFiatTransaction(
  userId: string,
  cents: bigint,
  centsPerAmount: bigint,
  currency: string,
  tx: Prisma.TransactionClient = prisma,
) {
  const fiatTransaction = await tx.fiatTransaction.create({
    data: {
      userId,
      centsPerAmount,
      amount: cents / centsPerAmount,
      currency,
    },
  });
  return fiatTransaction;
}

export async function getFiatTransactionByServicePaymentId(
  servicePaymentId: string,
  tx: Prisma.TransactionClient = prisma,
) {
  return await tx.fiatTransaction.findUnique({
    where: { servicePaymentId },
  });
}

export async function updateServicePaymentId(
  fiatTransactionId: string,
  servicePaymentId: string,
  tx: Prisma.TransactionClient = prisma,
) {
  const fiatTransaction = await tx.fiatTransaction.update({
    where: { id: fiatTransactionId },
    data: { servicePaymentId },
  });
  return fiatTransaction;
}

export async function setFiatTransactionStatusToSucceeded(
  fiatTransaction: FiatTransaction,
  tx: Prisma.TransactionClient = prisma,
): Promise<FiatTransaction> {
  return await tx.fiatTransaction.update({
    where: { id: fiatTransaction.id },
    data: {
      status: FiatTransactionStatus.SUCCEEDED,
      creditTransaction: {
        create: {
          userId: fiatTransaction.userId,
          amount: fiatTransaction.amount * fiatTransaction.centsPerAmount,
        },
      },
    },
  });
}

export async function setFiatTransactionStatusToFailed(
  fiatTransaction: FiatTransaction,
  tx: Prisma.TransactionClient = prisma,
): Promise<FiatTransaction> {
  return await tx.fiatTransaction.update({
    where: { id: fiatTransaction.id },
    data: { status: FiatTransactionStatus.FAILED },
  });
}

export async function createStripeCheckoutSession(
  userId: string,
  priceId: string,
  cents: bigint,
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
    );
    await updateServicePaymentId(fiatTransaction.id, stripeSessionId, tx);
    return { stripeSessionId, url };
  });
}
