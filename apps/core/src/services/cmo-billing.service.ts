import { CreditBucketReferenceType, type Prisma } from "@sokosumi/database";
import { cmoMayExecute, getSokoBotVersion } from "@sokosumi/soko-bot";
import prisma from "@/lib/db/prisma";
import { getCmoCatalog } from "@/services/cmo-catalog.service";
import {
  CmoForbiddenError,
  type Cuso,
  cmoBusinessNameFromUrl,
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

const STARTER_CREDITS_NOTE = "CMO.xyz starter credits";

/** Names the grant after the hire's Project, so each hire got it once. */
function starterCreditsNote(projectId: string): string {
  return `${STARTER_CREDITS_NOTE} (project ${projectId})`;
}

/**
 * A Cuso's Project that never had a CMO subscription (any status, ended or
 * not) and was not hired with Starter credits: nobody paid for him yet.
 */
const UNPAID_CUSO_PROJECT_WHERE = {
  cmoSubscriptions: { none: {} },
  creditBuckets: {
    none: {
      referenceType: CreditBucketReferenceType.FREE,
      referenceNote: { startsWith: STARTER_CREDITS_NOTE },
    },
  },
} satisfies Prisma.ProjectWhereInput;

/**
 * Free hiring (ADR 0068): an unpaid live Cuso whose strategy is not approved
 * yet. His turns are not charged and may start without credits; from
 * approval (Launch) he is paused until a plan is paid.
 */
export async function isCusoInFreeHiring(
  sokoBotId: string,
  db: Pick<Prisma.TransactionClient, "sokoBot"> = prisma,
): Promise<boolean> {
  const bot = await db.sokoBot.findFirst({
    where: {
      id: sokoBotId,
      ...LIVE_CUSO_WHERE,
      project: {
        ...UNPAID_CUSO_PROJECT_WHERE,
        marketingStrategies: { none: { approvedAt: { not: null } } },
      },
    },
    select: { id: true },
  });
  return bot !== null;
}

/**
 * The live Cuso this person hired that nobody paid for yet, approved or not:
 * a person may have one at a time (ADR 0068).
 */
export async function findUnpaidCusoHiredBy(
  userId: string,
  db: Pick<Prisma.TransactionClient, "sokoBot"> = prisma,
): Promise<{ projectId: string; businessName: string } | null> {
  const bot = await db.sokoBot.findFirst({
    where: {
      ...LIVE_CUSO_WHERE,
      createdByUserId: userId,
      project: UNPAID_CUSO_PROJECT_WHERE,
    },
    select: { project: { select: { id: true, websiteUrl: true } } },
    orderBy: { createdAt: "desc" },
  });
  if (!bot?.project) return null;
  return {
    projectId: bot.project.id,
    businessName: cmoBusinessNameFromUrl(bot.project.websiteUrl ?? ""),
  };
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
