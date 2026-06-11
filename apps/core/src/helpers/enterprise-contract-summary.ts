import type { Prisma } from "@sokosumi/database";
import type { OrganizationBillingPlan } from "@sokosumi/database/helpers";
import {
  creditBucketRepository,
  enterpriseContractRepository,
} from "@sokosumi/database/repositories";
import { convertCentsToCredits } from "@sokosumi/utils";

export interface EnterpriseContractBillingSummary {
  activatedAt: Date;
  endsAt: Date;
  currentPeriodEnd: Date | null;
  isConsumable: boolean;
  monthlyCredits: number | null;
  nextActivationAt: Date | null;
  poolRemainingCredits: number;
  purchasedSeats: number;
}

interface EnterprisePoolBalances {
  remainingCents: bigint;
}

export function buildEnterpriseContractBillingSummaryFallback(
  billingPlan: Extract<
    OrganizationBillingPlan,
    { mode: "enterprise_contract" }
  >,
  poolBalances: EnterprisePoolBalances,
): EnterpriseContractBillingSummary {
  return {
    activatedAt: billingPlan.activatedAt,
    endsAt: billingPlan.endsAt,
    currentPeriodEnd: null,
    isConsumable: billingPlan.isConsumable,
    monthlyCredits: null,
    nextActivationAt: null,
    poolRemainingCredits: convertCentsToCredits(poolBalances.remainingCents),
    purchasedSeats: billingPlan.purchasedSeats,
  };
}

interface EnterpriseContractPeriodWindow {
  periodEnd: Date;
  periodStart: Date;
}

export function resolveCurrentEnterprisePeriodEnd(
  periods: EnterpriseContractPeriodWindow[],
  now: Date,
): Date | null {
  const currentPeriod = periods.find(
    (period) => period.periodStart <= now && now <= period.periodEnd,
  );

  return currentPeriod?.periodEnd ?? null;
}

export function resolveNextEnterpriseActivationAt(
  periods: EnterpriseContractPeriodWindow[],
  now: Date,
): Date | null {
  const upcomingPeriods = periods
    .filter((period) => period.periodStart > now)
    .toSorted(
      (left, right) => left.periodStart.getTime() - right.periodStart.getTime(),
    );

  return upcomingPeriods[0]?.periodStart ?? null;
}

export function resolveEnterprisePeriodEndForDisplay(
  periods: EnterpriseContractPeriodWindow[],
  now: Date,
  isConsumable: boolean,
): Date | null {
  const currentPeriodEnd = resolveCurrentEnterprisePeriodEnd(periods, now);
  if (currentPeriodEnd) {
    return currentPeriodEnd;
  }

  if (!isConsumable && periods.length > 0) {
    return periods.at(-1)?.periodEnd ?? null;
  }

  return null;
}

export async function getEnterpriseContractBillingSummary(
  billingPlan: Extract<
    OrganizationBillingPlan,
    { mode: "enterprise_contract" }
  >,
  organizationId: string,
  tx: Prisma.TransactionClient,
  now: Date = new Date(),
): Promise<EnterpriseContractBillingSummary> {
  const [contract, poolBalances] = await Promise.all([
    enterpriseContractRepository.getContractWithPeriods(
      billingPlan.contractId,
      tx,
    ),
    creditBucketRepository.sumOrganizationEnterprisePoolBalances(
      organizationId,
      tx,
      now,
    ),
  ]);

  if (!contract || contract.organizationId !== organizationId) {
    return buildEnterpriseContractBillingSummaryFallback(
      billingPlan,
      poolBalances,
    );
  }

  const periodWindows = contract.periods.map((period) => ({
    periodEnd: period.periodEnd,
    periodStart: period.periodStart,
  }));

  return {
    activatedAt: billingPlan.activatedAt,
    endsAt: billingPlan.endsAt,
    currentPeriodEnd: resolveEnterprisePeriodEndForDisplay(
      periodWindows,
      now,
      billingPlan.isConsumable,
    ),
    isConsumable: billingPlan.isConsumable,
    monthlyCredits: convertCentsToCredits(contract.centsPerMonth),
    nextActivationAt: resolveNextEnterpriseActivationAt(periodWindows, now),
    poolRemainingCredits: convertCentsToCredits(poolBalances.remainingCents),
    purchasedSeats: billingPlan.purchasedSeats,
  };
}
