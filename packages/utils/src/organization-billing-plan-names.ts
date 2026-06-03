export type SelfServeSubscriptionPlanName =
  | "free"
  | "starter"
  | "standard"
  | "pro";

/** UI label; `enterprise` is set when the org has a commercially active contract. */
export type OrganizationBillingPlanName =
  | SelfServeSubscriptionPlanName
  | "enterprise";

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
