import type { SessionUser } from "@sokosumi/utils";
import { getTranslations } from "next-intl/server";
import MenuItems from "@/app/components/sidebar/components/menu-items";
import PersonalAssistantNav from "@/app/components/sidebar/components/personal-assistant-nav.client";
import SidebarNav from "@/app/components/sidebar/components/sidebar-nav.client";
import { getDeveloperVendorAdminAccess } from "@/app/developer/get-developer-vendor-admin-access";
import { Sheet } from "@/components/ui/sheet";
import { SidebarSeparator } from "@/components/ui/sidebar";
import { isHermesBetaAccessEmail } from "@/lib/hermes/beta-access";
import { userService } from "@/lib/services";
import { resolvePlanSecondaryLabel } from "@/lib/utils/plan-label";

interface MobileHomeHubProps {
  sessionUser: SessionUser;
  activeOrganizationId: string | null;
}

/**
 * Mobile `<md` Home hub: sidebar leaf nav without Channels/DMs.
 * Wrapped in an open Sheet so MenuItems/PersonalAssistant SheetClose has context.
 */
export async function MobileHomeHub({
  sessionUser,
  activeOrganizationId,
}: MobileHomeHubProps) {
  const hermesMenuEnabled = isHermesBetaAccessEmail(sessionUser.email);

  const membersPromise = userService
    .getMyMembersWithOrganizations()
    .catch(() => []);
  const activeOrganizationPromise = userService.getActiveOrganization();

  const [
    tCredit,
    members,
    { showVendors: showDeveloperVendors },
    activeOrganization,
  ] = await Promise.all([
    getTranslations("App.Header.Credit"),
    membersPromise,
    getDeveloperVendorAdminAccess(),
    activeOrganizationPromise,
  ]);

  const organizationName = activeOrganization?.name ?? null;
  const planLabel = await resolvePlanSecondaryLabel({
    plan: null,
    organizationName: activeOrganizationId
      ? (organizationName ?? tCredit("unavailable"))
      : null,
  });

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
            <MenuItems hideHistory hideNewTask hideSearch />
          </SidebarNav>
        </div>
      </div>
    </Sheet>
  );
}
