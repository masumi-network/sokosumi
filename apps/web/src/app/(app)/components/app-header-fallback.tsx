import { Suspense } from "react";

import { HeaderCenter } from "./header/header-center.client";
import { HeaderChrome } from "./header/header-chrome.client";
import {
  HeaderLeadingBrandFallback,
  HeaderLeadingControl,
} from "./header/header-leading-control.client";
import { HeaderTrailing } from "./header/header-trailing.client";

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

      <HeaderCenter>
        <div className="bg-muted h-4 w-40 animate-pulse rounded-md" />
      </HeaderCenter>

      <HeaderTrailing>
        <div className="flex items-center gap-2">
          <div className="flex flex-col items-end gap-1">
            <div className="bg-muted h-4 w-28 animate-pulse rounded-md" />
            <div className="bg-muted h-3 w-36 animate-pulse rounded-md" />
          </div>
          <div className="bg-muted size-8 animate-pulse rounded-full" />
        </div>
      </HeaderTrailing>
    </HeaderChrome>
  );
}
