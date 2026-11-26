"use client";

import { useChromePathname } from "@/app/chat/components/room-cache-provider";
import { projectPageSection } from "@/app/components/project-scope/project-scope-href";
import WorkspaceSwitcherMenu from "@/app/components/workspace-switcher/workspace-switcher-menu.client";
import { cn } from "@/lib/utils";

/**
 * The phone's top-bar Workspace switcher. On a project's own pages the scope
 * chip takes its room, so the project name reads whole; the You tab's top bar
 * still has it.
 */
export function HeaderPhoneWorkspaceSwitcher() {
  const pathname = useChromePathname();
  const onProject = projectPageSection(pathname) !== null;
  return (
    <div
      className={cn(
        "hidden md:sidebar-hidden:flex",
        !onProject && "max-md:flex",
      )}
    >
      <WorkspaceSwitcherMenu placement="topBar" />
    </div>
  );
}
