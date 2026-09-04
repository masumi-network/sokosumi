import { getTranslations } from "next-intl/server";
import {
  getCachedMyCredits,
  getPrivateCachedChatListChrome,
} from "@/app/components/private-sidebar-cache";
import { mapAccountCreditsChrome } from "@/app/components/sidebar";
import { getDeveloperVendorAdminAccess } from "@/app/developer/get-developer-vendor-admin-access";
import { getEnvPublicConfig } from "@/config/env.public";
import { getSession } from "@/lib/auth/auth.server";
import { hasAdminRole } from "@/lib/auth/has-admin-role";
import { isBetaAccessEmail } from "@/lib/beta-access";
import { resolvePlanName } from "@/lib/utils/plan-label";

import { YouPageClient } from "./you-page.client";

export async function YouPageContent() {
  const session = await getSession();
  if (!session) {
    return null;
  }

  const activeOrganizationId = session.session.activeOrganizationId ?? null;
  const lowCreditsThreshold =
    getEnvPublicConfig().NEXT_PUBLIC_CREDITS_BUY_BUTTON_THRESHOLD;

  const [
    tPlan,
    { showVendors: showDeveloperVendors },
    creditsResult,
    { members },
  ] = await Promise.all([
    getTranslations("App.Header.Plan"),
    getDeveloperVendorAdminAccess(),
    getCachedMyCredits(),
    getPrivateCachedChatListChrome({
      userId: session.user.id,
      activeOrganizationId,
    }),
  ]);

  const credits = mapAccountCreditsChrome(creditsResult);
  const planName = await resolvePlanName(credits.planForLabel);
  const calendarMenuEnabled = isBetaAccessEmail(session.user.email);
  const adminMenuEnabled = hasAdminRole(
    (session.user as typeof session.user & { role?: string | null }).role,
  );

  return (
    <YouPageClient
      sessionUser={session.user}
      calendarMenuEnabled={calendarMenuEnabled}
      planName={planName}
      totalCredits={credits.totalCredits}
      extraCredits={credits.extraCredits}
      creditUsage={credits.creditUsage}
      subscriptionPeriodEndMs={credits.subscriptionPeriodEndMs}
      currentTimestampMs={credits.currentTimestampMs}
      lowCreditsThreshold={lowCreditsThreshold}
      buyCreditsLabel={tPlan("getMoreCredits")}
      buyCreditsPath={credits.buyCreditsPath}
      adminSettingsChrome={{
        adminMenuEnabled,
        members,
        activeOrganizationId,
        showDeveloperVendors,
      }}
    />
  );
}
