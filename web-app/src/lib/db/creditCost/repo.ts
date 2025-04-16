"use server";

import { prisma } from "@/lib/db";
import { CreditCost, Prisma } from "@/prisma/generated/client";

import { parseUnit } from "./utils";

export async function getCreditCostByUnit(
  unit: string,
  tx: Prisma.TransactionClient = prisma,
): Promise<CreditCost | null> {
  return await tx.creditCost.findUnique({
    where: {
      unit: parseUnit(unit),
    },
  });
}
