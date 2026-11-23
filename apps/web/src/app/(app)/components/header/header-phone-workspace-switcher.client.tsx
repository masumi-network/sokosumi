"use client";

import { useChromePathname } from "@/app/chat/components/room-cache-provider";
import { projectPageSection } from "@/app/components/project-scope/project-scope-href";
import WorkspaceSwitcherMenu from "@/app/components/workspace-switcher/workspace-switcher-menu.client";

/**
 * The phone's top-bar Workspace switcher. On a project's own pages the scope
 * chip takes its room, so the project name reads whole; the You tab's top bar
 * still has it.
 */
export function HeaderPhoneWorkspaceSwitcher() {
  const pathname = useChromePathname();
  if (projectPageSection(pathname) !== null) return null;
  return (
    <div className="flex md:hidden">
      <WorkspaceSwitcherMenu placement="topBar" />
    </div>
  );
}
