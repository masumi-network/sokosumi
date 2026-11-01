import { cmoMayExecute, getSokoBotVersion } from "@sokosumi/soko-bot";
import { getEnv, isProductionEnvironment } from "@/config/env";
import prisma from "@/lib/db/prisma";
import {
  CmoConflictError,
  CmoForbiddenError,
  type Cuso,
  cmoPayer,
  findCusoForBot,
  requireCuso,
  startCmoProduction,
} from "@/services/cmo-cuso.service";
import {
  approvedMarketingStrategy,
  mayApproveMarketingStrategy,
} from "@/services/marketing-strategy.service";

/**
 * The org's active Subscription on a plan that lets Cuso execute, or null.
 * A mock plan is one of these rows without Stripe IDs.
 */
export async function activeCmoSubscription(referenceId: string): Promise<{
  plan: string;
  stripeSubscriptionId: string | null;
  periodStart: Date | null;
} | null> {
  const plans = getEnv().CMO_SUBSCRIPTION_PLANS;
  return prisma.subscription.findFirst({
    where: {
      referenceId,
      plan: { in: plans },
      status: { in: ["active", "trialing"] },
    },
    select: { plan: true, stripeSubscriptionId: true, periodStart: true },
  });
}

/** Execution (scheduling, publishing) needs a CMO plan on the org. */
export async function hasActiveCmoSubscription(
  referenceId: string,
): Promise<boolean> {
  return (await activeCmoSubscription(referenceId)) !== null;
}

/** CMO_MOCK_BILLING, which production ignores so a stray value cannot make plans free. */
export function cmoMockBilling(): boolean {
  const env = getEnv();
  return env.CMO_MOCK_BILLING && !isProductionEnvironment(env);
}

/** The paying organization's CMO Subscription, mock or paid, lets Cuso execute. */
export async function isCmoSubscribed(
  cuso: Pick<Cuso, "workspaceId">,
): Promise<boolean> {
  return hasActiveCmoSubscription((await cmoPayer(cuso)).referenceId);
}

/**
 * Approving the strategy and starting the paid month spend the business's
 * money and publish in its name: the organization's owners and admins only
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
 * Activates a CMO tier without checkout, on local and preview runs only: an
 * active Subscription row for the paying organization without Stripe IDs,
 * moved to the new tier when the organization already has one.
 */
export async function chooseCmoMockPlan(
  userId: string,
  plan: string,
): Promise<void> {
  if (!cmoMockBilling()) {
    throw new CmoConflictError("Mock billing is off on this server");
  }
  const plans = getEnv().CMO_SUBSCRIPTION_PLANS;
  if (!plans.includes(plan)) {
    throw new CmoConflictError(`${plan} is not a CMO plan on this server`);
  }
  const cuso = await requireCuso({ userId });
  await requireCmoCommitter(userId, cuso);
  const { referenceId } = await cmoPayer(cuso);
  const mock = await prisma.subscription.findFirst({
    where: { referenceId, plan: { in: plans }, stripeSubscriptionId: null },
    select: { id: true },
  });
  const data = { plan, status: "active", periodStart: new Date() };
  if (mock) {
    await prisma.subscription.update({ where: { id: mock.id }, data });
  } else {
    await prisma.subscription.create({ data: { referenceId, ...data } });
  }
  await startCmoProduction(cuso.sokoBotId);
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
