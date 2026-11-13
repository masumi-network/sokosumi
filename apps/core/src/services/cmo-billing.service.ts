import { CreditBucketReferenceType } from "@sokosumi/database";
import { cmoMayExecute, getSokoBotVersion } from "@sokosumi/soko-bot";
import prisma from "@/lib/db/prisma";
import { getCmoCatalog } from "@/services/cmo-catalog.service";
import {
  CmoForbiddenError,
  type Cuso,
  cmoPayer,
  findCusoForBot,
  LIVE_CUSO_WHERE,
} from "@/services/cmo-cuso.service";
import {
  approvedMarketingStrategy,
  mayApproveMarketingStrategy,
} from "@/services/marketing-strategy.service";

/**
 * CMO has no billing yet: every Cuso works on his organization's credits once
 * the strategy is approved. CMO's own checkout replaces this later.
 */
export async function isCmoSubscribed(
  _cuso: Pick<Cuso, "workspaceId">,
): Promise<boolean> {
  return true;
}

/** What every hire brings his organization, so he can research and plan. */
export const CMO_STARTER_CREDITS = 10_000;

/** Names the grant after the hire's Project, so each hire gets it once. */
function starterCreditsNote(projectId: string): string {
  return `CMO.xyz starter credits (project ${projectId})`;
}

/** A Cuso's CMO plan, as his Project's subscription that has not ended says. */
export interface CmoBilling {
  tier: string | null;
  interval: "month" | "year" | null;
  /** Polar's subscription status, as sent. */
  status: string | null;
  periodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
  /** The tier a scheduled downgrade moves to at the next period. */
  pendingTier: string | null;
  /**
   * Hired before CMO plans (ADR 0068): his Project was granted Starter
   * credits, spent or not, so his hiring ends without a checkout.
   */
  hiredWithStarterCredits: boolean;
}

/** The tier of a plan product; null when Polar's catalog does not answer. */
async function cmoPlanTier(productId: string): Promise<string | null> {
  const catalog = await getCmoCatalog().catch((error) => {
    console.warn("CMO catalog not read", {
      error: error instanceof Error ? error.message : "unknown",
    });
    return null;
  });
  return (
    catalog?.plans.find((plan) => plan.productId === productId)?.tier ?? null
  );
}

export async function readCmoBilling(projectId: string): Promise<CmoBilling> {
  const [subscription, starter] = await Promise.all([
    prisma.cmoSubscription.findFirst({
      where: { projectId, endedAt: null },
      select: {
        tier: true,
        interval: true,
        status: true,
        currentPeriodEnd: true,
        cancelAtPeriodEnd: true,
        pendingPolarProductId: true,
      },
    }),
    prisma.creditBucket.findFirst({
      where: {
        referenceType: CreditBucketReferenceType.FREE,
        referenceNote: starterCreditsNote(projectId),
      },
      select: { id: true },
    }),
  ]);
  return {
    tier: subscription?.tier ?? null,
    interval: subscription
      ? subscription.interval === "year"
        ? "year"
        : "month"
      : null,
    status: subscription?.status ?? null,
    periodEnd: subscription?.currentPeriodEnd ?? null,
    cancelAtPeriodEnd: subscription?.cancelAtPeriodEnd ?? false,
    pendingTier: subscription?.pendingPolarProductId
      ? await cmoPlanTier(subscription.pendingPolarProductId)
      : null,
    hiredWithStarterCredits: starter !== null,
  };
}

/**
 * Gives a hire's Project its starter credits, wherever the hire landed
 * (ADR 0065), once per Project, while its Cuso is live. They are Project
 * credits that never expire and end with the Cuso (ADR 0067).
 *
 * Like `writeOffUnlessLiveCuso`, the liveness check is a write to Cuso's row,
 * so it serializes with Start over's Serializable archive. Read Committed:
 * each statement takes a new snapshot. If the archive commits first, the
 * UPDATE rechecks its WHERE on the new row, matches nothing and nothing is
 * granted. If the grant commits first, the archive fails on the row it then
 * locks and retries on a snapshot that has the bucket to write off. Two
 * grants: the second waits on the row lock, and its dedupe read then sees the
 * first grant.
 */
export async function grantCmoStarterCredits(input: {
  projectId: string;
  organizationId: string;
}): Promise<void> {
  const referenceNote = starterCreditsNote(input.projectId);
  const { freeCreditAdminService } = await import(
    "@/services/free-credit-admin.service"
  );
  await prisma.$transaction(async (tx) => {
    const { count } = await tx.sokoBot.updateMany({
      where: { ...LIVE_CUSO_WHERE, projectId: input.projectId },
      data: { updatedAt: new Date() },
    });
    if (count === 0) return;
    const granted = await tx.creditBucket.findFirst({
      where: { referenceType: CreditBucketReferenceType.FREE, referenceNote },
      select: { id: true },
    });
    if (granted) return;
    await freeCreditAdminService.grantFreeCredits({
      target: { targetType: "organization", targetId: input.organizationId },
      projectId: input.projectId,
      credits: CMO_STARTER_CREDITS,
      ttlDays: null,
      referenceNote,
      tx,
    });
  });
}

/**
 * Approving the strategy spends the business's credits and publishes in its
 * name: the organization's owners and admins only
 * (ADR 0061). Every other member works with Cuso freely.
 */
export async function requireCmoCommitter(
  userId: string,
  cuso: Pick<Cuso, "workspaceId">,
): Promise<void> {
  const { organizationId } = await cmoPayer(cuso);
  const workspace = { id: cuso.workspaceId, userId: null, organizationId };
  if (!(await mayApproveMarketingStrategy(userId, workspace))) {
    throw new CmoForbiddenError(
      "Only the organization's owners and admins approve Cuso's plan and start his month",
    );
  }
}

/**
 * Whether a CMO bot may schedule or publish. Null for bots that are not CMO
 * bots (no CMO rules apply) and when allowed: the owner approved the
 * strategy and the CMO subscription is active.
 */
export async function cmoExecutionRefusal(input: {
  sokoBotId: string;
  versionId: string | null;
}): Promise<string | null> {
  if (getSokoBotVersion(input.versionId).profile !== "cmo") return null;
  const cuso = await findCusoForBot(input.sokoBotId);
  if (!cuso) return null;
  const verdict = cmoMayExecute({
    approved: (await approvedMarketingStrategy(cuso.projectId)) !== null,
    subscribed: await isCmoSubscribed(cuso),
  });
  return verdict.ok ? null : verdict.reason;
}
