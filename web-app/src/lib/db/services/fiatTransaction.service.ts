"use server";

import {
  createCheckoutSession,
  getCostPerCredit,
} from "@/lib/actions/stripe.actions";
import prisma from "@/lib/db/prisma";
import { convertCentsToCredits } from "@/lib/db/utils/credit.utils";
import {
  FiatTransaction,
  FiatTransactionStatus,
  Prisma,
} from "@/prisma/generated/client";

import { getUserById } from "./user.service";

async function createFiatTransaction(
  userId: string,
  creditCents: bigint,
  amount: number,
  currency: string,
  tx: Prisma.TransactionClient = prisma,
) {
  const fiatTransaction = await tx.fiatTransaction.create({
    data: {
      userId,
      creditCents,
      amount,
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
          cents: fiatTransaction.creditCents,
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

export async function createOneTimePaymentStripeSession(
  userId: string,
  priceId: string,
  cents: bigint,
): Promise<{ stripeSessionId: string; url: string }> {
  return await prisma.$transaction(async (tx) => {
    const user = await getUserById(userId, tx);
    if (!user) {
      throw new Error("User not found");
    }
    const credits = convertCentsToCredits(cents);
    const costPerCredit = await getCostPerCredit(priceId);
    const fiatTransaction = await createFiatTransaction(
      userId,
      cents,
      costPerCredit.amountPerCredit * credits,
      costPerCredit.currency,
      tx,
    );
    const { id: stripeSessionId, url } = await createCheckoutSession(
      user,
      fiatTransaction.id,
      priceId,
      credits,
    );
    await updateServicePaymentId(fiatTransaction.id, stripeSessionId, tx);
    return { stripeSessionId, url };
  });
}
