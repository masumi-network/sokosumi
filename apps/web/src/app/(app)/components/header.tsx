import type { Session } from "@sokosumi/utils";
import { Suspense } from "react";
import { ProjectScopeGuard } from "@/app/components/project-scope/project-scope-guard";
import { SidebarScopeMobileChip } from "@/app/components/project-scope/sidebar-project-scope-mobile";
import BreadcrumbNavigation from "@/components/breadcrumb-navigation/breadcrumb-navigation";

import { HeaderCenter } from "./header/header-center.client";
import { HeaderChrome } from "./header/header-chrome.client";
import {
  HeaderLeadingBrandFallback,
  HeaderLeadingControl,
} from "./header/header-leading-control.client";
import HeaderProfileSection from "./header/header-profile-section";
import { HeaderSearchTrigger } from "./header/header-search-trigger.client";
import { HeaderTrailing } from "./header/header-trailing.client";
import { NewTaskPrototypeHeaderButton } from "./new-task.prototype.client";

interface HeaderProps {
  className?: string | undefined;
  session: Session;
}

export default function Header({ className, session }: HeaderProps) {
  return (
    <HeaderChrome className={className}>
      <div className="flex size-8 shrink-0 items-center justify-center md:hidden">
        <Suspense fallback={<HeaderLeadingBrandFallback />}>
          <HeaderLeadingControl />
        </Suspense>
      </div>

      <HeaderCenter>
        <BreadcrumbNavigation className="flex flex-1" />
      </HeaderCenter>

      <Suspense fallback={null}>
        <SidebarScopeMobileChip />
        <ProjectScopeGuard />
      </Suspense>

      {/* PROTOTYPE: variant d puts New task here. */}
      <Suspense fallback={null}>
        <NewTaskPrototypeHeaderButton />
      </Suspense>

      <HeaderSearchTrigger />

      <HeaderTrailing>
        <HeaderProfileSection session={session} />
      </HeaderTrailing>
    </HeaderChrome>
  );
}
