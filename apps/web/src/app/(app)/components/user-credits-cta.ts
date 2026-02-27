interface ResolveUserCreditsCtaParams {
  currentPlan: string | null;
  hasLowCredits: boolean;
}

export type UserCreditsCta = "addCredits" | "upgradePlan" | "none";

export function resolveUserCreditsCta({
  currentPlan,
  hasLowCredits,
}: ResolveUserCreditsCtaParams): UserCreditsCta {
  const shouldShowUpgradePlanCta = currentPlan !== null && currentPlan !== "pro";
  const shouldShowAddCreditsCta =
    hasLowCredits && (currentPlan === null || currentPlan !== "free");

  if (shouldShowAddCreditsCta) {
    return "addCredits";
  }

  if (!shouldShowUpgradePlanCta) {
    return "none";
  }

  return "upgradePlan";
}
