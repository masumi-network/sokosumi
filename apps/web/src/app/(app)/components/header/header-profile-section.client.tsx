"use client";

import type { SessionUser } from "@sokosumi/utils";
import { useWorkspaceSwitcher } from "@/app/components/user-avatar/workspace-switcher";
import { useSession } from "@/lib/auth/auth.client";
import type { MemberWithOrganization } from "@/lib/clients/generated/core";
import type { CreditUsage } from "@/lib/types/credit";
import { cn } from "@/lib/utils";

import { HeaderAccountControl } from "./header-account-control.client";
import { HeaderNotificationBell } from "./header-notification-bell.client";
import HeaderWorkspaceSwitch from "./header-workspace-switch.client";

export interface HeaderAccountSummary {
  planName: string | null;
  totalCredits: number | null;
  extraCredits: number | null;
  creditUsage: CreditUsage | null;
  subscriptionPeriodEndMs: number | null;
  currentTimestampMs: number;
  lowCreditsThreshold: number;
  buyCreditsLabel: string;
  buyCreditsPath: string;
  adminMenuEnabled: boolean;
  showDeveloperVendors: boolean;
}

interface HeaderProfileSectionClientProps {
  sessionUser: SessionUser;
  members: MemberWithOrganization[];
  activeOrganizationId: string | null;
  accountSummary: HeaderAccountSummary;
}

export default function HeaderProfileSectionClient({
  sessionUser,
  members,
  activeOrganizationId: serverActiveOrganizationId,
  accountSummary,
}: HeaderProfileSectionClientProps) {
  const { data: clientSession } = useSession();
  const { isPending, handleSelectWorkspace } = useWorkspaceSwitcher();

  const clientActiveOrganizationId =
    clientSession?.session.activeOrganizationId;
  const hasClientActiveOrganization = clientActiveOrganizationId !== undefined;

  const liveActiveOrganizationId = hasClientActiveOrganization
    ? clientActiveOrganizationId
    : serverActiveOrganizationId;

  const activeOrganizationId = isPending
    ? serverActiveOrganizationId
    : liveActiveOrganizationId;

  return (
    <div
      className={cn(
        "flex items-center gap-2",
        isPending
          ? "pointer-events-none animate-pulse opacity-60"
          : "transition-opacity",
      )}
    >
      <HeaderWorkspaceSwitch
        sessionUser={sessionUser}
        members={members}
        activeOrganizationId={activeOrganizationId}
        isPending={isPending}
        onSelectWorkspace={handleSelectWorkspace}
      />
      <HeaderNotificationBell />
      <HeaderAccountControl
        className="md:hidden"
        sessionUser={sessionUser}
        planName={accountSummary.planName}
        totalCredits={accountSummary.totalCredits}
        extraCredits={accountSummary.extraCredits}
        creditUsage={accountSummary.creditUsage}
        subscriptionPeriodEndMs={accountSummary.subscriptionPeriodEndMs}
        currentTimestampMs={accountSummary.currentTimestampMs}
        lowCreditsThreshold={accountSummary.lowCreditsThreshold}
        buyCreditsLabel={accountSummary.buyCreditsLabel}
        buyCreditsPath={accountSummary.buyCreditsPath}
        mobileAdminSettings={{
          adminMenuEnabled: accountSummary.adminMenuEnabled,
          members,
          activeOrganizationId,
          showDeveloperVendors: accountSummary.showDeveloperVendors,
        }}
      />
    </div>
  );
}
