import * as Sentry from "@sentry/node";
import { NotificationKind } from "@sokosumi/database";
import { creditBucketActivatesAtOrBefore } from "@sokosumi/database/helpers";
import {
  BILLING_CUSO_LOW_CREDITS_MESSAGE_KEY,
  convertCentsToCredits,
  convertCreditsToCents,
} from "@sokosumi/utils";

import { getEnv } from "@/config/env";
import { sendCusoLowCreditsEmail } from "@/helpers/billing-notification-email";
import { createNotification } from "@/helpers/notifications";
import prisma from "@/lib/db/prisma";
import { getCmoCatalog } from "@/services/cmo-catalog.service";
import {
  cmoBusinessNameFromUrl,
  cmoRunnerUserId,
  LIVE_CUSO_WHERE,
} from "@/services/cmo-cuso.service";
import { monthOfPaidYear } from "@/services/polar-yearly-grant-sync.service";

/** Without a CMO plan (Tester credits), a Cuso is low under this many credits. */
const CUSO_LOW_CREDITS_WITHOUT_PLAN = 1_000;

/** With a CMO plan, a Cuso is low under this share of the plan's month. */
const CUSO_LOW_CREDITS_SHARE_OF_PLAN = 0.1;

interface CusoSubscription {
  polarProductId: string;
  interval: string;
  status: string;
  currentPeriodStart: Date;
  currentPeriodEnd: Date;
  cancelAtPeriodEnd: boolean;
  lastPaidOrderRefundedAt: Date | null;
}

/**
 * Tell the person who hired a Cuso that his Project credits are running low,
 * once per crossing (SOKD-246). A hirer who left the business is not told;
 * its owner or admin his runs act as is (`cmoRunnerUserId`).
 *
 * The Organization pool's notice (`notifyLowBalanceAfterCharge`) mirrored for
 * a Cuso: called after a charge commits, best-effort, and throttled by the
 * notification table's uniqueness on the newest Project bucket, so a plan
 * month or a Project top-up is the next crossing and further charges below
 * the threshold write nothing. Only his Project credits count (plan month,
 * Project top-ups, Tester credits), never the pool. The link opens CMO's
 * top-up and plan screen. A Cuso in free hiring is never charged, so this is
 * never called for him.
 */
export async function notifyCusoLowCreditsAfterCharge(
  projectId: string,
  now: Date = new Date(),
): Promise<void> {
  try {
    const cuso = await prisma.sokoBot.findFirst({
      where: { ...LIVE_CUSO_WHERE, projectId },
      select: {
        id: true,
        workspaceId: true,
        name: true,
        workspace: { select: { organizationId: true } },
        project: { select: { websiteUrl: true } },
      },
    });
    if (!cuso) return;
    const recipient = await cmoRunnerUserId({
      sokoBotId: cuso.id,
      workspaceId: cuso.workspaceId,
    });
    if (!recipient) return;

    const [buckets, subscription] = await Promise.all([
      // Expired buckets too: the newest funding keys the crossing, and an
      // expiry is not new funding. Only unexpired ones count to the balance.
      prisma.creditBucket.findMany({
        where: {
          AND: [{ projectId }, creditBucketActivatesAtOrBefore(now)],
        },
        select: {
          id: true,
          createdAt: true,
          expiresAt: true,
          amount: true,
          consumptions: { select: { amount: true } },
        },
      }),
      prisma.polarSubscription.findFirst({
        where: { projectId, endedAt: null },
        select: {
          polarProductId: true,
          interval: true,
          status: true,
          currentPeriodStart: true,
          currentPeriodEnd: true,
          cancelAtPeriodEnd: true,
          lastPaidOrderRefundedAt: true,
        },
      }),
    ]);

    const balance = buckets
      .filter(({ expiresAt }) => expiresAt === null || expiresAt > now)
      .reduce(
        (sum, bucket) =>
          sum +
          bucket.amount -
          bucket.consumptions.reduce((spent, c) => spent + c.amount, 0n),
        0n,
      );
    if (balance >= convertCreditsToCents(await thresholdCredits(subscription)))
      return;

    const [newest] = [...buckets].sort(
      (a, b) =>
        b.createdAt.getTime() - a.createdAt.getTime() ||
        b.id.localeCompare(a.id),
    );
    const credits = Math.max(0, Math.floor(convertCentsToCredits(balance)));
    const cusoName = cuso.name?.trim() || "Cuso";
    const businessName = cmoBusinessNameFromUrl(cuso.project?.websiteUrl ?? "");
    const nextGrantAt = nextPlanGrantAt(subscription, now);
    const url = `${getEnv().CMO_APP_BASE_URL.replace(/\/+$/, "")}/settings?project=${encodeURIComponent(projectId)}`;

    const { created } = await createNotification({
      userId: recipient,
      kind: NotificationKind.BILLING,
      referenceId: projectId,
      eventId: `cuso-low-credits:${newest?.id ?? "none"}`,
      messageKey: BILLING_CUSO_LOW_CREDITS_MESSAGE_KEY,
      messageParams: {
        cusoName,
        businessName,
        credits,
        nextGrantAt: nextGrantAt?.toISOString() ?? null,
      },
      metadata: {
        organizationId: cuso.workspace.organizationId,
        projectId,
        url,
      },
    });

    // A duplicate row is the throttle, as for the pool's notice.
    if (created) {
      await sendCusoLowCreditsEmail({
        userId: recipient,
        cusoName,
        businessName,
        credits,
        nextGrantAt,
        actionUrl: url,
      });
    }
  } catch (error) {
    Sentry.captureException(error, {
      extra: { projectId, notificationType: "cuso-low-credits" },
    });
  }
}

/**
 * A tenth of the plan's monthly credits; the pool's own threshold is an
 * absolute 100 credits, too few for a Cuso's month. 1,000 without a plan, or
 * when the catalog does not know his product.
 */
async function thresholdCredits(
  subscription: CusoSubscription | null,
): Promise<number> {
  if (!subscription) return CUSO_LOW_CREDITS_WITHOUT_PLAN;
  const plan = (await getCmoCatalog()).plans.find(
    ({ productId }) => productId === subscription.polarProductId,
  );
  return plan
    ? plan.credits * CUSO_LOW_CREDITS_SHARE_OF_PLAN
    : CUSO_LOW_CREDITS_WITHOUT_PLAN;
}

/**
 * When his plan grants its next month: the renewal for a monthly plan, the
 * next month of the paid year for a yearly one, or its renewal once the paid
 * order was refunded (the yearly sync grants it no more months). None for a
 * plan that is not active or ends before then.
 */
function nextPlanGrantAt(
  subscription: CusoSubscription | null,
  now: Date,
): Date | null {
  if (subscription?.status !== "active") return null;
  const next =
    subscription.interval === "year" && !subscription.lastPaidOrderRefundedAt
      ? monthOfPaidYear(subscription.currentPeriodStart, now).expiresAt
      : subscription.currentPeriodEnd;
  if (subscription.cancelAtPeriodEnd && next >= subscription.currentPeriodEnd)
    return null;
  return next;
}
