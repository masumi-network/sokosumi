import { FiatTransactionStatus } from "@prisma/client";

import prisma from "@/lib/db/prisma";
import { convertCreditsToBaseUnits } from "@/lib/db/utils/credit.utils";

import { createCreditTransaction } from "./credit.service";

export async function createFiatTransaction(userId: string, credits: number) {
  const fiatTransaction = await prisma.fiatTransaction.create({
    data: {
      userId,
      credits: convertCreditsToBaseUnits(credits),
    },
  });
  return fiatTransaction;
}

export async function updateFiatTransactionServicePaymentId(
  fiatTransactionId: string,
  servicePaymentId: string,
) {
  const fiatTransaction = await prisma.fiatTransaction.update({
    where: { id: fiatTransactionId },
    data: { servicePaymentId },
  });
  return fiatTransaction;
}

export async function updateFiatTransactionCreditTransactionId(
  fiatTransactionId: string,
  creditTransactionId: string,
) {
  await prisma.fiatTransaction.update({
    where: { id: fiatTransactionId },
    data: { creditTransactionId },
  });
}

export async function getFiatTransactionByServicePaymentId(
  servicePaymentId: string,
) {
  const fiatTransaction = await prisma.fiatTransaction.findUnique({
    where: { servicePaymentId },
  });
  return fiatTransaction;
}

export async function getFiatTransactionsByUserId(userId: string) {
  const fiatTransactions = await prisma.fiatTransaction.findMany({
    where: { userId },
  });
  return fiatTransactions;
}

export async function getFiatTransactionsByUserIdAndStatus(
  userId: string,
  status: FiatTransactionStatus,
) {
  const fiatTransactions = await prisma.fiatTransaction.findMany({
    where: { userId, status },
  });
  return fiatTransactions;
}

export async function updateFiatTransactionStatus(
  servicePaymentId: string,
  status: FiatTransactionStatus,
) {
  const fiatTransaction = await prisma.fiatTransaction.update({
    where: { servicePaymentId },
    data: { status },
  });

  if (status === FiatTransactionStatus.SUCCEEDED) {
    const creditTransaction = await createCreditTransaction(
      fiatTransaction.userId,
      fiatTransaction.credits,
    );
    await prisma.fiatTransaction.update({
      where: { id: fiatTransaction.id },
      data: { creditTransactionId: creditTransaction.id },
    });
  }
  return fiatTransaction;
}

export async function getFiatTransactionById(id: string) {
  const fiatTransaction = await prisma.fiatTransaction.findUnique({
    where: { id },
  });
  return fiatTransaction;
}
