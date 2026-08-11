import type { SelfServeSubscriptionPlanName } from "@sokosumi/utils";

import type { SubscriptionWallPlan } from "@/app/personal-assistant/components/subscription-required-dialog";
import { hasAdminRole } from "@/lib/auth/has-admin-role";
import type { GetSubscriptionCatalogResponse } from "@/lib/clients/generated/core";

const PAID_PLAN_ORDER = [
  "starter",
  "standard",
  "pro",
] as const satisfies SelfServeSubscriptionPlanName[];

/**
 * UX gate for PA activate/use. Fail-closed: only coverage or platform
 * admin unlocks; everyone else can still view landing/history.
 */
export function resolveHermesHasActiveSubscription(
  hasCoverage: boolean,
  userRole: string | null | undefined,
): boolean {
  return hasCoverage || hasAdminRole(userRole);
}

/**
 * Map Core catalog → subscription wall plan chips. Empty when catalog
 * missing (wall still works without links).
 */
export function buildSubscriptionWallPlans(
  catalog: GetSubscriptionCatalogResponse | null | undefined,
): SubscriptionWallPlan[] {
  if (!catalog) return [];
  return PAID_PLAN_ORDER.map((name) => {
    const plan = catalog.data[name];
    return {
      name,
      monthlyAmount: plan.monthlyAmount,
      currency: plan.currency,
      credits: plan.credits,
    };
  });
}
