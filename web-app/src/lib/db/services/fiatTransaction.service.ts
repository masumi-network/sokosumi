"use server";
import { FiatTransactionStatus } from "@prisma/client";

import prisma from "@/lib/db/prisma";
import { convertCreditsToBaseUnits } from "@/lib/db/utils/credit.utils";

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

export async function getFiatTransactionByServicePaymentId(
  servicePaymentId: string,
) {
  const fiatTransaction = await prisma.fiatTransaction.findUnique({
    where: { servicePaymentId },
  });
  return fiatTransaction;
}

export async function updateFiatTransactionStatus(
  fiatTransactionId: string,
  status: FiatTransactionStatus,
) {
  const fiatTransaction = await prisma.$transaction(async (tx) => {
    let fiatTransaction = await tx.fiatTransaction.update({
      where: { id: fiatTransactionId },
      data: { status },
    });

    if (
      status === FiatTransactionStatus.SUCCEEDED &&
      !fiatTransaction.creditTransactionId
    ) {
      fiatTransaction = await tx.fiatTransaction.update({
        where: { id: fiatTransaction.id },
        data: {
          creditTransaction: {
            create: {
              userId: fiatTransaction.userId,
              amount: fiatTransaction.credits,
            },
          },
        },
      });
    }
    return fiatTransaction;
  });
  return fiatTransaction;
}
