import type { Prisma } from "@sokosumi/database";
import { creditBucketRepository } from "@sokosumi/database/repositories";
import { convertCreditsToCents } from "@sokosumi/utils";

import { getEnv } from "@/config/env";
import prisma from "@/lib/db/prisma";

const SOKO_BOT_TURN_COST_HISTORY_SIZE = 3;
const SOKO_BOT_BILLING_SHORTFALL_ERROR_KIND = "insufficient_credits";

export class SokoBotBillingAccessError extends Error {}

export interface SokoBotUsageChargeResult {
  chargedCents: bigint;
  expectedCents: bigint;
  shortfall: boolean;
}

function sokoBotTurnUsageIdempotencyKey(turnId: string): string {
  return `soko-bot-turn:${turnId}`;
}

/**
 * A turn that ran the model bills at least the per-turn minimum, even when
 * the provider reported no cost for it; otherwise those turns were free and
 * left no trace in the owner's credit history.
 */
export function sokoBotUsageCents(
  costUsdMicros: bigint,
  ranModel = false,
): bigint {
  if (costUsdMicros <= 0n) {
    return ranModel
      ? convertCreditsToCents(getEnv().SOKO_BOT_MIN_TURN_CREDITS)
      : 0n;
  }
  const env = getEnv();
  const costUsd = Number(costUsdMicros) / 1_000_000;
  const meteredCredits = costUsd * env.SOKO_BOT_CREDITS_PER_USD;
  return convertCreditsToCents(
    Math.max(meteredCredits, env.SOKO_BOT_MIN_TURN_CREDITS),
  );
}

/** Bots in an organization workspace bill the organization, like its Tasks. */
export async function sokoBotPayerOrganizationId(
  sokoBotId: string,
  client: Pick<Prisma.TransactionClient, "sokoBot">,
): Promise<string | null> {
  const bot = await client.sokoBot.findUnique({
    where: { id: sokoBotId },
    select: { workspace: { select: { organizationId: true } } },
  });
  return bot?.workspace.organizationId ?? null;
}

function payerLabel(organizationId: string | null): string {
  return organizationId ? "organization" : "personal";
}

/** Tells the owner once a day that self-started turns stopped for credits. */
export async function notifySokoBotOutOfCredits(
  sokoBotId: string,
  now: Date = new Date(),
): Promise<void> {
  const bot = await prisma.sokoBot.findUnique({
    where: { id: sokoBotId },
    select: {
      workspace: { select: { organization: { select: { name: true } } } },
    },
  });
  if (!bot) return;
  const payer = bot.workspace.organization?.name;
  const { postSokoBotOwnerNotice } = await import(
    "@/services/soko-bot-chat.service"
  );
  await postSokoBotOwnerNotice({
    sokoBotId,
    content: payer
      ? `I'm paused: ${payer} is out of credits.`
      : "I'm paused: you're out of credits.",
    key: `out-of-credits:${sokoBotId}:${now.toISOString().slice(0, 10)}`,
  });
}

/** Ids of the bots whose payer cannot fund even a minimum turn right now. */
export async function sokoBotIdsOutOfCredits(
  bots: { id: string; userId: string; organizationId: string | null }[],
): Promise<Set<string>> {
  const minimumCents = convertCreditsToCents(
    getEnv().SOKO_BOT_MIN_TURN_CREDITS,
  );
  const payerKey = (bot: (typeof bots)[number]) =>
    `${bot.userId}:${bot.organizationId ?? ""}`;
  const payers = [...new Map(bots.map((bot) => [payerKey(bot), bot])).values()];
  const balances = new Map(
    await Promise.all(
      payers.map(
        async (bot) =>
          [
            payerKey(bot),
            await creditBucketRepository.getBalance(
              bot.userId,
              bot.organizationId,
              prisma,
            ),
          ] as const,
      ),
    ),
  );
  return new Set(
    bots
      .filter((bot) => (balances.get(payerKey(bot)) ?? 0n) < minimumCents)
      .map((bot) => bot.id),
  );
}

export async function requireSokoBotTurnFunding(
  userId: string,
  sokoBotId: string,
): Promise<void> {
  const [completedTurns, shortfallTurn] = await Promise.all([
    prisma.sokoBotTurn.findMany({
      where: {
        sokoBotId,
        userId,
        status: "COMPLETED",
      },
      select: { id: true },
      orderBy: { completedAt: "desc" },
      take: SOKO_BOT_TURN_COST_HISTORY_SIZE,
    }),
    prisma.sokoBotTurn.findFirst({
      where: {
        sokoBotId,
        userId,
        errorKind: SOKO_BOT_BILLING_SHORTFALL_ERROR_KIND,
        completedAt: { not: null },
      },
      select: { id: true, costUsdMicros: true },
      orderBy: { completedAt: "desc" },
    }),
  ]);
  const [recentUsage, shortfallUsage] = await Promise.all([
    completedTurns.length > 0
      ? prisma.sokoBotUsage.findMany({
          where: {
            sokoBotId,
            userId,
            idempotencyKey: {
              in: completedTurns.map(({ id }) =>
                sokoBotTurnUsageIdempotencyKey(id),
              ),
            },
          },
          select: { cents: true },
        })
      : [],
    shortfallTurn
      ? prisma.sokoBotUsage.findUnique({
          where: {
            sokoBotId_idempotencyKey: {
              sokoBotId,
              idempotencyKey: sokoBotTurnUsageIdempotencyKey(shortfallTurn.id),
            },
          },
          select: { cents: true },
        })
      : null,
  ]);
  const minimumCents = convertCreditsToCents(
    getEnv().SOKO_BOT_MIN_TURN_CREDITS,
  );
  const recentTurnCents = recentUsage.reduce(
    (maximum, usage) => (usage.cents > maximum ? usage.cents : maximum),
    0n,
  );
  const shortfallExpectedCents = shortfallTurn
    ? sokoBotUsageCents(shortfallTurn.costUsdMicros ?? 0n)
    : 0n;
  const shortfallCents =
    shortfallExpectedCents > (shortfallUsage?.cents ?? 0n)
      ? shortfallExpectedCents - (shortfallUsage?.cents ?? 0n)
      : 0n;
  const organizationId = await sokoBotPayerOrganizationId(sokoBotId, prisma);
  const balance = await creditBucketRepository.getBalance(
    userId,
    organizationId,
    prisma,
  );
  if (balance < shortfallCents) {
    throw new SokoBotBillingAccessError(
      `Insufficient ${payerLabel(organizationId)} credits to cover the unpaid remainder from a prior Soko Bot turn.`,
    );
  }
  if (balance < minimumCents || balance < recentTurnCents) {
    throw new SokoBotBillingAccessError(
      `Insufficient ${payerLabel(organizationId)} credits to start a Soko Bot turn.`,
    );
  }
}

export async function recordSokoBotTurnUsage(
  input: {
    turnId: string;
    sokoBotId: string;
    userId: string;
    costUsdMicros: bigint | null;
    /** The turn spent tokens; bills the minimum when no cost was reported. */
    ranModel?: boolean;
  },
  tx: Prisma.TransactionClient,
): Promise<SokoBotUsageChargeResult> {
  const expectedCents = sokoBotUsageCents(
    input.costUsdMicros ?? 0n,
    input.ranModel,
  );
  if (expectedCents === 0n) {
    return { chargedCents: 0n, expectedCents, shortfall: false };
  }

  const idempotencyKey = sokoBotTurnUsageIdempotencyKey(input.turnId);
  const existing = await tx.sokoBotUsage.findUnique({
    where: {
      sokoBotId_idempotencyKey: {
        sokoBotId: input.sokoBotId,
        idempotencyKey,
      },
    },
    select: { cents: true },
  });
  if (existing) {
    return {
      chargedCents: existing.cents,
      expectedCents,
      shortfall: existing.cents < expectedCents,
    };
  }

  const organizationId = await sokoBotPayerOrganizationId(input.sokoBotId, tx);
  const balance = await creditBucketRepository.getBalance(
    input.userId,
    organizationId,
    tx,
  );
  const chargedCents = balance < expectedCents ? balance : expectedCents;
  if (chargedCents <= 0n) {
    return { chargedCents: 0n, expectedCents, shortfall: true };
  }
  const consumptions = await creditBucketRepository.prepareConsumption(
    input.userId,
    organizationId,
    chargedCents,
    tx,
  );
  const transaction = await tx.transaction.create({
    data: {
      amount: -chargedCents,
      userId: input.userId,
      organizationId,
      creditConsumptions: { createMany: { data: consumptions } },
    },
    select: { id: true },
  });
  await tx.sokoBotUsage.create({
    data: {
      sokoBotId: input.sokoBotId,
      userId: input.userId,
      organizationId,
      idempotencyKey,
      referenceId: input.turnId,
      cents: chargedCents,
      transactionId: transaction.id,
    },
  });
  return {
    chargedCents,
    expectedCents,
    shortfall: chargedCents < expectedCents,
  };
}
