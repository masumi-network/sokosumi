import { Suspense } from "react";
import { WorkspaceSwitcherSkeleton } from "@/app/components/workspace-switcher/workspace-switcher-skeleton";

import { HeaderCenter } from "./header/header-center.client";
import { HeaderChrome } from "./header/header-chrome.client";
import {
  HeaderLeadingBrandFallback,
  HeaderLeadingControl,
} from "./header/header-leading-control.client";
import { HeaderProjectScopeFallback } from "./header/header-project-scope-fallback";
import { HeaderTrailing } from "./header/header-trailing.client";
import { SidebarToggle } from "./header/sidebar-toggle.client";

interface AppHeaderFallbackProps {
  className?: string;
}

export function AppHeaderFallback({ className }: AppHeaderFallbackProps) {
  return (
    <HeaderChrome className={className}>
      <div className="flex size-8 shrink-0 items-center justify-center md:hidden">
        <Suspense fallback={<HeaderLeadingBrandFallback />}>
          <HeaderLeadingControl />
        </Suspense>
      </div>

      {/* The real toggle, so the sidebar can be brought back while the frame
          streams and nothing after it moves when the header takes over. */}
      <SidebarToggle />

      <HeaderCenter>
        <HeaderProjectScopeFallback />
      </HeaderCenter>

      {/* The phone's Workspace switcher, as `HeaderProfileSection` places
          it; from md the switcher is the sidebar header's. */}
      <HeaderTrailing>
        <div className="flex md:hidden">
          <WorkspaceSwitcherSkeleton placement="topBar" />
        </div>
      </HeaderTrailing>
    </HeaderChrome>
  );
}
