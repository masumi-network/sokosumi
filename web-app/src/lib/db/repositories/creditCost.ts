import "server-only";

import { CreditCost, Prisma } from "@/prisma/generated/client";

import prisma from "./prisma";

export async function retrieveCreditCostByUnit(
  unit: string,
  tx: Prisma.TransactionClient = prisma,
): Promise<CreditCost | null> {
  return await tx.creditCost.findUnique({
    where: {
      unit,
    },
  });
}

export async function retrieveAllCreditCosts(
  tx: Prisma.TransactionClient = prisma,
): Promise<CreditCost[]> {
  return await tx.creditCost.findMany();
}
