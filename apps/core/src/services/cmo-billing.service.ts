import { CreditBucketReferenceType, type Prisma } from "@sokosumi/database";
import { cmoMayExecute, getSokoBotVersion } from "@sokosumi/soko-bot";
import { getEnv } from "@/config/env";
import { isOnEmailAllowlist } from "@/helpers/email-allowlist";
import prisma from "@/lib/db/prisma";
import { serializableTransaction } from "@/lib/db/transaction";
import { isEvalCusoProject } from "@/lib/evals/eval-guard";
import { getCmoCatalog } from "@/services/cmo-catalog.service";
import {
  CmoConflictError,
  CmoForbiddenError,
  CmoNotFoundError,
  type Cuso,
  type CusoTarget,
  cmoBusinessNameFromUrl,
  cmoPayer,
  findCusoForBot,
  LIVE_CUSO_WHERE,
  requireCuso,
} from "@/services/cmo-cuso.service";
import {
  approvedMarketingStrategy,
  mayApproveMarketingStrategy,
} from "@/services/marketing-strategy.service";

/**
 * Tester credits (all Projects, or one): what a Cuso works on without a CMO
 * subscription, found by their type. The gate, free hiring, the unpaid-Cuso
 * rule and the hiring steps all read them through this.
 */
function testerCreditsWhere(projectId?: string): Prisma.CreditBucketWhereInput {
  return {
    referenceType: CreditBucketReferenceType.CMO_TESTER_CREDITS,
    ...(projectId && { projectId }),
  };
}

/**
 * A Cuso's Project that never had a CMO subscription (any status, ended or
 * not) and never got Tester credits: nobody paid for him yet.
 */
const UNPAID_CUSO_PROJECT_WHERE = {
  polarSubscriptions: { none: {} },
  creditBuckets: { none: testerCreditsWhere() },
} satisfies Prisma.ProjectWhereInput;

/** An unpaid Cuso's Project whose strategy is not approved yet (Launch). */
const FREE_HIRING_PROJECT_WHERE = {
  ...UNPAID_CUSO_PROJECT_WHERE,
  marketingStrategies: { none: { approvedAt: { not: null } } },
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
      project: FREE_HIRING_PROJECT_WHERE,
    },
    select: { id: true },
  });
  return bot !== null;
}

/**
 * The CMO subscription gate (ADR 0068): Cuso works while his Project has an
 * active CMO subscription (a scheduled cancel counts until the period
 * ends; past due and ended do not), while he is in free hiring, or while
 * he holds Tester credits that are not used up. Otherwise he is paused,
 * even when the Organization credit pool has credits. An eval lane's Cuso
 * stands in for a paying customer.
 */
export async function isCmoSubscribed(
  cuso: Pick<Cuso, "projectId">,
  now: Date = new Date(),
  db: Pick<
    Prisma.TransactionClient,
    "polarSubscription" | "project" | "creditBucket"
  > = prisma,
): Promise<boolean> {
  const { projectId } = cuso;
  if (await isEvalCusoProject(projectId)) return true;
  const [paid, freeHiring] = await Promise.all([
    cmoPaidFor(projectId, now, db),
    db.project.findFirst({
      where: { id: projectId, ...FREE_HIRING_PROJECT_WHERE },
      select: { id: true },
    }),
  ]);
  return paid.subscribed || paid.testerCreditsLeft || freeHiring !== null;
}

/**
 * What pays for the Cuso: an active CMO subscription (a scheduled cancel
 * counts until the period ends; past due and ended do not), and Tester
 * credits not used up.
 */
async function cmoPaidFor(
  projectId: string,
  now: Date,
  db: Pick<Prisma.TransactionClient, "polarSubscription" | "creditBucket">,
): Promise<{ subscribed: boolean; testerCreditsLeft: boolean }> {
  const [subscription, testerBuckets] = await Promise.all([
    db.polarSubscription.findFirst({
      where: {
        projectId,
        endedAt: null,
        status: "active",
        OR: [{ cancelAtPeriodEnd: false }, { currentPeriodEnd: { gt: now } }],
      },
      select: { id: true },
    }),
    db.creditBucket.findMany({
      where: {
        AND: [
          testerCreditsWhere(projectId),
          { OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
        ],
      },
      select: { amount: true, consumptions: { select: { amount: true } } },
    }),
  ]);
  return {
    subscribed: subscription !== null,
    testerCreditsLeft: testerBuckets.some(
      (bucket) =>
        bucket.consumptions.reduce((spent, c) => spent + c.amount, 0n) <
        bucket.amount,
    ),
  };
}

/** What a tester's skip gives a Cuso, as a hire before CMO plans got. */
export const CMO_TESTER_CREDITS = 10_000;

/**
 * Whether this person may continue the Cuso without a subscription: on
 * `CMO_SUBSCRIPTION_SKIP_ALLOWLIST`, while nothing pays for him (no active
 * subscription, no Tester credits left).
 */
export async function maySkipCmoSubscription(
  userId: string,
  projectId: string,
  now: Date = new Date(),
): Promise<boolean> {
  if (
    !(await isOnEmailAllowlist(
      userId,
      getEnv().CMO_SUBSCRIPTION_SKIP_ALLOWLIST,
    ))
  ) {
    return false;
  }
  const paid = await cmoPaidFor(projectId, now, prisma);
  return !paid.subscribed && !paid.testerCreditsLeft;
}

/**
 * A tester continues the Cuso without a subscription: his Project gets
 * Tester credits, which open the gate, end free hiring and his checkout, and
 * go with the ending's write-off. Repeatable once they are used up; refused
 * while a subscription or such credits pay for him.
 */
export async function skipCmoSubscription(input: CusoTarget): Promise<void> {
  const cuso = await requireCuso(input);
  if (
    !(await isOnEmailAllowlist(
      input.userId,
      getEnv().CMO_SUBSCRIPTION_SKIP_ALLOWLIST,
    ))
  ) {
    throw new CmoForbiddenError(
      "Only testers may continue without a subscription",
    );
  }
  const { organizationId } = await cmoPayer(cuso);
  const granted = await grantCmoTesterCredits({
    projectId: cuso.projectId,
    organizationId,
  });
  if (granted === "not_live") {
    throw new CmoNotFoundError("Cuso is not hired yet");
  }
  if (granted === "paid") {
    throw new CmoConflictError(
      "This Cuso can work already: a subscription or credits pay for him",
    );
  }
}

/**
 * Gives a Cuso's Project Tester credits, while he is live and nothing pays
 * for him yet: the grant hires made before CMO plans, now with its own type
 * and a fresh reference per grant, so it repeats once they are used up. They are Project
 * credits that never expire and end with the Cuso (ADR 0067).
 *
 * Like `writeOffUnlessLiveCuso`, the liveness check is a write to Cuso's
 * row, inside a Serializable transaction: Start over's archive and a second
 * grant (a double click) both write it, so whichever comes second fails on
 * the row and runs again, then sees the Cuso ended or the credits granted.
 */
export async function grantCmoTesterCredits(input: {
  projectId: string;
  organizationId: string;
}): Promise<"granted" | "not_live" | "paid"> {
  const { freeCreditAdminService } = await import(
    "@/services/free-credit-admin.service"
  );
  return await serializableTransaction(async (tx) => {
    const { count } = await tx.sokoBot.updateMany({
      where: { ...LIVE_CUSO_WHERE, projectId: input.projectId },
      data: { updatedAt: new Date() },
    });
    if (count === 0) return "not_live";
    const paid = await cmoPaidFor(input.projectId, new Date(), tx);
    if (paid.subscribed || paid.testerCreditsLeft) return "paid";
    await freeCreditAdminService.grantFreeCredits({
      target: { targetType: "organization", targetId: input.organizationId },
      projectId: input.projectId,
      credits: CMO_TESTER_CREDITS,
      ttlDays: null,
      referenceNote: "CMO tester credits",
      referenceType: CreditBucketReferenceType.CMO_TESTER_CREDITS,
      tx,
    });
    return "granted";
  }, "The credits raced another write to this Cuso");
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
   * His Project was granted Tester credits (a tester's skip, or a hire
   * before CMO plans), spent or not, so his hiring ends without a checkout
   * (ADR 0068).
   */
  hasTesterCredits: boolean;
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
  const [subscription, tester] = await Promise.all([
    prisma.polarSubscription.findFirst({
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
      where: testerCreditsWhere(projectId),
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
    hasTesterCredits: tester !== null,
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
