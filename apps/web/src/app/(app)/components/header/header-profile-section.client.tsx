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

  const hasClientActiveOrganization =
    clientSession?.session.activeOrganizationId !== undefined;

  // Client session updates on setActive before router.refresh() finishes. Keep the
  // server-rendered workspace visible (and loading) until both sides agree.
  const isWorkspaceSyncing =
    isPending ||
    (hasClientActiveOrganization &&
      liveActiveOrganizationId !== serverActiveOrganizationId);

  const activeOrganizationId = isWorkspaceSyncing
    ? serverActiveOrganizationId
    : liveActiveOrganizationId;

  const activeOrganizationMember = activeOrganizationId
    ? members.find((member) => member.organizationId === activeOrganizationId)
    : null;

  return (
    <div
      className={cn(
        "flex items-center gap-2 transition-opacity",
        isWorkspaceSyncing && "pointer-events-none opacity-50",
      )}
    >
      <HeaderWorkspaceSwitch
        sessionUser={sessionUser}
        members={members}
        activeOrganizationId={activeOrganizationId}
        isPending={isWorkspaceSyncing}
        onSelectWorkspace={handleSelectWorkspace}
      />
      <HeaderNotificationAvatar
        sessionUser={sessionUser}
        organization={activeOrganizationMember?.organization ?? null}
      />
    </div>
  );
}
