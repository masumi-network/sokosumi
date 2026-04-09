import type {
  PaidSubscriptionPlanName,
  SubscriptionPlanName,
} from "@/lib/stripe/subscription-catalog";

export interface SubscriptionPlanView {
  credits: number;
  currency: string;
  isCurrent: boolean;
  monthlyAmount: number;
  name: SubscriptionPlanName;
}

export type PaidSubscriptionPlanView = Omit<SubscriptionPlanView, "name"> & {
  name: PaidSubscriptionPlanName;
};

export interface ActiveSubscription {
  periodEnd?: Date | string | null;
  plan?: string | null;
  seats?: number | null;
}

interface SplitSubscriptionPlansResult {
  freePlan: SubscriptionPlanView | null;
  paidPlans: SubscriptionPlanView[];
}

export function splitSubscriptionPlans(
  plans: SubscriptionPlanView[],
): SplitSubscriptionPlansResult {
  let freePlan: SubscriptionPlanView | null = null;
  const paidPlans: SubscriptionPlanView[] = [];

  for (const plan of plans) {
    if (plan.name === "free") {
      freePlan = plan;
      continue;
    }

    paidPlans.push(plan);
  }

  return {
    freePlan,
    paidPlans,
  };
}

export function getPlanTranslationKey(plan: SubscriptionPlanName): string {
  switch (plan) {
    case "free":
      return "free";
    case "starter":
      return "starter";
    case "standard":
      return "standard";
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

export function parsePlanName(
  value: string | null | undefined,
): SubscriptionPlanName | null {
  if (!value) {
    return null;
  }

  switch (value.toLowerCase()) {
    case "free":
    case "starter":
    case "standard":
    case "pro":
      return value.toLowerCase() as SubscriptionPlanName;
    default:
      return null;
  }
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
>(subscriptions: T[]): SubscriptionPlanName | null {
  const latestSubscription = resolveLatestSubscription(subscriptions);
  return parsePlanName(latestSubscription?.plan);
}
