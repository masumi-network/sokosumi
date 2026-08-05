import type { SessionUser } from "@sokosumi/utils";
import { getTranslations } from "next-intl/server";
import { resolveLowCreditsBillingPath } from "@/app/components/account-notice-state";
import { getCachedMyCredits } from "@/app/components/private-sidebar-cache";
import { resolveCreditUsage } from "@/app/components/sidebar";
import AdminSettingsMenuGroup from "@/app/components/sidebar/components/admin-settings-menu-group.client";
import AnnouncementCards from "@/app/components/sidebar/components/announcement-cards";
import MenuItems from "@/app/components/sidebar/components/menu-items";
import PersonalAssistantNav from "@/app/components/sidebar/components/personal-assistant-nav.client";
import { SidebarAccountChip } from "@/app/components/sidebar/components/sidebar-account-chip.client";
import SidebarNav from "@/app/components/sidebar/components/sidebar-nav.client";
import { getDeveloperVendorAdminAccess } from "@/app/developer/get-developer-vendor-admin-access";
import { Sheet } from "@/components/ui/sheet";
import { SidebarSeparator } from "@/components/ui/sidebar";
import { getEnvPublicConfig } from "@/config/env.public";
import { isHermesBetaAccessEmail } from "@/lib/hermes/beta-access";
import { userService } from "@/lib/services";
import {
  resolvePlanName,
  resolvePlanSecondaryLabel,
} from "@/lib/utils/plan-label";

interface MobileHomeHubProps {
  sessionUser: SessionUser;
  activeOrganizationId: string | null;
  adminMenuEnabled: boolean;
}

/**
 * Mobile `<md` Home hub: sidebar leaf nav without Channels/DMs.
 * Wrapped in an open Sheet so MenuItems/PersonalAssistant SheetClose has context.
 */
export async function MobileHomeHub({
  sessionUser,
  activeOrganizationId,
  adminMenuEnabled,
}: MobileHomeHubProps) {
  const tCreditPromise = getTranslations("App.Header.Credit");
  const tPlanPromise = getTranslations("App.Header.Plan");
  const hermesMenuEnabled = isHermesBetaAccessEmail(sessionUser.email);
  const lowCreditsThreshold =
    getEnvPublicConfig().NEXT_PUBLIC_CREDITS_BUY_BUTTON_THRESHOLD;

  const membersPromise = userService
    .getMyMembersWithOrganizations()
    .catch(() => []);
  const activeOrganizationPromise = userService.getActiveOrganization();
  const creditsPromise = getCachedMyCredits();

  const [
    tCredit,
    tPlan,
    members,
    { showVendors: showDeveloperVendors },
    activeOrganization,
    creditsResult,
  ] = await Promise.all([
    tCreditPromise,
    tPlanPromise,
    membersPromise,
    getDeveloperVendorAdminAccess(),
    activeOrganizationPromise,
    creditsPromise,
  ]);

  const creditsData = creditsResult?.data.credits ?? null;
  const currentPlan = creditsData?.subscription?.plan ?? "free";
  const planForLabel = creditsData === null ? null : currentPlan;
  const organizationName = activeOrganization?.name ?? null;
  const buyCreditsPath = resolveLowCreditsBillingPath(currentPlan);
  const currentTimestampMs = creditsResult?.meta?.timestamp
    ? new Date(creditsResult.meta.timestamp).getTime()
    : 0;
  const subscriptionPeriodEnd = creditsData?.subscription?.periodEnd ?? null;
  const subscriptionPeriodEndMs = subscriptionPeriodEnd
    ? new Date(subscriptionPeriodEnd).getTime()
    : null;

  const [planLabel, planName] = await Promise.all([
    resolvePlanSecondaryLabel({
      plan: planForLabel,
      organizationName: activeOrganizationId
        ? (organizationName ?? tCredit("unavailable"))
        : null,
    }),
    resolvePlanName(planForLabel),
  ]);

  return (
    <Sheet open>
      <div className="-m-4 flex min-h-0 flex-1 flex-col overflow-y-auto bg-background md:hidden">
        <div className="flex w-full flex-1 flex-col gap-0">
          <SidebarNav
            members={members}
            activeOrganizationId={activeOrganizationId}
            planLabel={planLabel}
            showDeveloperVendors={showDeveloperVendors}
          >
            <PersonalAssistantNav enabled={hermesMenuEnabled} />
            {hermesMenuEnabled ? <SidebarSeparator className="-mt-px" /> : null}
            <MenuItems />
            <SidebarSeparator />
            <AdminSettingsMenuGroup adminMenuEnabled={adminMenuEnabled} />
          </SidebarNav>
        </div>
        <div className="mt-auto shrink-0 px-0">
          <AnnouncementCards />
          <div className="p-2 pt-0 pb-[env(safe-area-inset-bottom)]">
            <SidebarAccountChip
              sessionUser={sessionUser}
              planName={planName}
              totalCredits={creditsData?.total ?? null}
              extraCredits={creditsData?.buffer ?? null}
              creditUsage={resolveCreditUsage(creditsData)}
              subscriptionPeriodEndMs={subscriptionPeriodEndMs}
              currentTimestampMs={currentTimestampMs}
              lowCreditsThreshold={lowCreditsThreshold}
              buyCreditsLabel={tPlan("getMoreCredits")}
              buyCreditsPath={buyCreditsPath}
            />
          </div>
        </div>
      </div>
    </Sheet>
  );
}
