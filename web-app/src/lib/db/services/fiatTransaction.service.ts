"use server";

import prisma from "@/lib/db/prisma";
import { convertCreditsToBaseUnits } from "@/lib/db/utils/credit.utils";
import {
  FiatTransaction,
  FiatTransactionStatus,
  Prisma,
} from "@/prisma/generated/client";

export async function createFiatTransaction(userId: string, credits: number) {
  const fiatTransaction = await prisma.fiatTransaction.create({
    data: {
      userId,
      credits: convertCreditsToBaseUnits(credits),
    },
  });
  return fiatTransaction;
}

export async function getFiatTransactionByServicePaymentId(
  servicePaymentId: string,
  tx?: Prisma.TransactionClient,
) {
  return await (tx ?? prisma).fiatTransaction.findUnique({
    where: { servicePaymentId },
  });
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

export async function setFiatTransactionSucceeded(
  fiatTransaction: FiatTransaction,
  tx?: Prisma.TransactionClient,
) {
  return await (tx ?? prisma).fiatTransaction.update({
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

export async function setFiatTransactionFailed(
  fiatTransaction: FiatTransaction,
  tx?: Prisma.TransactionClient,
) {
  return await (tx ?? prisma).fiatTransaction.update({
    where: { id: fiatTransaction.id },
    data: { status: FiatTransactionStatus.FAILED },
  });
}
