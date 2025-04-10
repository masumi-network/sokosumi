"use server";

import { createCheckoutSession } from "@/lib/actions/stripe.actions";
import prisma from "@/lib/db/prisma";
import { convertCreditsToBaseUnits } from "@/lib/db/utils/credit.utils";
import {
  FiatTransaction,
  FiatTransactionStatus,
  Prisma,
} from "@/prisma/generated/client";

import { getUserById } from "./user.service";

export async function createFiatTransaction(
  userId: string,
  credits: number,
  tx: Prisma.TransactionClient = prisma,
) {
  const fiatTransaction = await tx.fiatTransaction.create({
    data: {
      userId,
      credits: convertCreditsToBaseUnits(credits),
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
          amount: fiatTransaction.credits,
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
  credits: number,
): Promise<{ stripeSessionId: string; url: string }> {
  return await prisma.$transaction(async (tx) => {
    const user = await getUserById(userId, tx);
    if (!user) {
      throw new Error("User not found");
    }
    const fiatTransaction = await createFiatTransaction(userId, credits, tx);
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
