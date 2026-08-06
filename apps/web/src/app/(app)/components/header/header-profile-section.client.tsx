"use client";

import type { SessionUser } from "@sokosumi/utils";
import { Suspense, use } from "react";
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
  accountSummaryPromise: Promise<HeaderAccountSummary>;
}

function HeaderAccountControlSkeleton() {
  return (
    <div
      className="bg-muted ml-0.5 size-8 animate-pulse rounded-full md:hidden"
      aria-hidden
    />
  );
}

interface HeaderAccountControlSlotProps {
  sessionUser: SessionUser;
  members: MemberWithOrganization[];
  activeOrganizationId: string | null;
  accountSummaryPromise: Promise<HeaderAccountSummary>;
}

function HeaderAccountControlSlot({
  sessionUser,
  members,
  activeOrganizationId,
  accountSummaryPromise,
}: HeaderAccountControlSlotProps) {
  const accountSummary = use(accountSummaryPromise);

  return (
    <HeaderAccountControl
      className="ml-0.5 md:hidden"
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
  );
}

export default function HeaderProfileSectionClient({
  sessionUser,
  members,
  activeOrganizationId: serverActiveOrganizationId,
  accountSummaryPromise,
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
        "flex h-8 items-center gap-1.5 md:h-auto",
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
      <Suspense fallback={<HeaderAccountControlSkeleton />}>
        <HeaderAccountControlSlot
          sessionUser={sessionUser}
          members={members}
          activeOrganizationId={activeOrganizationId}
          accountSummaryPromise={accountSummaryPromise}
        />
      </Suspense>
    </div>
  );
}
