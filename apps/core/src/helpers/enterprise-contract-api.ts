import {
  type EnterpriseContract,
  type EnterpriseContractPeriod,
  EnterpriseContractPeriodStatus,
  EnterpriseContractStatus,
} from "@sokosumi/database";
import type { PaidSubscriptionBlocker } from "@sokosumi/database/helpers";
import {
  deriveEnterpriseContractEndDate,
  resolveContractStartDate,
  validateEnterprisePeriodCount,
  validateMinEnterpriseCreditsPerMonth,
} from "@sokosumi/database/helpers";
import { convertCentsToCredits, convertCreditsToCents } from "@sokosumi/utils";

import { unprocessableEntity } from "@/helpers/error.js";

export function assertMinEnterpriseCreditsPerMonth(credits: number): void {
  try {
    validateMinEnterpriseCreditsPerMonth(credits);
  } catch (error) {
    throw unprocessableEntity(
      error instanceof Error ? error.message : "Invalid credits per month",
    );
  }
}

export function assertEnterprisePeriodCount(periodCount: number): void {
  try {
    validateEnterprisePeriodCount(periodCount);
  } catch (error) {
    throw unprocessableEntity(
      error instanceof Error ? error.message : "Invalid period count",
    );
  }
}

export function creditsPerMonthToCents(creditsPerMonth: number): bigint {
  assertMinEnterpriseCreditsPerMonth(creditsPerMonth);
  return convertCreditsToCents(creditsPerMonth);
}

export function optionalOneTimeCreditsToCents(
  oneTimeCredits: number | undefined,
): bigint | null {
  if (oneTimeCredits === undefined) {
    return null;
  }

  if (oneTimeCredits < 0) {
    throw unprocessableEntity("One-time credits must be zero or greater");
  }

  return convertCreditsToCents(oneTimeCredits);
}

export function mapEnterpriseContractPeriodForApi(
  period: EnterpriseContractPeriod,
) {
  return {
    id: period.id,
    createdAt: period.createdAt,
    updatedAt: period.updatedAt,
    periodStart: period.periodStart,
    periodEnd: period.periodEnd,
    creditsToGrant: convertCentsToCredits(period.centsToGrant),
    purchasedSeats: period.purchasedSeats,
    status: period.status,
  };
}

export function mapEnterpriseContractForApi(
  contract: EnterpriseContract & { periods?: EnterpriseContractPeriod[] },
) {
  const contractEnd =
    contract.startDate != null
      ? deriveEnterpriseContractEndDate(
          contract.startDate,
          contract.periodCount,
        )
      : null;

  return {
    id: contract.id,
    createdAt: contract.createdAt,
    updatedAt: contract.updatedAt,
    organizationId: contract.organizationId,
    status: contract.status,
    startDate: contract.startDate,
    periods: contract.periodCount,
    activatedAt: contract.activatedAt,
    canceledAt: contract.canceledAt,
    seats: contract.seats,
    creditsPerMonth: convertCentsToCredits(contract.centsPerMonth),
    oneTimeCredits:
      contract.oneTimeCents != null
        ? convertCentsToCredits(contract.oneTimeCents)
        : null,
    oneTimeExpiresAt: contract.oneTimeExpiresAt,
    paymentReference: contract.paymentReference,
    notes: contract.notes,
    externalReference: contract.externalReference,
    contractEnd,
    contractPeriods: contract.periods
      ?.toSorted(
        (left, right) =>
          left.periodStart.getTime() - right.periodStart.getTime(),
      )
      .map(mapEnterpriseContractPeriodForApi),
  };
}

export function mapEnterpriseContractActivationBlockerForApi(
  blocker: PaidSubscriptionBlocker,
) {
  return {
    subscriptionId: blocker.subscriptionId,
    stripeSubscriptionId: blocker.stripeSubscriptionId,
    referenceId: blocker.referenceId,
    plan: blocker.plan,
    scope: blocker.scope,
    userId: blocker.userId,
  };
}

export function mapEnterpriseContractPreviewPeriodForApi(period: {
  centsToGrant: bigint;
  periodEnd: Date;
  periodStart: Date;
  purchasedSeats: number;
}) {
  return {
    periodStart: period.periodStart,
    periodEnd: period.periodEnd,
    creditsToGrant: convertCentsToCredits(period.centsToGrant),
    purchasedSeats: period.purchasedSeats,
  };
}

export function derivePreviewContractEnd(params: {
  activatedAt: Date;
  periodCount: number;
  startDate?: Date | null;
}): Date {
  assertEnterprisePeriodCount(params.periodCount);
  const effectiveStart = resolveContractStartDate(
    params.startDate,
    params.activatedAt,
  );
  return deriveEnterpriseContractEndDate(effectiveStart, params.periodCount);
}

export const enterpriseContractStatusValues = [
  EnterpriseContractStatus.draft,
  EnterpriseContractStatus.active,
  EnterpriseContractStatus.completed,
  EnterpriseContractStatus.canceled,
] as const;

export const enterpriseContractPeriodStatusValues = [
  EnterpriseContractPeriodStatus.scheduled,
  EnterpriseContractPeriodStatus.active,
  EnterpriseContractPeriodStatus.expired,
  EnterpriseContractPeriodStatus.void,
] as const;
