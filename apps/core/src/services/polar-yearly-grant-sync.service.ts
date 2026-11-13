import * as Sentry from "@sentry/node";
import { CreditBucketReferenceType } from "@sokosumi/database";
import { getNextMonthlyPeriodEnd } from "@sokosumi/database/helpers";
import { convertCreditsToCents } from "@sokosumi/utils";

import prisma from "@/lib/db/prisma";
import { getCmoCatalog } from "@/services/cmo-catalog.service";
import { grantPolarCredits } from "@/services/polar-credit-grant.service";

/**
 * A yearly CMO plan is paid once a year and granted month by month (ADR 0068).
 * The paid order grants month 0; this job grants months 1 to 11.
 */

const LOG_PREFIX = "[sync/polar-yearly-grants]";

/** The last month a yearly order pays for. */
const LAST_MONTH_INDEX = 11;

export interface PolarYearlyGrantSyncResult {
  errors: number;
  granted: number;
  stoppedEarly: boolean;
}

/** The month of the paid year that `now` falls in, when it starts and ends. */
export function monthOfPaidYear(
  periodStart: Date,
  now: Date,
): { expiresAt: Date; index: number; startsAt: Date } {
  let index = 0;
  let startsAt = periodStart;
  let expiresAt = getNextMonthlyPeriodEnd(periodStart, periodStart);
  while (expiresAt <= now && index < LAST_MONTH_INDEX) {
    index += 1;
    startsAt = expiresAt;
    expiresAt = getNextMonthlyPeriodEnd(expiresAt, periodStart);
  }
  return { expiresAt, index, startsAt };
}

/**
 * The started months of a paid year after month 0 (which came with the paid
 * order), each with its bucket key and expiry. A missed month is granted
 * late, never already expired.
 */
function startedMonths(
  periodStart: Date,
  paidOrderId: string,
  now: Date,
): { expiresAt: Date; referenceId: string }[] {
  const lateExpiry = getNextMonthlyPeriodEnd(now, now);
  const current = monthOfPaidYear(periodStart, now);
  const months = [];
  let expiresAt = getNextMonthlyPeriodEnd(periodStart, periodStart);
  for (let index = 1; index <= current.index; index += 1) {
    expiresAt = getNextMonthlyPeriodEnd(expiresAt, periodStart);
    months.push({
      expiresAt: expiresAt > now ? expiresAt : lateExpiry,
      referenceId: `${paidOrderId}:${index}`,
    });
  }
  return months;
}

/**
 * Grants a yearly subscription's started months it lacks, at the tier it is
 * on now. An upgrade calls it before it changes the tier: a month that began
 * on the old tier gets the old tier's credits and the upgrade's order adds
 * the prorated rest, where this job would grant the whole month at the new
 * tier. A month granted already ends on the bucket's unique key.
 */
export async function grantStartedPolarYearlyMonths(
  subscription: {
    id: string;
    projectId: string;
    organizationId: string;
    currentPeriodStart: Date;
    lastPaidOrderId: string;
  },
  plan: { credits: number; name: string },
): Promise<void> {
  const paidOrderId = subscription.lastPaidOrderId;
  for (const month of startedMonths(
    subscription.currentPeriodStart,
    paidOrderId,
    new Date(),
  )) {
    await grantPolarCredits({
      amount: convertCreditsToCents(plan.credits),
      expiresAt: month.expiresAt,
      organizationId: subscription.organizationId,
      projectId: subscription.projectId,
      referenceId: month.referenceId,
      referenceNote: plan.name,
      referenceType: CreditBucketReferenceType.POLAR_SUBSCRIPTION_MONTH,
      subscription: { subscriptionRowId: subscription.id, paidOrderId },
    });
  }
}

/**
 * Grants each active yearly CMO subscription every started month of its paid
 * year it does not have yet, so a month a run missed is granted by the next
 * (a subscriber never loses a paid month). A month whose own end has passed
 * expires one month from its grant instead. The grant rides on the bucket's
 * unique key (last paid order id and month index), so a repeated or raced
 * run ends there.
 */
export async function syncPolarYearlyGrants(
  shouldContinue: () => boolean,
): Promise<PolarYearlyGrantSyncResult> {
  const now = new Date();
  // Past due and ended subscriptions are not `active`; one with a scheduled
  // cancel is, until its paid year ends.
  const subscriptions = await prisma.polarSubscription.findMany({
    where: {
      interval: "year",
      status: "active",
      endedAt: null,
      lastPaidOrderId: { not: null },
      lastPaidOrderRefundedAt: null,
      currentPeriodEnd: { gt: now },
    },
    select: {
      id: true,
      projectId: true,
      organizationId: true,
      polarProductId: true,
      currentPeriodStart: true,
      lastPaidOrderId: true,
    },
  });
  const due = subscriptions.flatMap((subscription) => {
    const { lastPaidOrderId: paidOrderId, projectId } = subscription;
    if (!paidOrderId || !projectId) return [];
    return startedMonths(subscription.currentPeriodStart, paidOrderId, now).map(
      (month) => ({ ...subscription, ...month, paidOrderId, projectId }),
    );
  });
  const result = { errors: 0, granted: 0, stoppedEarly: false };
  if (due.length === 0) return result;

  const referenceType = CreditBucketReferenceType.POLAR_SUBSCRIPTION_MONTH;
  const granted = new Set(
    (
      await prisma.creditBucket.findMany({
        where: {
          referenceType,
          referenceId: { in: due.map((grant) => grant.referenceId) },
        },
        select: { referenceId: true },
      })
    ).map((bucket) => bucket.referenceId),
  );
  const missing = due.filter((grant) => !granted.has(grant.referenceId));
  if (missing.length === 0) return result;

  const { plans } = await getCmoCatalog();
  for (const grant of missing) {
    if (!shouldContinue()) {
      result.stoppedEarly = true;
      break;
    }
    // The amount is the tier the subscription is on now, not the one paid for.
    const plan = plans.find((plan) => plan.productId === grant.polarProductId);
    if (!plan) {
      Sentry.captureMessage("CMO yearly grant skipped: unknown plan product", {
        level: "error",
        tags: { error_type: "polar_yearly_grant_skipped" },
        extra: {
          subscriptionRowId: grant.id,
          polarProductId: grant.polarProductId,
        },
      });
      result.errors += 1;
      continue;
    }
    try {
      const granted = await grantPolarCredits({
        amount: convertCreditsToCents(plan.credits),
        expiresAt: grant.expiresAt,
        organizationId: grant.organizationId,
        projectId: grant.projectId,
        referenceId: grant.referenceId,
        referenceNote: plan.name,
        referenceType,
        subscription: {
          subscriptionRowId: grant.id,
          paidOrderId: grant.paidOrderId,
        },
      });
      // Otherwise granted by a concurrent run, or the subscription ended
      // or its order was refunded since it was read.
      if (granted === "granted") result.granted += 1;
    } catch (error) {
      result.errors += 1;
      console.error(
        `${LOG_PREFIX} Failed to grant ${grant.referenceId} to CMO subscription ${grant.id}:`,
        error,
      );
    }
  }
  return result;
}
