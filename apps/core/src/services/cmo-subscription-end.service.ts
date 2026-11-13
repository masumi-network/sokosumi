import * as Sentry from "@sentry/node";
import type { Prisma } from "@sokosumi/database";
import { CMO_SOKO_BOT_VERSION_IDS } from "@sokosumi/soko-bot";
import { HTTPException } from "hono/http-exception";

import { revokePolarSubscription } from "@/clients/polar.client";
import { serviceUnavailable } from "@/helpers/error";
import prisma from "@/lib/db/prisma";
import { LIVE_CUSO_WHERE } from "@/services/cmo-cuso.service";

/**
 * Ending a Cuso ends his CMO subscription (ADR 0068): Polar stops charging at
 * once, without a refund. Each ending path calls one of these before its
 * transaction, never inside it: that transaction is retried, and a retry
 * would call Polar again. The path's own permission check comes first.
 *
 * A failure throws, so the caller ends nothing. The reverse (revoked here,
 * the transaction then fails) leaves a live Cuso without a subscription, who
 * is offered the checkout again.
 */
async function revokeSubscriptions(
  where: Prisma.CmoSubscriptionWhereInput,
): Promise<void> {
  const subscriptions = await prisma.cmoSubscription.findMany({
    where: { endedAt: null, ...where },
    select: { id: true, polarSubscriptionId: true },
  });
  for (const subscription of subscriptions) {
    try {
      await revokePolarSubscription(subscription.polarSubscriptionId);
    } catch (error) {
      // Polar without settings already says so with its own 503.
      if (error instanceof HTTPException) throw error;
      Sentry.captureException(error, {
        tags: { error_type: "polar_subscription_revoke_failed" },
        extra: { polarSubscriptionId: subscription.polarSubscriptionId },
      });
      throw serviceUnavailable(
        "The subscription could not be ended. Nothing was changed. Try again later.",
        { reportToSentry: false },
      );
    }
    // Recorded now, not on `subscription.revoked`: the Project is free for a
    // new subscription at once, and a late older payload cannot revive it.
    const endedAt = new Date();
    await prisma.cmoSubscription.updateMany({
      where: { id: subscription.id, endedAt: null },
      data: { status: "canceled", endedAt, polarEventAt: endedAt },
    });
  }
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
