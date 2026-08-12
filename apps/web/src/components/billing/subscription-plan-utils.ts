import {
  type OrganizationBillingPlanName,
  type PaidSubscriptionPlanName,
  parseSelfServeSubscriptionPlanName,
  type SelfServeSubscriptionPlanName,
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

/** Preferred default when present in the catalog and not the current plan. */
export const DEFAULT_ONBOARDING_SELECTED_PLAN: PaidSubscriptionPlanName =
  "standard";

/**
 * Initial plan selection for signup / free-upgrade onboarding surfaces.
 * Prefers standard among non-current paid plans; falls back to the first
 * selectable plan, then the literal "starter" when the catalog is empty.
 */
export function resolveInitialSelectedPlan(
  paidPlans: PaidSubscriptionPlanView[],
): PaidSubscriptionPlanName {
  const selectablePlans = paidPlans.filter((plan) => !plan.isCurrent);
  const preferredPlan = selectablePlans.find(
    (plan) => plan.name === DEFAULT_ONBOARDING_SELECTED_PLAN,
  );

  return preferredPlan?.name ?? selectablePlans[0]?.name ?? "starter";
}

/** True when at least one paid plan can be purchased (not the current plan). */
export function hasSelectablePaidPlan(
  paidPlans: PaidSubscriptionPlanView[],
): boolean {
  return paidPlans.some((plan) => !plan.isCurrent);
}

export interface ActiveSubscription {
  periodEnd?: Date | string | null;
  plan?: string | null;
  seats?: number | null;
}

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

interface SubscriptionWithPlan {
  plan?: string | null;
}

interface SubscriptionWithPeriodEnd {
  periodEnd?: Date | string | null;
}

/** Parses self-serve subscription plan names only. */
export function parsePlanName(
  value: string | null | undefined,
): SelfServeSubscriptionPlanName | null {
  return parseSelfServeSubscriptionPlanName(value);
}

function getDateValue(value: Date | string | null | undefined): number {
  if (!value) {
    return 0;
  }

  if (value instanceof Date) {
    return value.getTime();
  }

  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? 0 : timestamp;
}

export function resolveLatestSubscription<T extends SubscriptionWithPeriodEnd>(
  subscriptions: T[],
): T | null {
  if (subscriptions.length === 0) {
    return null;
  }

  const sortedSubscriptions = [...subscriptions].sort((a, b) => {
    return getDateValue(b.periodEnd) - getDateValue(a.periodEnd);
  });

  return sortedSubscriptions[0] ?? null;
}

export function resolveCurrentPlanName<
  T extends SubscriptionWithPlan & SubscriptionWithPeriodEnd,
>(subscriptions: T[]): SelfServeSubscriptionPlanName | null {
  const latestSubscription = resolveLatestSubscription(subscriptions);
  return parsePlanName(latestSubscription?.plan);
}
