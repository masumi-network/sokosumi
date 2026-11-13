import * as Sentry from "@sentry/node";
import { CreditBucketReferenceType } from "@sokosumi/database";
import { getNextMonthlyPeriodEnd } from "@sokosumi/database/helpers";
import { convertCreditsToCents } from "@sokosumi/utils";

import prisma from "@/lib/db/prisma";
import { getCmoCatalog } from "@/services/cmo-catalog.service";
import { grantCmoCredits } from "@/services/cmo-credit-grant.service";

/**
 * A yearly CMO plan is paid once a year and granted month by month (ADR 0068).
 * The paid order grants month 0; this job grants months 1 to 11.
 */

const LOG_PREFIX = "[sync/cmo-yearly-grants]";

/** The last month a yearly order pays for. */
const LAST_MONTH_INDEX = 11;

export interface CmoYearlyGrantSyncResult {
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
 * Grants the running month to each active yearly CMO subscription that does
 * not have it yet. A month that passed without a run is not granted later: it
 * would have expired already. The grant rides on the bucket's unique key
 * (last paid order id and month index), so a repeated or raced run ends there.
 */
export async function syncCmoYearlyGrants(
  shouldContinue: () => boolean,
): Promise<CmoYearlyGrantSyncResult> {
  const now = new Date();
  // Past due and ended subscriptions are not `active`; one with a scheduled
  // cancel is, until its paid year ends.
  const subscriptions = await prisma.cmoSubscription.findMany({
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
    const month = monthOfPaidYear(subscription.currentPeriodStart, now);
    const paidOrderId = subscription.lastPaidOrderId;
    // Month 0 came with the paid order.
    if (month.index === 0 || !paidOrderId) return [];
    const referenceId = `${paidOrderId}:${month.index}`;
    return [
      { ...subscription, expiresAt: month.expiresAt, paidOrderId, referenceId },
    ];
  });
  const result = { errors: 0, granted: 0, stoppedEarly: false };
  if (due.length === 0) return result;

  const referenceType = CreditBucketReferenceType.CMO_SUBSCRIPTION_MONTH;
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
        tags: { error_type: "cmo_yearly_grant_skipped" },
        extra: {
          cmoSubscriptionId: grant.id,
          polarProductId: grant.polarProductId,
        },
      });
      result.errors += 1;
      continue;
    }
    try {
      const granted = await grantCmoCredits({
        amount: convertCreditsToCents(plan.credits),
        expiresAt: grant.expiresAt,
        organizationId: grant.organizationId,
        projectId: grant.projectId,
        referenceId: grant.referenceId,
        referenceNote: plan.name,
        referenceType,
        subscription: {
          cmoSubscriptionId: grant.id,
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
