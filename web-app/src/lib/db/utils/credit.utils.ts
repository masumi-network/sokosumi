import { getEnvPublicConfig } from "@/config/env.config";
import { CreditTransactionType } from "@/lib/db/types/creditTransaction.type";
import { CreditTransaction } from "@/prisma/generated/client";

export function convertBaseUnitsToCredits(credits: bigint): number {
  return Number(credits) / 10 ** getEnvPublicConfig().NEXT_PUBLIC_CREDITS_BASE;
}

export function convertCreditsToBaseUnits(credits: number): bigint {
  return BigInt(credits * 10 ** getEnvPublicConfig().NEXT_PUBLIC_CREDITS_BASE);
}

export function creditTransactionType(creditTransaction: CreditTransaction) {
  return creditTransaction.amount > 0
    ? CreditTransactionType.CREDIT
    : CreditTransactionType.DEBIT;
}
