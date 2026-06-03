export type SelfServeSubscriptionPlanName =
  | "free"
  | "starter"
  | "standard"
  | "pro";

/** UI label; `enterprise` is set when the org has a commercially active contract. */
export type OrganizationBillingPlanName =
  | SelfServeSubscriptionPlanName
  | "enterprise";

/** Self-serve Stripe/Better Auth plan names only. */
export type SubscriptionPlanName = SelfServeSubscriptionPlanName;

/** Self-serve paid plans in Stripe checkout and upgrade flows. */
export type PaidSubscriptionPlanName = Exclude<
  SelfServeSubscriptionPlanName,
  "free"
>;

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
