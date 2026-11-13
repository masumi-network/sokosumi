import { CORE_API_ERROR_KINDS } from "@sokosumi/utils";

import {
  changePolarSubscriptionPlan,
  clearPolarPendingPlanChange,
  createPolarCustomerPortalUrl,
} from "@/clients/polar.client";
import { isFirstPartyAppUrl } from "@/config/cors-allow-origin";
import { serviceUnavailable } from "@/helpers/error";
import prisma from "@/lib/db/prisma";
import { getCmoCatalog } from "@/services/cmo-catalog.service";
import {
  CmoConflictError,
  CmoForbiddenError,
  type Cuso,
  type CusoTarget,
  cmoPayer,
  requireCuso,
} from "@/services/cmo-cuso.service";
import { recordCmoSubscriptionChange } from "@/services/cmo-subscription.service";
import { grantStartedCmoYearlyMonths } from "@/services/cmo-yearly-grant-sync.service";
import { mayApproveMarketingStrategy } from "@/services/marketing-strategy.service";

/**
 * What owners and admins do with a Cuso's CMO subscription from CMO's
 * Settings (ADR 0068): move him to another tier of his interval, and open
 * Polar's customer portal to cancel, change the payment method or read
 * invoices. Other members get neither.
 */

/** The Cuso, when the caller may manage his organization's billing. */
async function requireBillingManager(target: CusoTarget): Promise<{
  cuso: Cuso;
  organizationId: string;
}> {
  const cuso = await requireCuso(target);
  const { organizationId } = await cmoPayer(cuso);
  const workspace = { id: cuso.workspaceId, userId: null, organizationId };
  if (!(await mayApproveMarketingStrategy(target.userId, workspace))) {
    throw new CmoForbiddenError(
      "Only the organization's owners and admins change the plan and open billing",
      CORE_API_ERROR_KINDS.ORGANIZATION_ROLE_FORBIDDEN,
    );
  }
  return { cuso, organizationId };
}

function refuse(message: string, kind: "not_active" | "not_allowed"): never {
  throw new CmoConflictError(
    message,
    kind === "not_active"
      ? CORE_API_ERROR_KINDS.SUBSCRIPTION_NOT_ACTIVE
      : CORE_API_ERROR_KINDS.SUBSCRIPTION_CHANGE_NOT_ALLOWED,
  );
}

/**
 * Moves the Cuso to the tier of his interval. More credits is an upgrade: it
 * applies now and Polar charges the prorated difference (the paid order
 * grants the extra credits). Fewer is a downgrade: Polar applies it at the
 * next renewal and the overview shows it as pending until then. The current
 * tier while a downgrade is pending keeps the plan: Polar drops the downgrade.
 */
export async function changeCmoPlan(
  input: CusoTarget & { tier: string },
): Promise<{ change: "upgrade" | "downgrade" | "kept" }> {
  const { cuso } = await requireBillingManager(input);
  const claimedAt = await claimPlanChange(cuso.projectId);
  try {
    return await changeClaimedPlan(cuso, input.tier);
  } finally {
    await prisma.cmoSubscription.updateMany({
      where: { projectId: cuso.projectId, planChangeClaimedAt: claimedAt },
      data: { planChangeClaimedAt: null },
    });
  }
}

/** A claim older than this belongs to a request that died: it is taken over. */
const PLAN_CHANGE_CLAIM_MS = 60_000;

/**
 * Claims the Cuso's subscription for one plan change: two at once would both
 * read the old tier, and the second would count its upgrade from it although
 * Polar charges from the first one's tier. The claim is one conditional
 * write; the change reads the tier after it.
 */
async function claimPlanChange(projectId: string): Promise<Date> {
  const claimedAt = new Date();
  const claimed = await prisma.cmoSubscription.updateMany({
    where: {
      projectId,
      endedAt: null,
      OR: [
        { planChangeClaimedAt: null },
        {
          planChangeClaimedAt: {
            lt: new Date(claimedAt.getTime() - PLAN_CHANGE_CLAIM_MS),
          },
        },
      ],
    },
    data: { planChangeClaimedAt: claimedAt },
  });
  if (claimed.count > 0) return claimedAt;
  const subscription = await prisma.cmoSubscription.findFirst({
    where: { projectId, endedAt: null },
    select: { id: true },
  });
  if (!subscription) refuse("This Cuso has no CMO subscription", "not_active");
  refuse(
    "Another plan change for this Cuso is still running. Try again in a moment",
    "not_allowed",
  );
}

async function changeClaimedPlan(
  cuso: Cuso,
  tier: string,
): Promise<{ change: "upgrade" | "downgrade" | "kept" }> {
  const subscription = await prisma.cmoSubscription.findFirst({
    where: { projectId: cuso.projectId, endedAt: null },
    select: {
      id: true,
      projectId: true,
      organizationId: true,
      polarSubscriptionId: true,
      polarProductId: true,
      currentPeriodStart: true,
      lastPaidOrderId: true,
      interval: true,
      status: true,
      cancelAtPeriodEnd: true,
      pendingPolarProductId: true,
    },
  });
  if (!subscription) refuse("This Cuso has no CMO subscription", "not_active");
  if (subscription.status === "past_due") {
    refuse(
      "The last payment failed. Fix the payment before changing the plan",
      "not_active",
    );
  }
  if (subscription.status !== "active") {
    refuse("This Cuso's CMO subscription is not active", "not_active");
  }
  if (subscription.cancelAtPeriodEnd) {
    refuse(
      "The subscription is cancelled at the period end. Undo the cancel in the billing portal first",
      "not_allowed",
    );
  }
  const plans = (await getCmoCatalog()).plans.filter(
    (plan) => plan.interval === subscription.interval,
  );
  const current = plans.find(
    (plan) => plan.productId === subscription.polarProductId,
  );
  if (!current) throw serviceUnavailable("CMO plans are not set up");
  const target = plans.find((plan) => plan.tier === tier);
  if (!target) {
    refuse(
      `The plan changes only to another plan billed ${subscription.interval === "year" ? "yearly" : "monthly"}`,
      "not_allowed",
    );
  }
  if (target.productId === current.productId) {
    if (!subscription.pendingPolarProductId) {
      refuse("This Cuso is on that plan already", "not_allowed");
    }
    const cleared = await clearPolarPendingPlanChange(
      subscription.polarSubscriptionId,
    );
    if (cleared.isErr()) {
      refuse(
        "Polar cannot change this subscription right now. Try again later",
        "not_allowed",
      );
    }
    // Polar's own subscription.updated follows; the overview need not wait.
    await recordCmoSubscriptionChange(cleared.value);
    return { change: "kept" };
  }
  const upgrade = target.credits > current.credits;
  const { lastPaidOrderId } = subscription;
  if (upgrade && subscription.interval === "year" && lastPaidOrderId) {
    await grantStartedCmoYearlyMonths(
      { ...subscription, lastPaidOrderId },
      current,
    );
  }
  const changed = await changePolarSubscriptionPlan({
    polarSubscriptionId: subscription.polarSubscriptionId,
    productId: target.productId,
    ...(upgrade && { upgradeFromCredits: current.credits }),
  });
  if (changed.isErr()) {
    if (changed.error === "payment_failed") {
      throw new CmoConflictError(
        "The payment for the upgrade failed. The plan stays as it was",
        CORE_API_ERROR_KINDS.SUBSCRIPTION_PAYMENT_FAILED,
      );
    }
    refuse(
      "Polar cannot change this subscription right now. Try again later",
      "not_allowed",
    );
  }
  // The tier (or the pending tier) shows at once; the upgrade's extra
  // credits still come only with Polar's paid order.
  await recordCmoSubscriptionChange(changed.value);
  return { change: upgrade ? "upgrade" : "downgrade" };
}

/** A Polar customer portal link for the Cuso's organization. */
export async function openCmoCustomerPortal(
  input: CusoTarget & { returnUrl: string },
): Promise<{ url: string }> {
  if (!isFirstPartyAppUrl(input.returnUrl)) {
    throw new CmoConflictError("The return address must be CMO's own page");
  }
  const { organizationId } = await requireBillingManager(input);
  const url = await createPolarCustomerPortalUrl({
    organizationId,
    returnUrl: input.returnUrl,
  });
  if (!url) {
    refuse("This organization has not paid for a CMO plan yet", "not_active");
  }
  return { url };
}
