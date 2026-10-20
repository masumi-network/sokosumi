import type { Prisma } from "@sokosumi/database";
import { creditBucketRepository } from "@sokosumi/database/repositories";
import { convertCreditsToCents } from "@sokosumi/utils";
import { getEnv } from "@/config/env";
import { isPersonalSokoBot, isSharedSokoBot } from "@/helpers/soko-bot-kind";
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

export interface SokoBotPayer {
  /** Personal owner; null for a shared bot, which only the organization pays for. */
  userId: string | null;
  organizationId: string | null;
}

/**
 * Bots in an organization workspace bill the organization, like its Tasks.
 * A member's turn spends through that member, whose Seat gates it; a turn
 * nobody asked for draws on the pool with no Seat check (ADR 0057).
 */
async function sokoBotPayer(
  sokoBotId: string,
  client: Pick<Prisma.TransactionClient, "sokoBot">,
): Promise<SokoBotPayer | null> {
  const bot = await client.sokoBot.findUnique({
    where: { id: sokoBotId },
    select: { userId: true, workspace: { select: { organizationId: true } } },
  });
  return bot
    ? { userId: bot.userId, organizationId: bot.workspace.organizationId }
    : null;
}

/** A shared bot's payer is its organization alone, whoever asked. */
export function sokoBotPayerKey(payer: SokoBotPayer): string {
  return isPersonalSokoBot(payer)
    ? `${payer.userId}:${payer.organizationId ?? ""}`
    : `org:${payer.organizationId ?? ""}`;
}

/**
 * A shared bot has no member to read through, so it reads the pool without
 * a seat check. That answers "is the pool empty?" for the notice only.
 */
async function sokoBotPayerBalance(payer: SokoBotPayer): Promise<bigint> {
  if (isPersonalSokoBot(payer)) {
    return await creditBucketRepository.getBalance(
      payer.userId,
      payer.organizationId,
      prisma,
    );
  }
  if (payer.organizationId === null) return 0n;
  return await creditBucketRepository.getOrganizationPoolBalance(
    payer.organizationId,
    prisma,
  );
}

function payerLabel(organizationId: string | null): string {
  return organizationId ? "organization" : "personal";
}

/**
 * Tells the owner once a day that self-started turns stopped for credits.
 * A shared bot's refusal can be the attributed member's missing seat while the
 * pool still has credits; that is not "out of credits", so it stays silent.
 */
export async function notifySokoBotOutOfCredits(
  sokoBotId: string,
  now: Date = new Date(),
): Promise<void> {
  const bot = await prisma.sokoBot.findUnique({
    where: { id: sokoBotId },
    select: {
      userId: true,
      workspace: {
        select: {
          organizationId: true,
          organization: { select: { name: true } },
        },
      },
    },
  });
  if (!bot) return;
  const payer: SokoBotPayer = {
    userId: bot.userId,
    organizationId: bot.workspace.organizationId,
  };
  if (isSharedSokoBot(payer)) {
    const outOfCredits = await sokoBotIdsOutOfCredits([
      { id: sokoBotId, ...payer },
    ]);
    if (!outOfCredits.has(sokoBotId)) return;
  }
  const payerName = bot.workspace.organization?.name;
  const { postSokoBotOwnerNotice } = await import(
    "@/services/soko-bot-chat.service"
  );
  await postSokoBotOwnerNotice({
    sokoBotId,
    content: payerName
      ? `I'm paused: ${payerName} is out of credits.`
      : "I'm paused: you're out of credits.",
    key: `out-of-credits:${sokoBotId}:${now.toISOString().slice(0, 10)}`,
  });
}

/** Ids of the bots whose payer cannot fund even a minimum turn right now. */
export async function sokoBotIdsOutOfCredits(
  bots: (SokoBotPayer & { id: string })[],
): Promise<Set<string>> {
  const minimumCents = convertCreditsToCents(
    getEnv().SOKO_BOT_MIN_TURN_CREDITS,
  );
  const payers = [
    ...new Map(bots.map((bot) => [sokoBotPayerKey(bot), bot])).values(),
  ];
  const balances = new Map(
    await Promise.all(
      payers.map(
        async (bot) =>
          [sokoBotPayerKey(bot), await sokoBotPayerBalance(bot)] as const,
      ),
    ),
  );
  return new Set(
    bots
      .filter(
        (bot) => (balances.get(sokoBotPayerKey(bot)) ?? 0n) < minimumCents,
      )
      .map((bot) => bot.id),
  );
}

/**
 * `userId` is the member the turn runs as: their balance view (and so their
 * Seat) gates the turn. Null reads the Organization pool with no Seat. A
 * shared bot's cost history is bot-wide, because the
 * organization pays every member's turns.
 */
export async function requireSokoBotTurnFunding(
  /** Null: a shared bot acting on its own, paid by the Organization pool. */
  userId: string | null,
  sokoBotId: string,
): Promise<void> {
  const payer = await sokoBotPayer(sokoBotId, prisma);
  const shared = payer !== null && isSharedSokoBot(payer);
  // Turns record the Requester; usage records the member who paid.
  const historyMember = shared ? {} : { requestedByUserId: userId };
  const usageMember = shared ? {} : { userId };
  const [completedTurns, shortfallTurn] = await Promise.all([
    prisma.sokoBotTurn.findMany({
      where: {
        sokoBotId,
        ...historyMember,
        status: "COMPLETED",
        // A six-hour background run costs what a hundred chat turns do; as
        // the yardstick it paused the bot with credits left.
        parentTurnId: null,
      },
      select: { id: true },
      orderBy: { completedAt: "desc" },
      take: SOKO_BOT_TURN_COST_HISTORY_SIZE,
    }),
    prisma.sokoBotTurn.findFirst({
      where: {
        sokoBotId,
        ...historyMember,
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
            ...usageMember,
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
  const organizationId = payer?.organizationId ?? null;
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
    /** Null: a shared bot acting on its own, paid by the Organization pool. */
    userId: string | null;
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

  const organizationId =
    (await sokoBotPayer(input.sokoBotId, tx))?.organizationId ?? null;
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
