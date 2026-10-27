"use client";

import type { UserWorkspace } from "@sokosumi/core-client";
import type { SessionUser } from "@sokosumi/utils";
import { useWorkspaceSwitcher } from "@/app/components/user-avatar/workspace-switcher";
import { useSession } from "@/lib/auth/auth.client";
import { cn } from "@/lib/utils";

import WorkspaceSwitcherMenu from "./workspace-switcher-menu.client";

interface WorkspaceSwitcherClientProps {
  sessionUser: SessionUser;
  workspaces: UserWorkspace[];
  hasPersonalWorkspace: boolean;
  activeOrganizationId: string | null;
}

export default function WorkspaceSwitcherClient({
  sessionUser,
  workspaces,
  hasPersonalWorkspace,
  activeOrganizationId: serverActiveOrganizationId,
}: WorkspaceSwitcherClientProps) {
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
        "flex h-auto min-w-0 flex-1 items-center gap-1.5",
        isPending
          ? "pointer-events-none animate-pulse opacity-60"
          : "transition-opacity",
      )}
      data-testid="workspace-switcher-chrome"
    >
      <WorkspaceSwitcherMenu
        sessionUser={sessionUser}
        workspaces={workspaces}
        hasPersonalWorkspace={hasPersonalWorkspace}
        activeOrganizationId={activeOrganizationId}
        isPending={isPending}
        onSelectWorkspace={handleSelectWorkspace}
      />
    </div>
  );
}
