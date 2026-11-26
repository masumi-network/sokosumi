import { Suspense } from "react";
import { WorkspaceSwitcherSkeleton } from "@/app/components/workspace-switcher/workspace-switcher-skeleton";

import { HeaderCenter } from "./header/header-center.client";
import { HeaderChrome } from "./header/header-chrome.client";
import {
  HeaderLeadingBrandFallback,
  HeaderLeadingControl,
} from "./header/header-leading-control.client";
import { HeaderProjectScopeFallback } from "./header/header-project-scope-fallback";
import { SidebarToggle } from "./header/sidebar-toggle.client";

interface AppHeaderFallbackProps {
  className?: string;
}

export function AppHeaderFallback({ className }: AppHeaderFallbackProps) {
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
          <WorkspaceSwitcherSkeleton placement="topBar" />
        </div>
        {["search", "new-task"].map((action) => (
          <span
            key={action}
            aria-hidden
            className="bg-muted size-10 shrink-0 animate-pulse rounded-md md:hidden"
          />
        ))}
      </div>

      <HeaderCenter>
        <HeaderProjectScopeFallback />
      </HeaderCenter>
    </HeaderChrome>
  );
}
