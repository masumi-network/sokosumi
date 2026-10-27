import type { SessionUser } from "@sokosumi/utils";
import { Suspense } from "react";
import { userService } from "@/lib/services/user.service";

import WorkspaceSwitcherClient from "./workspace-switcher.client";
import { WorkspaceSwitcherSkeleton } from "./workspace-switcher-skeleton";

interface WorkspaceSwitcherProps {
  sessionUser: SessionUser;
  activeOrganizationId: string | null;
}

/**
 * The **Workspace switcher** (GLOSSARY.md): the sidebar header's control on
 * desktop, the top bar's avatar on the phone. Each home mounts this; the
 * workspaces read is cached per request, so both cost one Core call.
 */
export function WorkspaceSwitcher(props: WorkspaceSwitcherProps) {
  return (
    <Suspense fallback={<WorkspaceSwitcherSkeleton />}>
      <WorkspaceSwitcherLoader {...props} />
    </Suspense>
  );
}

async function WorkspaceSwitcherLoader({
  sessionUser,
  activeOrganizationId,
}: WorkspaceSwitcherProps) {
  // One Core read lists the switcher's workspaces (ADR 0051).
  const workspaces = (await userService.getMyWorkspaces())?.workspaces ?? [];

  return (
    <WorkspaceSwitcherClient
      sessionUser={sessionUser}
      workspaces={workspaces}
      hasPersonalWorkspace={workspaces.some(({ kind }) => kind === "personal")}
      activeOrganizationId={activeOrganizationId}
    />
  );
}
