import type { SubscriptionPlanName } from "@/lib/stripe/subscription-catalog";

export interface ActiveSubscription {
  plan?: string | null;
  periodEnd?: Date | string | null;
}

function parsePlanName(
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

  return Number.isNaN(Date.parse(value)) ? 0 : Date.parse(value);
}

export function resolveCurrentPlanName(
  subscriptions: ActiveSubscription[],
): SubscriptionPlanName | null {
  if (subscriptions.length === 0) {
    return null;
  }

  const sortedSubscriptions = [...subscriptions].sort((a, b) => {
    return getDateValue(b.periodEnd) - getDateValue(a.periodEnd);
  });

  return parsePlanName(sortedSubscriptions[0]?.plan);
}

export function getPlanTranslationKey(plan: string): SubscriptionPlanName {
  switch (plan) {
    case "free":
      return "free";
    case "starter":
      return "starter";
    case "standard":
      return "standard";
    case "pro":
      return "pro";
    default:
      return "free";
  }
}
