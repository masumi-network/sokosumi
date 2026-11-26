import { Suspense } from "react";
import { HeaderProjectScope } from "@/app/components/project-scope/header-project-scope";
import { ProjectScopeGuard } from "@/app/components/project-scope/project-scope-guard";
import { SidebarScopeMobileChip } from "@/app/components/project-scope/sidebar-project-scope-mobile";
import { HeaderCenter } from "./header/header-center.client";
import { HeaderChrome } from "./header/header-chrome.client";
import {
  HeaderLeadingBrandFallback,
  HeaderLeadingControl,
} from "./header/header-leading-control.client";
import { HeaderMobileSearchControl } from "./header/header-mobile-search.client";
import HeaderProfileSection from "./header/header-profile-section";
import { HeaderProjectScopeFallback } from "./header/header-project-scope-fallback";
import { HeaderTrailing } from "./header/header-trailing.client";
import { SidebarToggle } from "./header/sidebar-toggle.client";
import { SidebarNewTaskButton } from "./sidebar/components/sidebar-new-task-button.client";
import WorkspaceSwitcherMenu from "./workspace-switcher/workspace-switcher-menu.client";

interface HeaderProps {
  className?: string | undefined;
}

export default function Header({ className }: HeaderProps) {
  return (
    <HeaderChrome className={className}>
      <div className="flex h-8 min-w-8 shrink-0 items-center justify-center md:hidden">
        <Suspense fallback={<HeaderLeadingBrandFallback />}>
          <HeaderLeadingControl />
        </Suspense>
      </div>

      <div
        className="flex min-w-0 shrink-0 items-center gap-1"
        data-testid="header-workspace-controls"
      >
        <SidebarToggle />
        <div className="hidden min-w-0 max-w-48 md:sidebar-hidden:block">
          <WorkspaceSwitcherMenu placement="topBar" />
        </div>
        <div className="flex items-center gap-1 md:hidden">
          <HeaderMobileSearchControl />
          <SidebarNewTaskButton mobile />
        </div>
      </div>

      <HeaderCenter>
        <Suspense fallback={<HeaderProjectScopeFallback />}>
          <HeaderProjectScope />
        </Suspense>
      </HeaderCenter>

      <Suspense fallback={null}>
        <SidebarScopeMobileChip />
        <ProjectScopeGuard />
      </Suspense>

      <HeaderTrailing>
        <HeaderProfileSection />
      </HeaderTrailing>
    </HeaderChrome>
  );
}
