import {
  type EnterpriseContract,
  type EnterpriseContractPeriod,
  EnterpriseContractPeriodStatus,
  EnterpriseContractStatus,
} from "@sokosumi/database";
import type { PaidSubscriptionBlocker } from "@sokosumi/database/helpers";
import {
  deriveEnterpriseContractEndDate,
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

export function parseEnterpriseContractActivatedAt(
  activatedAtRaw: string,
): Date {
  const activatedAt = new Date(activatedAtRaw);
  if (Number.isNaN(activatedAt.getTime())) {
    throw unprocessableEntity("activatedAt must be a valid ISO 8601 datetime");
  }

  return activatedAt;
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

export const enterpriseContractOrganizationSelect = {
  organization: {
    select: {
      slug: true,
    },
  },
} as const;

export function mapEnterpriseContractForApi(
  contract: EnterpriseContract & {
    periods?: EnterpriseContractPeriod[];
    organization: { slug: string };
  },
) {
  const endsAt =
    contract.activatedAt != null
      ? deriveEnterpriseContractEndDate(
          contract.activatedAt,
          contract.periodCount,
        )
      : null;

  return {
    id: contract.id,
    createdAt: contract.createdAt,
    updatedAt: contract.updatedAt,
    organizationSlug: contract.organization.slug,
    status: contract.status,
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
    endsAt,
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
    plan: blocker.plan,
    scope: blocker.scope,
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
}): Date {
  assertEnterprisePeriodCount(params.periodCount);
  return deriveEnterpriseContractEndDate(
    params.activatedAt,
    params.periodCount,
  );
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
