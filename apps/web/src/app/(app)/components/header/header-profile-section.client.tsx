"use client";

import type { SessionUser } from "@sokosumi/utils";
import { useWorkspaceSwitcher } from "@/app/components/user-avatar/workspace-switcher";
import { useSession } from "@/lib/auth/auth.client";
import type { MemberWithOrganization } from "@/lib/clients/generated/core";
import { cn } from "@/lib/utils";

import { HeaderNotificationBell } from "./header-notification-bell.client";
import HeaderWorkspaceSwitch from "./header-workspace-switch.client";

interface HeaderProfileSectionClientProps {
  sessionUser: SessionUser;
  members: MemberWithOrganization[];
  activeOrganizationId: string | null;
}

export default function HeaderProfileSectionClient({
  sessionUser,
  members,
  activeOrganizationId: serverActiveOrganizationId,
}: HeaderProfileSectionClientProps) {
  const { data: clientSession } = useSession();
  const { isPending, handleSelectWorkspace } = useWorkspaceSwitcher();

  const clientActiveOrganizationId =
    clientSession?.session.activeOrganizationId;
  const hasClientActiveOrganization = clientActiveOrganizationId !== undefined;

  const liveActiveOrganizationId = hasClientActiveOrganization
    ? clientActiveOrganizationId
    : serverActiveOrganizationId;

  // Keep the pre-switch label while the async workspace change runs.
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
    </div>
  );
}
