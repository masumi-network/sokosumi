import { getTranslations } from "next-intl/server";

interface ResolvePlanSecondaryLabelArgs {
  plan: string | null;
  organizationName: string | null;
}

export async function resolvePlanSecondaryLabel({
  plan,
  organizationName,
}: ResolvePlanSecondaryLabelArgs): Promise<string> {
  const tPlan = await getTranslations("App.Header.Plan");
  const tSubscriptions = await getTranslations("App.Subscriptions");

  if (plan === null) {
    return tPlan("unavailable");
  }

  try {
    const planName = tSubscriptions(`Plans.${plan}.name`);

    if (organizationName !== null) {
      return tPlan("organizationPlan", {
        plan: planName,
        organization: organizationName,
      });
    }

    return tPlan("userPlan", { plan: planName });
  } catch (_error) {
    return tPlan("unavailable");
  }
}
