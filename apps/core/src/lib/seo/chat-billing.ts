import type { Prisma } from "@sokosumi/database";
import {
  creditBucketRepository,
  InsufficientBalanceError,
} from "@sokosumi/database/repositories";
import { CORE_API_ERROR_KINDS } from "@sokosumi/utils";

import { serviceUnavailable, unprocessableEntity } from "@/helpers/error";
import { gatewayCallUsage } from "@/lib/soko-bot/gateway-cost";
import { sokoBotUsageCents } from "@/services/soko-bot-billing.service";

const USD_MICROS_PER_USD = 1_000_000;

export interface SeoChatPayer {
  userId: string;
  organizationId: string | null;
  projectId: string | null;
}

function insufficientCredits() {
  return unprocessableEntity("Not enough credits for this SEO chat reply", {
    kind: CORE_API_ERROR_KINDS.INSUFFICIENT_BALANCE,
  });
}

/** Missing Gateway prices are unknown, never proof of a free model call. */
export function seoChatUsage(result: {
  usage?: { inputTokens?: unknown; outputTokens?: unknown };
  providerMetadata?: unknown;
}) {
  const metadata = result.providerMetadata;
  const gateway =
    metadata && typeof metadata === "object" && "gateway" in metadata
      ? metadata.gateway
      : null;
  const raw =
    gateway && typeof gateway === "object" && "cost" in gateway
      ? gateway.cost
      : undefined;
  const costUsd = typeof raw === "string" && raw.trim() ? Number(raw) : raw;
  if (typeof costUsd !== "number" || !Number.isFinite(costUsd) || costUsd < 0)
    throw serviceUnavailable("SEO chat usage price is unavailable");
  return { ...gatewayCallUsage(result), costUsd };
}

export async function requireSeoChatBalance(
  tx: Prisma.TransactionClient,
  payer: SeoChatPayer,
): Promise<void> {
  const balance = await creditBucketRepository.getBalance(
    payer.userId,
    payer.organizationId,
    tx,
    { projectId: payer.projectId },
  );
  if (balance < sokoBotUsageCents(0n, true)) throw insufficientCredits();
}

/** The caller claims the turn and saves this debit in the same transaction. */
export async function chargeSeoChatReply(
  tx: Prisma.TransactionClient,
  payer: SeoChatPayer,
  costUsd: number,
): Promise<string> {
  const micros = Math.round(costUsd * USD_MICROS_PER_USD);
  if (!Number.isSafeInteger(micros) || micros < 0)
    throw serviceUnavailable("SEO chat usage price is unavailable");
  const cents = sokoBotUsageCents(BigInt(micros), true);
  let consumptions;
  try {
    consumptions = await creditBucketRepository.prepareConsumption(
      "mainnet",
      payer.userId,
      payer.organizationId,
      cents,
      tx,
      { projectId: payer.projectId },
    );
  } catch (error) {
    if (error instanceof InsufficientBalanceError) throw insufficientCredits();
    throw error;
  }
  const transaction = await tx.transaction.create({
    data: {
      amount: -cents,
      userId: payer.userId,
      organizationId: payer.organizationId,
      creditConsumptions: { createMany: { data: consumptions } },
    },
    select: { id: true },
  });
  return transaction.id;
}
