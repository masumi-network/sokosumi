import { FiatTransactionStatus } from "@prisma/client";

import prisma from "@/lib/db/prisma";

export async function createFiatTransaction(
  userId: string,
  credits: bigint,
  amount: number,
  currency: string,
  servicePaymentId: string,
) {
  const fiatTransaction = await prisma.fiatTransaction.create({
    data: {
      userId,
      credits,
      amount,
      currency,
      servicePaymentId,
    },
  });
  return fiatTransaction;
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
  return fiatTransaction;
}

export async function getFiatTransactionById(id: string) {
  const fiatTransaction = await prisma.fiatTransaction.findUnique({
    where: { id },
  });
  return fiatTransaction;
}
