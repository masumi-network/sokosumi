"use client";

import { SessionUser } from "@sokosumi/utils";
import { useWorkspaceSwitcher } from "@/app/components/user-avatar/workspace-switcher";
import type { MemberWithOrganization } from "@/lib/types/core-dto";
import { cn } from "@/lib/utils";

import HeaderUserMenu from "./header-user-menu.client";
import HeaderWorkspaceSwitch from "./header-workspace-switch.client";

interface HeaderProfileSectionClientProps {
  sessionUser: SessionUser;
  members: MemberWithOrganization[];
  activeOrganizationId: string | null;
  secondaryLabel?: string;
}

export default function HeaderProfileSectionClient({
  sessionUser,
  members,
  activeOrganizationId,
  secondaryLabel,
}: HeaderProfileSectionClientProps) {
  const { isPending, handleSelectWorkspace } = useWorkspaceSwitcher();

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
      <HeaderUserMenu
        sessionUser={sessionUser}
        members={members}
        activeOrganizationId={activeOrganizationId}
        secondaryLabel={secondaryLabel}
      />
    </div>
  );
}
