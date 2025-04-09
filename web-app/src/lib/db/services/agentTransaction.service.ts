"use server";
import { AgentTransactionType } from "@prisma/client";

import prisma from "@/lib/db/prisma";
import { convertCreditsToBaseUnits } from "@/lib/db/utils/credit.utils";

export async function createAgentTransactionPurchase(
  userId: string,
  amount: number,
  creditTransactionId: string,
  jobId: string,
) {
  const agentTransaction = await prisma.agentTransaction.create({
    data: {
      userId,
      credits: convertCreditsToBaseUnits(amount),
      type: AgentTransactionType.PURCHASE,
      creditTransactionId: creditTransactionId,
      jobId: jobId,
    },
  });
  return agentTransaction;
}

export async function createAgentTransactionRefund(
  userId: string,
  amount: number,
  creditTransactionId: string,
  jobId: string,
) {
  const agentTransaction = await prisma.agentTransaction.create({
    data: {
      userId,
      credits: convertCreditsToBaseUnits(amount),
      type: AgentTransactionType.REFUND,
      creditTransactionId: creditTransactionId,
      jobId: jobId,
    },
  });
  return agentTransaction;
}

export async function getAgentTransactionById(id: string) {
  return await prisma.agentTransaction.findUnique({
    where: { id },
  });
}

export async function getAgentTransactionByCreditTransactionId(
  creditTransactionId: string,
) {
  return await prisma.agentTransaction.findUnique({
    where: { creditTransactionId },
  });
}

export async function getAgentTransactionsByJobId(jobId: string) {
  return await prisma.agentTransaction.findMany({
    where: { jobId },
  });
}

export async function getAgentTransactionsByUserId(userId: string) {
  const agentTransactions = await prisma.agentTransaction.findMany({
    where: { userId },
  });
  return agentTransactions;
}
