import type { Prisma } from "@sokosumi/database";
import { resolveOrganizationBillingPlan } from "@sokosumi/database/helpers";
import {
  creditBucketRepository,
  subscriptionRepository,
} from "@sokosumi/database/repositories";
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

function hasAdminRole(role: string | null | undefined): boolean {
  return (
    role?.split(",").some((value) => value.trim().toLowerCase() === "admin") ??
    false
  );
}

function sokoBotTurnUsageIdempotencyKey(turnId: string): string {
  return `soko-bot-turn:${turnId}`;
}

export function sokoBotUsageCents(costUsdMicros: bigint): bigint {
  if (costUsdMicros <= 0n) return 0n;
  const env = getEnv();
  const costUsd = Number(costUsdMicros) / 1_000_000;
  const meteredCredits = costUsd * env.SOKO_BOT_CREDITS_PER_USD;
  return convertCreditsToCents(
    Math.max(meteredCredits, env.SOKO_BOT_MIN_TURN_CREDITS),
  );
}

export async function userHasSokoBotPaidCoverage(
  userId: string,
): Promise<boolean> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { role: true },
  });
  if (hasAdminRole(user?.role)) return true;

  const personal =
    await subscriptionRepository.resolveActiveSubscriptionByReferenceId(
      userId,
      prisma,
    );
  if (personal && personal.plan !== "free") return true;

  const memberships = await prisma.member.findMany({
    where: { userId },
    select: { organizationId: true },
  });
  for (const membership of memberships) {
    const billingPlan = await resolveOrganizationBillingPlan(
      membership.organizationId,
      prisma,
    );
    if (
      billingPlan.mode === "enterprise_contract" &&
      billingPlan.isConsumable
    ) {
      return true;
    }
    if (billingPlan.mode === "self_serve" && billingPlan.plan !== "free") {
      return true;
    }
  }
  return false;
}

export async function requireSokoBotTurnFunding(
  userId: string,
  sokoBotId: string,
): Promise<void> {
  if (!(await userHasSokoBotPaidCoverage(userId))) {
    throw new SokoBotBillingAccessError(
      "A paid subscription is required to use Soko Bot.",
    );
  }

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
  const balance = await creditBucketRepository.getBalance(userId, null, prisma);
  if (balance < shortfallCents) {
    throw new SokoBotBillingAccessError(
      "Insufficient personal credits to cover the unpaid remainder from a prior Soko Bot turn.",
    );
  }
  if (balance < minimumCents || balance < recentTurnCents) {
    throw new SokoBotBillingAccessError(
      "Insufficient personal credits to start a Soko Bot turn.",
    );
  }
}

export async function recordSokoBotTurnUsage(
  input: {
    turnId: string;
    sokoBotId: string;
    userId: string;
    costUsdMicros: bigint | null;
  },
  tx: Prisma.TransactionClient,
): Promise<SokoBotUsageChargeResult> {
  const expectedCents = sokoBotUsageCents(input.costUsdMicros ?? 0n);
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

  const balance = await creditBucketRepository.getBalance(
    input.userId,
    null,
    tx,
  );
  const chargedCents = balance < expectedCents ? balance : expectedCents;
  if (chargedCents <= 0n) {
    return { chargedCents: 0n, expectedCents, shortfall: true };
  }
  const consumptions = await creditBucketRepository.prepareConsumption(
    input.userId,
    null,
    chargedCents,
    tx,
  );
  const transaction = await tx.transaction.create({
    data: {
      amount: -chargedCents,
      userId: input.userId,
      organizationId: null,
      creditConsumptions: { createMany: { data: consumptions } },
    },
    select: { id: true },
  });
  await tx.sokoBotUsage.create({
    data: {
      sokoBotId: input.sokoBotId,
      userId: input.userId,
      organizationId: null,
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
