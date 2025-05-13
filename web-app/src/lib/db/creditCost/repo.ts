"use server";

import { prisma } from "@/lib/db";
import { CreditCost, Prisma } from "@/prisma/generated/client";

export async function getCreditCostByUnit(
  unit: string,
  tx: Prisma.TransactionClient = prisma,
): Promise<CreditCost | null> {
  return await tx.creditCost.findUnique({
    where: {
      unit,
    },
  });
}

export async function getAllCreditCosts(
  tx: Prisma.TransactionClient = prisma,
): Promise<CreditCost[]> {
  return await tx.creditCost.findMany();
}
