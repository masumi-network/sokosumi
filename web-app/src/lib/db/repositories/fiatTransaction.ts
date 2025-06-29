import "server-only";

import {
  FiatTransaction,
  FiatTransactionStatus,
  Prisma,
} from "@/prisma/generated/client";

import prisma from "./prisma";

export async function createFiatTransaction(
  userId: string,
  cents: bigint,
  amount: number,
  currency: string,
  tx: Prisma.TransactionClient = prisma,
): Promise<FiatTransaction> {
  return await tx.fiatTransaction.create({
    data: {
      userId,
      cents,
      amount,
      currency,
    },
  });
}

export async function retrieveFiatTransactionByServicePaymentId(
  servicePaymentId: string,
  tx: Prisma.TransactionClient = prisma,
): Promise<FiatTransaction | null> {
  return await tx.fiatTransaction.findUnique({
    where: { servicePaymentId },
  });
}

export async function updateFiatTransactionServicePaymentId(
  id: string,
  servicePaymentId: string,
  tx: Prisma.TransactionClient = prisma,
): Promise<FiatTransaction> {
  return await tx.fiatTransaction.update({
    where: { id },
    data: { servicePaymentId },
  });
}

export async function updateFiatTransactionStatusToSucceeded(
  fiatTransaction: FiatTransaction,
  amount: bigint,
  currency: string,
  tx: Prisma.TransactionClient = prisma,
): Promise<FiatTransaction> {
  return await tx.fiatTransaction.update({
    where: { id: fiatTransaction.id },
    data: {
      status: FiatTransactionStatus.SUCCEEDED,
      amount,
      currency,
      creditTransaction: {
        create: {
          userId: fiatTransaction.userId,
          amount: fiatTransaction.cents,
        },
      },
    },
  });
}

export async function updateFiatTransactionStatusToFailed(
  fiatTransaction: FiatTransaction,
  amount: bigint,
  currency: string,
  tx: Prisma.TransactionClient = prisma,
): Promise<FiatTransaction> {
  return await tx.fiatTransaction.update({
    where: { id: fiatTransaction.id },
    data: { status: FiatTransactionStatus.FAILED, amount, currency },
  });
}
