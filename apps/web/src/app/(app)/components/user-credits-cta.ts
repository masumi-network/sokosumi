interface ResolveUserCreditsCtaParams {
  currentPlan: string | null;
  hasLowCredits: boolean;
  suppressLowCreditsCta: boolean;
}

export type UserCreditsCta = "addCredits" | "upgradePlan" | "none";

export function resolveUserCreditsCta({
  currentPlan,
  hasLowCredits,
  suppressLowCreditsCta,
}: ResolveUserCreditsCtaParams): UserCreditsCta {
  if (suppressLowCreditsCta && hasLowCredits) {
    return "none";
  }

  const shouldShowUpgradePlanCta =
    currentPlan !== null && currentPlan !== "pro";
  const shouldShowAddCreditsCta = hasLowCredits && currentPlan !== "free";

  if (shouldShowAddCreditsCta) {
    return "addCredits";
  }

  if (!shouldShowUpgradePlanCta) {
    return "none";
  }

  return "upgradePlan";
}
