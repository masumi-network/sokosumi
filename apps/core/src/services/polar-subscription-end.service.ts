import * as Sentry from "@sentry/node";
import type { Prisma } from "@sokosumi/database";
import { CMO_SOKO_BOT_VERSION_IDS } from "@sokosumi/soko-bot";
import { HTTPException } from "hono/http-exception";

import { revokePolarSubscription } from "@/clients/polar.client";
import { writeOffUnlessLiveCuso } from "@/helpers/cuso-project-credits";
import { serviceUnavailable } from "@/helpers/error";
import prisma from "@/lib/db/prisma";
import { serializableTransaction } from "@/lib/db/transaction";
import { emitCoreError, recordCoreWarning } from "@/lib/evlog";
import { LIVE_CUSO_WHERE } from "@/services/cmo-cuso.service";

/**
 * Ending a Cuso ends his CMO subscription (ADR 0068): Polar stops charging at
 * once, without a refund. Each ending path calls one of these before its
 * transaction, never inside it: that transaction is retried, and a retry
 * would call Polar again. The path's own permission check comes first.
 *
 * When Polar fails, the row is ended here all the same and marked owed a
 * revoke, which the Polar sync job retries (`retryOwedPolarRevokes`), so the
 * ending goes on. A deletion that takes the rows (`deletesRows`) would take
 * that mark too: it also revokes the rows owed one, and a failure ends
 * nothing. Either way an ending whose transaction then fails leaves a live
 * Cuso without a subscription, who is offered the checkout again.
 */
async function revokeSubscriptions(
  where: Prisma.PolarSubscriptionWhereInput,
  { deletesRows = false } = {},
): Promise<number> {
  const subscriptions = await prisma.polarSubscription.findMany({
    where: {
      ...(deletesRows
        ? { OR: [{ endedAt: null }, { revokeOwedAt: { not: null } }] }
        : { endedAt: null }),
      ...where,
    },
    select: { id: true, polarSubscriptionId: true },
  });
  for (const subscription of subscriptions) {
    try {
      await revokePolarSubscription(subscription.polarSubscriptionId);
    } catch (error) {
      // Polar without settings already says so with its own 503.
      if (error instanceof HTTPException) throw error;
      if (deletesRows) {
        Sentry.captureException(error, {
          tags: { error_type: "polar_subscription_revoke_failed" },
          extra: { polarSubscriptionId: subscription.polarSubscriptionId },
        });
        throw serviceUnavailable(
          "The subscription could not be ended. Nothing was changed. Try again later.",
          { reportToSentry: false },
        );
      }
      // Ending paths run in requests and in background work.
      recordCoreWarning(
        { operation: "polar_subscription_end" },
        {
          message:
            "Could not revoke a CMO subscription at Polar, so the revoke is owed to the sync job",
          why: "Polar refused or did not answer the revoke",
          fix: "Nothing to do now: the subscription is ended here, and the polar-yearly-grants sync retries the revoke.",
          cause: error,
        },
        // An array: one ending can owe several revokes on the same event.
        {
          polarRevokesOwed: [
            {
              subscriptionRowId: subscription.id,
              polarSubscriptionId: subscription.polarSubscriptionId,
            },
          ],
        },
      );
      const owedAt = new Date();
      await prisma.polarSubscription.updateMany({
        where: { id: subscription.id, endedAt: null },
        data: { endedAt: owedAt, revokeOwedAt: owedAt, revokeFailures: 1 },
      });
      continue;
    }
    // Recorded now, not on `subscription.revoked`: the Project is free for a
    // new subscription at once, and a late older payload cannot revive it.
    const endedAt = new Date();
    await prisma.polarSubscription.updateMany({
      where: { id: subscription.id, endedAt: null },
      data: { status: "canceled", endedAt, polarEventAt: endedAt },
    });
  }
  return subscriptions.length;
}

/** For a path that archives or deletes this bot; any bot but a live Cuso is left alone. */
export async function revokeCusoSubscription(sokoBotId: string): Promise<void> {
  await revokeSubscriptions({
    project: { sokoBots: { some: { id: sokoBotId, ...LIVE_CUSO_WHERE } } },
  });
}

/** For a version change: only a move to a version outside CMO ends Cuso. */
export async function revokeCusoSubscriptionIfLeavingCmo(
  sokoBotId: string,
  versionId: string,
): Promise<void> {
  if (CMO_SOKO_BOT_VERSION_IDS.includes(versionId)) return;
  await revokeCusoSubscription(sokoBotId);
}

/** For a Project close, which archives every bot of the Project. */
export async function revokeProjectCusoSubscription(
  projectId: string,
  workspaceId: string,
): Promise<void> {
  await revokeSubscriptions({ projectId, project: { workspaceId } });
}

/** For an organization deletion, which deletes every Project of it. */
export async function revokeOrganizationCusoSubscriptions(
  organizationId: string,
): Promise<void> {
  await revokeSubscriptions({ organizationId }, { deletesRows: true });
}

/**
 * After an ending's transaction: revokes a subscription the Project still
 * holds without a live Cuso. A first subscription webhook can create its row
 * after the ending's revoke above found none. It writes its row before it
 * checks the Cuso, and the ending archived him before this looks: whichever
 * of the two looks second sees the other, and revokes. The Cuso has ended by
 * now, so a failure is marked owed (inside `revokeSubscriptions`) or, without
 * Polar settings, swallowed, and not thrown; his Project's credits are
 * written off either way.
 */
export async function revokeSubscriptionsLeftByEnding(
  projectId: string | null,
): Promise<void> {
  if (!projectId) return;
  let left: number;
  try {
    left = await revokeSubscriptions({
      projectId,
      project: { sokoBots: { none: LIVE_CUSO_WHERE } },
    });
  } catch (error) {
    if (!(error instanceof HTTPException)) throw error;
    left = 1;
  }
  // Its first payment may have granted credits the ending's write-off did not
  // see: they go too, as the ending's would have.
  if (left > 0) {
    await serializableTransaction(
      (tx) => writeOffUnlessLiveCuso(projectId, tx),
      "The write-off raced another write to the same credits",
    );
  }
}

/** Failed revokes after which a person has to look at an owed one. */
const REVOKE_FAILURES_REPORTED = 6;

export interface OwedPolarRevokeRetryResult {
  errors: number;
  revoked: number;
  stoppedEarly: boolean;
}

/**
 * Revokes at Polar each subscription an ending could not (`revokeOwedAt`),
 * then clears its mark. One Polar has revoked already counts as revoked
 * (`revokePolarSubscription`). A revoke that keeps failing is reported once,
 * on the run its failures reach the limit; the job goes on retrying it.
 */
export async function retryOwedPolarRevokes(
  shouldContinue: () => boolean,
): Promise<OwedPolarRevokeRetryResult> {
  const owed = await prisma.polarSubscription.findMany({
    where: { revokeOwedAt: { not: null } },
    select: { id: true, polarSubscriptionId: true },
    // Least recently attempted first (a failure writes `updatedAt`): a revoke
    // that keeps failing slowly holds back no other.
    orderBy: { updatedAt: "asc" },
  });
  const result = { errors: 0, revoked: 0, stoppedEarly: false };
  for (const subscription of owed) {
    if (!shouldContinue()) {
      result.stoppedEarly = true;
      break;
    }
    try {
      await revokePolarSubscription(subscription.polarSubscriptionId);
    } catch (error) {
      result.errors += 1;
      const { revokeFailures } = await prisma.polarSubscription.update({
        where: { id: subscription.id },
        data: { revokeFailures: { increment: 1 } },
        select: { revokeFailures: true },
      });
      // The polar-yearly-grants cron, after its response.
      emitCoreError(
        {
          operation: "polar_owed_revoke_retry",
          polarSubscription: {
            subscriptionRowId: subscription.id,
            polarSubscriptionId: subscription.polarSubscriptionId,
            revokeFailures,
          },
        },
        {
          message: "Could not revoke a CMO subscription at Polar again",
          why: "Polar refused or did not answer the owed revoke",
          fix: `The next polar-yearly-grants sync retries it. Polar may go on charging; at ${REVOKE_FAILURES_REPORTED} failures Sentry reports it, and someone must revoke it in the Polar dashboard.`,
          cause: error,
        },
      );
      if (revokeFailures === REVOKE_FAILURES_REPORTED) {
        Sentry.captureMessage(
          "CMO subscription revoke still owed: Polar may go on charging",
          {
            level: "error",
            tags: { error_type: "polar_subscription_revoke_owed" },
            extra: {
              polarSubscriptionId: subscription.polarSubscriptionId,
              subscriptionRowId: subscription.id,
              revokeFailures,
              error: error instanceof Error ? error.message : String(error),
            },
          },
        );
      }
      continue;
    }
    const revokedAt = new Date();
    await prisma.polarSubscription.updateMany({
      where: { id: subscription.id, revokeOwedAt: { not: null } },
      data: {
        status: "canceled",
        polarEventAt: revokedAt,
        revokeOwedAt: null,
        revokeFailures: 0,
      },
    });
    result.revoked += 1;
  }
  return result;
}
