import { convertCreditsToCents } from "@sokosumi/utils";

import { EnterpriseContractStatus } from "../generated/prisma/client.js";
import { getNextMonthlyPeriodEnd } from "./subscription.js";

/** Minimum monthly credits for enterprise contracts (API validation; stored as cents). */
export const MIN_ENTERPRISE_CREDITS_PER_MONTH = 60_000;

/** Minimum number of monthly grant periods on a contract. */
export const MIN_ENTERPRISE_PERIOD_COUNT = 1;

/** Pre-create enterprise period buckets this far before `periodStart`. */
export const ENTERPRISE_CONTRACT_PRECREATE_LOOKAHEAD_MS = 24 * 60 * 60 * 1000;

export interface EnterpriseContractPeriodDraft {
  centsToGrant: bigint;
  periodEnd: Date;
  periodStart: Date;
  purchasedSeats: number;
}

export function validateMinEnterpriseCreditsPerMonth(credits: number): void {
  if (credits < MIN_ENTERPRISE_CREDITS_PER_MONTH) {
    throw new Error(
      `Enterprise contracts require at least ${MIN_ENTERPRISE_CREDITS_PER_MONTH} credits per month`,
    );
  }
}

export function validateEnterprisePeriodCount(periodCount: number): void {
  if (
    !Number.isInteger(periodCount) ||
    periodCount < MIN_ENTERPRISE_PERIOD_COUNT
  ) {
    throw new Error(
      `Enterprise contracts require at least ${MIN_ENTERPRISE_PERIOD_COUNT} period`,
    );
  }
}

export function minEnterpriseCentsPerMonth(): bigint {
  return convertCreditsToCents(MIN_ENTERPRISE_CREDITS_PER_MONTH);
}

function periodEndBeforeNextStart(nextPeriodStart: Date): Date {
  return new Date(nextPeriodStart.getTime() - 1);
}

export function deriveEnterpriseContractEndDate(
  activatedAt: Date,
  periodCount: number,
): Date {
  validateEnterprisePeriodCount(periodCount);

  let periodStart = activatedAt;

  for (let index = 1; index < periodCount; index++) {
    periodStart = getNextMonthlyPeriodEnd(periodStart, activatedAt);
  }

  const nextPeriodStart = getNextMonthlyPeriodEnd(periodStart, activatedAt);
  return periodEndBeforeNextStart(nextPeriodStart);
}

export function buildEnterpriseContractPeriodSchedule(params: {
  activatedAt: Date;
  centsPerMonth: bigint;
  periodCount: number;
  purchasedSeats: number;
}): EnterpriseContractPeriodDraft[] {
  if (
    !Number.isInteger(params.periodCount) ||
    params.periodCount < MIN_ENTERPRISE_PERIOD_COUNT
  ) {
    return [];
  }

  const periods: EnterpriseContractPeriodDraft[] = [];
  let periodStart = params.activatedAt;

  for (let index = 0; index < params.periodCount; index++) {
    const nextPeriodStart = getNextMonthlyPeriodEnd(
      periodStart,
      params.activatedAt,
    );

    periods.push({
      centsToGrant: params.centsPerMonth,
      periodEnd: periodEndBeforeNextStart(nextPeriodStart),
      periodStart,
      purchasedSeats: params.purchasedSeats,
    });

    periodStart = nextPeriodStart;
  }

  return periods;
}

export function previewEnterpriseContractPeriods(params: {
  activatedAt: Date;
  centsPerMonth: bigint;
  periodCount: number;
  purchasedSeats: number;
}): EnterpriseContractPeriodDraft[] {
  return buildEnterpriseContractPeriodSchedule({
    activatedAt: params.activatedAt,
    centsPerMonth: params.centsPerMonth,
    periodCount: params.periodCount,
    purchasedSeats: params.purchasedSeats,
  });
}

export function isEnterpriseContractPastCommercialTerm(params: {
  activatedAt: Date;
  now?: Date;
  periodCount: number;
}): boolean {
  if (
    !Number.isInteger(params.periodCount) ||
    params.periodCount < MIN_ENTERPRISE_PERIOD_COUNT
  ) {
    return true;
  }

  const now = params.now ?? new Date();
  const endsAt = deriveEnterpriseContractEndDate(
    params.activatedAt,
    params.periodCount,
  );

  return now.getTime() > endsAt.getTime();
}

export function isEnterpriseContractConsumable(params: {
  activatedAt: Date;
  now?: Date;
  periodCount: number;
  status: EnterpriseContractStatus;
}): boolean {
  if (params.status !== EnterpriseContractStatus.active) {
    return false;
  }

  const now = params.now ?? new Date();

  return !isEnterpriseContractPastCommercialTerm({
    activatedAt: params.activatedAt,
    now,
    periodCount: params.periodCount,
  });
}
