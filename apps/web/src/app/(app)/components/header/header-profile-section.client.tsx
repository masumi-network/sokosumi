"use client";

import type { SessionUser } from "@sokosumi/utils";
import { useWorkspaceSwitcher } from "@/app/components/user-avatar/workspace-switcher";
import { useSession } from "@/lib/auth/auth.client";
import type { MemberWithOrganization } from "@/lib/clients/generated/core";
import { cn } from "@/lib/utils";

import HeaderWorkspaceSwitch from "./header-workspace-switch.client";

interface HeaderProfileSectionClientProps {
  sessionUser: SessionUser;
  members: MemberWithOrganization[];
  hasPersonalWorkspace: boolean;
  activeOrganizationId: string | null;
}

export default function HeaderProfileSectionClient({
  sessionUser,
  members,
  hasPersonalWorkspace,
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

  const activeOrganizationId = isPending
    ? serverActiveOrganizationId
    : liveActiveOrganizationId;

  return (
    <div
      className={cn(
        // Desktop-only Workspace switch. Mobile account/Workspace live on You.
        "hidden h-auto items-center gap-1.5 md:flex",
        isPending
          ? "pointer-events-none animate-pulse opacity-60"
          : "transition-opacity",
      )}
      data-testid="header-desktop-workspace-chrome"
    >
      <HeaderWorkspaceSwitch
        sessionUser={sessionUser}
        members={members}
        hasPersonalWorkspace={hasPersonalWorkspace}
        activeOrganizationId={activeOrganizationId}
        isPending={isPending}
        onSelectWorkspace={handleSelectWorkspace}
      />
    </div>
  );
}
