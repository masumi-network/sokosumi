import { getTranslations } from "next-intl/server";

interface ResolvePlanSecondaryLabelArgs {
  plan: string | null;
  organizationName: string | null;
}

/**
 * Bare plan name ("Free", "Pro", …), or null when the plan is unknown or has no
 * catalog entry — callers decide how to word that gap.
 */
export async function resolvePlanName(
  plan: string | null,
): Promise<string | null> {
  if (plan === null) {
    return null;
  }

  const tSubscriptions = await getTranslations("App.Subscriptions");

  try {
    return tSubscriptions(`Plans.${plan}.name`);
  } catch (_error) {
    return null;
  }
}

export async function resolvePlanSecondaryLabel({
  plan,
  organizationName,
}: ResolvePlanSecondaryLabelArgs): Promise<string> {
  const tPlan = await getTranslations("App.Header.Plan");
  const planName = await resolvePlanName(plan);

  if (planName === null) {
    return tPlan("unavailable");
  }

  if (organizationName !== null) {
    return tPlan("organizationPlan", {
      plan: planName,
      organization: organizationName,
    });
  }

  return tPlan("userPlan", { plan: planName });
}
