import type {
  OrganizationBillingPlanName,
  SubscriptionPlanName,
} from "@sokosumi/utils";

import type { PaidSubscriptionPlanView } from "./subscription-plan-utils";

const PLAN_ORDER = [
  "free",
  "starter",
  "standard",
  "pro",
] as const satisfies SubscriptionPlanName[];

type SubscriptionCatalog = Record<
  string,
  { credits: number; currency: string; monthlyAmount: number }
>;

/**
 * Turns the Core subscription catalog into the ordered paid-plan cards the
 * onboarding surfaces render. The free tier is dropped: it is what the user
 * already has, so it is never an upgrade option.
 */
export function toPaidSubscriptionPlanViews(
  catalog: SubscriptionCatalog,
  currentPlan: OrganizationBillingPlanName,
): PaidSubscriptionPlanView[] {
  return PLAN_ORDER.flatMap((planName) => {
    if (planName === "free") {
      return [];
    }

    const plan = catalog[planName];
    if (!plan) {
      return [];
    }

    return [
      {
        credits: plan.credits,
        currency: plan.currency,
        isCurrent: currentPlan === planName,
        monthlyAmount: plan.monthlyAmount,
        name: planName,
      },
    ];
  });
}
