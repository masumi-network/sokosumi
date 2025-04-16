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
  centsPerAmount: bigint,
  currency: string,
  tx: Prisma.TransactionClient = prisma,
): Promise<FiatTransaction> {
  return await tx.fiatTransaction.create({
    data: {
      userId,
      centsPerAmount,
      amount: cents / centsPerAmount,
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
