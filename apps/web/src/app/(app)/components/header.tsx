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
import HeaderProfileSection from "./header/header-profile-section";
import { HeaderProjectScopeFallback } from "./header/header-project-scope-fallback";
import { HeaderTrailing } from "./header/header-trailing.client";
import { SidebarToggle } from "./header/sidebar-toggle.client";

interface HeaderProps {
  className?: string | undefined;
}

export default function Header({ className }: HeaderProps) {
  return (
    <HeaderChrome className={className}>
      <div className="flex size-8 shrink-0 items-center justify-center md:hidden">
        <Suspense fallback={<HeaderLeadingBrandFallback />}>
          <HeaderLeadingControl />
        </Suspense>
      </div>

      <SidebarToggle />

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
