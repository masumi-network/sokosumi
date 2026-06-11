"use client";

import type { MemberWithOrganization } from "@sokosumi/database";

import type { SessionUser } from "@/lib/auth/auth";

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
  return (
    <div className="flex items-center gap-2">
      <HeaderWorkspaceSwitch
        sessionUser={sessionUser}
        members={members}
        activeOrganizationId={activeOrganizationId}
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
