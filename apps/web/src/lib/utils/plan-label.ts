import { getTranslations } from "next-intl/server";

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
