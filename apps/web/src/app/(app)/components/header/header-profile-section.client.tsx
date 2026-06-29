"use client";

import { SessionUser } from "@sokosumi/utils";
import { useWorkspaceSwitcher } from "@/app/components/user-avatar/workspace-switcher";
import { useSession } from "@/lib/auth/auth.client";
import type { MemberWithOrganization } from "@/lib/clients/generated/core";
import { cn } from "@/lib/utils";

import { HeaderNotificationAvatar } from "./header-notification-avatar.client";
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

  const liveActiveOrganizationId =
    clientSession?.session.activeOrganizationId ??
    serverActiveOrganizationId ??
    null;

  // Keep the pre-switch label while the async workspace change runs.
  const activeOrganizationId = isPending
    ? serverActiveOrganizationId
    : liveActiveOrganizationId;

  const activeOrganizationMember = activeOrganizationId
    ? members.find((member) => member.organizationId === activeOrganizationId)
    : null;

  return (
    <div
      className={cn(
        "flex items-center gap-2 transition-opacity",
        isPending && "pointer-events-none opacity-50",
      )}
    >
      <HeaderWorkspaceSwitch
        sessionUser={sessionUser}
        members={members}
        activeOrganizationId={activeOrganizationId}
        isPending={isPending}
        onSelectWorkspace={handleSelectWorkspace}
      />
      <HeaderNotificationAvatar
        sessionUser={sessionUser}
        organization={activeOrganizationMember?.organization ?? null}
      />
    </div>
  );
}
