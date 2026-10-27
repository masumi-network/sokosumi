import { Suspense } from "react";
import { cn } from "@/lib/utils";

import { HeaderCenter } from "./header/header-center.client";
import { HeaderChrome } from "./header/header-chrome.client";
import {
  HeaderLeadingBrandFallback,
  HeaderLeadingControl,
} from "./header/header-leading-control.client";
import { HEADER_SEARCH_BOX_CLASS } from "./header/header-search-box";
import { HeaderTrailing } from "./header/header-trailing.client";
import { SidebarToggle } from "./header/sidebar-toggle.client";
import { WorkspaceSwitcherSkeleton } from "./workspace-switcher/workspace-switcher-skeleton";

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
        <div className="bg-muted h-4 w-40 animate-pulse rounded-md" />
      </HeaderCenter>

      <div
        aria-hidden
        className={cn(
          HEADER_SEARCH_BOX_CLASS,
          "bg-quinary animate-pulse rounded-md",
        )}
      />

      {/* The phone's Workspace switcher, as `HeaderProfileSection` places
          it; from md the switcher is the sidebar header's. */}
      <HeaderTrailing>
        <div className="flex md:hidden">
          <WorkspaceSwitcherSkeleton />
        </div>
      </HeaderTrailing>
    </HeaderChrome>
  );
}
