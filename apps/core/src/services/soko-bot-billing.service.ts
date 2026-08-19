import type { Prisma } from "@sokosumi/database";
import { resolveOrganizationBillingPlan } from "@sokosumi/database/helpers";
import {
  creditBucketRepository,
  subscriptionRepository,
} from "@sokosumi/database/repositories";
import { convertCreditsToCents } from "@sokosumi/utils";

import { getEnv } from "@/config/env";
import prisma from "@/lib/db/prisma";

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

export async function requireSokoBotTurnFunding(userId: string): Promise<void> {
  if (!(await userHasSokoBotPaidCoverage(userId))) {
    throw new SokoBotBillingAccessError(
      "A paid subscription is required to use Soko Bot.",
    );
  }
  const minimumCents = convertCreditsToCents(
    getEnv().SOKO_BOT_MIN_TURN_CREDITS,
  );
  const balance = await creditBucketRepository.getBalance(userId, null, prisma);
  if (balance < minimumCents) {
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

  const idempotencyKey = `soko-bot-turn:${input.turnId}`;
  const existing = await tx.orchestratorUsage.findUnique({
    where: {
      orchestratorId_idempotencyKey: {
        orchestratorId: input.sokoBotId,
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
  await tx.orchestratorUsage.create({
    data: {
      orchestratorId: input.sokoBotId,
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
