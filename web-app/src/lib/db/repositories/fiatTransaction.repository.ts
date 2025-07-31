import "server-only";

import {
  FiatTransaction,
  FiatTransactionStatus,
  Prisma,
} from "@/prisma/generated/client";

import prisma from "./prisma";

async function createFiatTransaction(
  userId: string,
  organizationId: string | null,
  cents: bigint,
  amount: number,
  currency: string,
  tx: Prisma.TransactionClient = prisma,
): Promise<FiatTransaction> {
  return await tx.fiatTransaction.create({
    data: {
      user: { connect: { id: userId } },
      ...(organizationId && {
        organization: { connect: { id: organizationId } },
      }),
      cents,
      amount,
      currency,
    },
  });
}

async function getFiatTransaction(
  where: Prisma.FiatTransactionWhereUniqueInput,
  tx: Prisma.TransactionClient = prisma,
): Promise<FiatTransaction | null> {
  return await tx.fiatTransaction.findUnique({
    where,
  });
}

async function updateFiatTransaction(
  where: Prisma.FiatTransactionWhereUniqueInput,
  data: Prisma.FiatTransactionUpdateInput,
  tx: Prisma.TransactionClient = prisma,
): Promise<FiatTransaction> {
  return await tx.fiatTransaction.update({
    where,
    data,
  });
}

async function updateFiatTransactionStatus(
  fiatTransaction: FiatTransaction,
  amount: bigint,
  currency: string,
  status: FiatTransactionStatus,
  tx: Prisma.TransactionClient = prisma,
): Promise<FiatTransaction> {
  // Build credit transaction data based on whether it's for a user or organization
  const creditTransactionData = {
    amount: fiatTransaction.cents,
    user: { connect: { id: fiatTransaction.userId } },
    ...(fiatTransaction.organizationId && {
      organization: { connect: { id: fiatTransaction.organizationId } },
    }),
  };

  return await tx.fiatTransaction.update({
    where: { id: fiatTransaction.id },
    data: {
      status,
      amount,
      currency,
      ...(status === FiatTransactionStatus.SUCCEEDED && {
        creditTransaction: {
          create: creditTransactionData,
        },
      }),
    },
  });
}

export const fiatTransactionRepository = {
  createFiatTransaction,
  getFiatTransaction,
  updateFiatTransaction,
  updateFiatTransactionStatus,
};
