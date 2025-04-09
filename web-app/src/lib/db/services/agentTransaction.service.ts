"use server";
import { AgentTransactionType } from "@prisma/client";

import prisma from "@/lib/db/prisma";
import { convertCreditsToBaseUnits } from "@/lib/db/utils/credit.utils";

export async function createAgentTransaction(
  userId: string,
  creditTransactionId: string,
  jobId: string,
  amount: number,
  type: AgentTransactionType,
) {
  const agentTransaction = await prisma.agentTransaction.create({
    data: {
      userId,
      credits: convertCreditsToBaseUnits(amount),
      type,
      creditTransactionId,
      jobId,
    },
  });
  return agentTransaction;
}

export async function getAgentTransactionsByUserId(userId: string) {
  const agentTransactions = await prisma.agentTransaction.findMany({
    where: { userId },
  });
  return agentTransactions;
}
