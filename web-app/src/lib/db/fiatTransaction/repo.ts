"use server";

import { prisma } from "@/lib/db";
import {
  FiatTransaction,
  FiatTransactionStatus,
  Prisma,
} from "@/prisma/generated/client";

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
      centsPerAmount: null,
      amount,
      currency,
    },
  });
}

export async function getFiatTransactionByServicePaymentId(
  servicePaymentId: string,
  tx: Prisma.TransactionClient = prisma,
): Promise<FiatTransaction | null> {
  return await tx.fiatTransaction.findUnique({
    where: { servicePaymentId },
  });
}

export async function updateFiatTransactionServicePaymentId(
  fiatTransactionId: string,
  servicePaymentId: string,
  tx: Prisma.TransactionClient = prisma,
): Promise<FiatTransaction> {
  return await tx.fiatTransaction.update({
    where: { id: fiatTransactionId },
    data: { servicePaymentId },
  });
}

export async function setFiatTransactionStatusToSucceeded(
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

export async function setFiatTransactionStatusToFailed(
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
