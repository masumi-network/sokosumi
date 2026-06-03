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
