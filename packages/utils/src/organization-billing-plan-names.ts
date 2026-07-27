/** Monthly credit grant for the free subscription plan. */
export const FREE_SUBSCRIPTION_MONTHLY_CREDITS = 250;

export type SelfServeSubscriptionPlanName =
  | "free"
  | "starter"
  | "standard"
  | "pro";

export type OrganizationBillingPlanName =
  | SelfServeSubscriptionPlanName
  | "enterprise";

export type SubscriptionPlanName = SelfServeSubscriptionPlanName;

export type PaidSubscriptionPlanName = Exclude<
  SelfServeSubscriptionPlanName,
  "free"
>;

/**
 * The billing ladder, cheapest first. Feature gates compare ranks instead of
 * listing plan names, so adding a tier only touches this map.
 */
const BILLING_PLAN_RANK: Record<OrganizationBillingPlanName, number> = {
  free: 0,
  starter: 1,
  standard: 2,
  pro: 3,
  enterprise: 4,
};

/** Lowest plan that unlocks the personal assistant. */
export const PERSONAL_ASSISTANT_MIN_PLAN =
  "standard" satisfies OrganizationBillingPlanName;

/**
 * Self-serve plans that unlock the personal assistant, cheapest first — what
 * the upgrade wall offers. Enterprise clears the bar too but is not
 * self-serve, so it has no place in a checkout list.
 */
export const PERSONAL_ASSISTANT_PLANS = [
  "standard",
  "pro",
] as const satisfies readonly SelfServeSubscriptionPlanName[];

export function parseOrganizationBillingPlanName(
  value: string | null | undefined,
): OrganizationBillingPlanName | null {
  if (!value) {
    return null;
  }

  const normalized = value.toLowerCase();

  return normalized in BILLING_PLAN_RANK
    ? (normalized as OrganizationBillingPlanName)
    : null;
}

/**
 * True when `plan` is Standard or better. Enterprise contracts carry no
 * self-serve plan name — callers gate those on contract consumability instead.
 */
export function planUnlocksPersonalAssistant(
  plan: string | null | undefined,
): boolean {
  const parsed = parseOrganizationBillingPlanName(plan);

  return (
    parsed !== null &&
    BILLING_PLAN_RANK[parsed] >= BILLING_PLAN_RANK[PERSONAL_ASSISTANT_MIN_PLAN]
  );
}

export function parseSelfServeSubscriptionPlanName(
  value: string | null | undefined,
): SelfServeSubscriptionPlanName | null {
  if (!value) {
    return null;
  }

  switch (value.toLowerCase()) {
    case "free":
    case "starter":
    case "standard":
    case "pro":
      return value.toLowerCase() as SelfServeSubscriptionPlanName;
    default:
      return null;
  }
}
