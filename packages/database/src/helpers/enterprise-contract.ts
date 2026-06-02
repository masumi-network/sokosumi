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

export function resolveContractStartDate(
  startDate: Date | null | undefined,
  activatedAt: Date,
): Date {
  return startDate ?? activatedAt;
}

function periodEndBeforeNextStart(nextPeriodStart: Date): Date {
  return new Date(nextPeriodStart.getTime() - 1);
}

export function deriveEnterpriseContractEndDate(
  startDate: Date,
  periodCount: number,
): Date {
  validateEnterprisePeriodCount(periodCount);

  let periodStart = startDate;

  for (let index = 1; index < periodCount; index++) {
    periodStart = getNextMonthlyPeriodEnd(periodStart, startDate);
  }

  const nextPeriodStart = getNextMonthlyPeriodEnd(periodStart, startDate);
  return periodEndBeforeNextStart(nextPeriodStart);
}

export function buildEnterpriseContractPeriodSchedule(params: {
  centsPerMonth: bigint;
  periodCount: number;
  purchasedSeats: number;
  startDate: Date;
}): EnterpriseContractPeriodDraft[] {
  if (
    !Number.isInteger(params.periodCount) ||
    params.periodCount < MIN_ENTERPRISE_PERIOD_COUNT
  ) {
    return [];
  }

  const periods: EnterpriseContractPeriodDraft[] = [];
  let periodStart = params.startDate;

  for (let index = 0; index < params.periodCount; index++) {
    const nextPeriodStart = getNextMonthlyPeriodEnd(
      periodStart,
      params.startDate,
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
  startDate?: Date | null;
}): EnterpriseContractPeriodDraft[] {
  const effectiveStart = resolveContractStartDate(
    params.startDate,
    params.activatedAt,
  );

  return buildEnterpriseContractPeriodSchedule({
    centsPerMonth: params.centsPerMonth,
    periodCount: params.periodCount,
    purchasedSeats: params.purchasedSeats,
    startDate: effectiveStart,
  });
}

export function isEnterpriseContractActive(params: {
  now?: Date;
  periodCount: number;
  startDate: Date;
  status: EnterpriseContractStatus;
}): boolean {
  if (params.status !== EnterpriseContractStatus.active) {
    return false;
  }

  if (
    !Number.isInteger(params.periodCount) ||
    params.periodCount < MIN_ENTERPRISE_PERIOD_COUNT
  ) {
    return false;
  }

  const now = params.now ?? new Date();
  const contractEnd = deriveEnterpriseContractEndDate(
    params.startDate,
    params.periodCount,
  );

  return (
    now.getTime() >= params.startDate.getTime() &&
    now.getTime() <= contractEnd.getTime()
  );
}
