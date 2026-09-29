import {
  type OrganizationBillingPlanName,
  type PaidSubscriptionPlanName,
} from "@sokosumi/utils";

export interface SubscriptionPlanView {
  credits: number;
  currency: string;
  isCurrent: boolean;
  monthlyAmount: number;
  name: OrganizationBillingPlanName;
}

export type PaidSubscriptionPlanView = Omit<SubscriptionPlanView, "name"> & {
  name: PaidSubscriptionPlanName;
};

interface SplitSubscriptionPlansResult {
  freePlan: SubscriptionPlanView | null;
  paidPlans: PaidSubscriptionPlanView[];
}

export function splitSubscriptionPlans(
  plans: SubscriptionPlanView[],
): SplitSubscriptionPlansResult {
  let freePlan: SubscriptionPlanView | null = null;
  const paidPlans: PaidSubscriptionPlanView[] = [];

  for (const plan of plans) {
    if (plan.name === "free") {
      freePlan = plan;
      continue;
    }

    if (plan.name === "enterprise") {
      continue;
    }

    paidPlans.push(plan as PaidSubscriptionPlanView);
  }

  return {
    freePlan,
    paidPlans,
  };
}

export function getPlanTranslationKey(
  plan: OrganizationBillingPlanName,
): string {
  switch (plan) {
    case "free":
      return "free";
    case "starter":
      return "starter";
    case "standard":
      return "standard";
    case "enterprise":
      return "enterprise";
    case "pro":
      return "pro";
    default: {
      const _exhaustive: never = plan;
      return _exhaustive;
    }
  }
}

interface ScheduledCancellation {
  cancelAt?: Date | null;
  cancelAtPeriodEnd?: boolean | null;
  periodEnd?: Date | null;
}

/**
 * When a scheduled cancellation takes effect, or null when none is scheduled.
 * Stripe classic billing mode sets cancelAtPeriodEnd; flexible billing mode
 * sets only cancelAt.
 */
export function resolveScheduledCancelDate(
  subscription: ScheduledCancellation | null | undefined,
): Date | null {
  if (subscription?.cancelAt) {
    return subscription.cancelAt;
  }

  return subscription?.cancelAtPeriodEnd
    ? (subscription.periodEnd ?? null)
    : null;
}
