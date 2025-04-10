"use server";

import prisma from "@/lib/db/prisma";
import { convertCreditsToBaseUnits } from "@/lib/db/utils/credit.utils";
import { FiatTransactionStatus } from "@/prisma/generated/client";

export async function createFiatTransaction(userId: string, credits: number) {
  const fiatTransaction = await prisma.fiatTransaction.create({
    data: {
      userId,
      credits: convertCreditsToBaseUnits(credits),
    },
  });
  return fiatTransaction;
}

export async function updateServicePaymentId(
  fiatTransactionId: string,
  servicePaymentId: string,
) {
  const fiatTransaction = await prisma.fiatTransaction.update({
    where: { id: fiatTransactionId },
    data: { servicePaymentId },
  });
  return fiatTransaction;
}

export async function updateFiatTransactionStatus(
  sessionId: string,
  status: FiatTransactionStatus,
) {
  switch (status) {
    case FiatTransactionStatus.SUCCEEDED:
      await setFiatTransactionSucceeded(sessionId);
      break;
    case FiatTransactionStatus.FAILED:
      await setFiatTransactionFailed(sessionId);
      break;
    default:
      throw new Error(`Invalid status: ${status}`);
  }
}

async function setFiatTransactionSucceeded(sessionId: string) {
  await prisma.$transaction(async (tx) => {
    const fiatTransaction = await tx.fiatTransaction.findUnique({
      where: { servicePaymentId: sessionId },
    });
    if (!fiatTransaction) {
      console.error(`🔔  No fiat transaction found for session ${sessionId}`);
      return;
    }
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
  });
}

async function setFiatTransactionFailed(sessionId: string) {
  await prisma.$transaction(async (tx) => {
    const fiatTransaction = await tx.fiatTransaction.findUnique({
      where: { servicePaymentId: sessionId },
    });
    if (!fiatTransaction) {
      console.error(`🔔  No fiat transaction found for session ${sessionId}`);
      return;
    }
    return await tx.fiatTransaction.update({
      where: { id: fiatTransaction.id },
      data: { status: FiatTransactionStatus.FAILED },
    });
  });
}
