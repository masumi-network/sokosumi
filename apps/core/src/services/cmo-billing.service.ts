import { cmoMayExecute, getSokoBotVersion } from "@sokosumi/soko-bot";
import { getEnv, isProductionEnvironment } from "@/config/env";
import { isOrganizationOwnerOrAdmin } from "@/helpers/organization-role";
import prisma from "@/lib/db/prisma";
import {
  CmoConflictError,
  CmoForbiddenError,
  type CmoHireView,
  CmoNotFoundError,
  cmoPayer,
  getCmoHireForBot,
  getCmoHireForUser,
  startCmoProduction,
} from "@/services/cmo-cuso.service";

/** The org's active plan that lets Cuso execute, or null. */
export async function activeCmoPlan(
  referenceId: string,
): Promise<string | null> {
  const plans = getEnv().CMO_SUBSCRIPTION_PLANS;
  const subscription = await prisma.subscription.findFirst({
    where: {
      referenceId,
      plan: { in: plans },
      status: { in: ["active", "trialing"] },
    },
    select: { plan: true },
  });
  return subscription?.plan ?? null;
}

/** Execution (scheduling, publishing) needs a paid plan on the org. */
export async function hasActiveCmoSubscription(
  referenceId: string,
): Promise<boolean> {
  return (await activeCmoPlan(referenceId)) !== null;
}

/** CMO_MOCK_BILLING, which production ignores so a stray value cannot make plans free. */
export function cmoMockBilling(): boolean {
  const env = getEnv();
  return env.CMO_MOCK_BILLING && !isProductionEnvironment(env);
}

/** The CMO tier picked without billing; ignored unless mock billing is on. */
export function cmoMockPlan(
  hire: Pick<CmoHireView, "mockPlan">,
): string | null {
  return cmoMockBilling() ? hire.mockPlan : null;
}

/** A mock plan (when allowed) or a real paid plan lets Cuso execute. */
export async function isCmoSubscribed(
  hire: Pick<CmoHireView, "workspaceId" | "mockPlan">,
): Promise<boolean> {
  if (cmoMockPlan(hire)) return true;
  return hasActiveCmoSubscription((await cmoPayer(hire)).referenceId);
}

/**
 * Approving the strategy and starting the paid month spend the business's
 * money and publish in its name: the organization's owners and admins only
 * (ADR 0061). Every other member works with Cuso freely.
 */
export async function mayCommitCmo(
  userId: string,
  organizationId: string,
): Promise<boolean> {
  const member = await prisma.member.findUnique({
    where: { userId_organizationId: { userId, organizationId } },
    select: { role: true },
  });
  return member !== null && isOrganizationOwnerOrAdmin(member.role);
}

export async function requireCmoCommitter(
  userId: string,
  hire: Pick<CmoHireView, "workspaceId">,
): Promise<void> {
  const { organizationId } = await cmoPayer(hire);
  if (!(await mayCommitCmo(userId, organizationId))) {
    throw new CmoForbiddenError(
      "Only the organization's owners and admins approve Cuso's plan and start his month",
    );
  }
}

/** Activates a CMO tier without checkout, on local and preview runs only. */
export async function chooseCmoMockPlan(
  userId: string,
  plan: string,
): Promise<void> {
  if (!cmoMockBilling()) {
    throw new CmoConflictError("Mock billing is off on this server");
  }
  const hire = await getCmoHireForUser(userId);
  if (!hire) throw new CmoNotFoundError("Cuso is not hired yet");
  await requireCmoCommitter(userId, hire);
  await prisma.cmoHire.update({
    where: { id: hire.id },
    data: { mockPlan: plan, mockPlanActivatedAt: new Date() },
  });
  await startCmoProduction(hire.id);
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
  const hire = await getCmoHireForBot(input.sokoBotId);
  if (!hire) return null;
  const verdict = cmoMayExecute({
    approved: hire.strategyApprovedAt !== null,
    subscribed: await isCmoSubscribed(hire),
  });
  return verdict.ok ? null : verdict.reason;
}
