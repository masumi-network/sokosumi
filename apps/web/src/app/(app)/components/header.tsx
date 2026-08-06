import type { Session } from "@sokosumi/utils";
import { Suspense } from "react";
import { BreadcrumbNavigation } from "@/components/breadcrumb-navigation";

import { HeaderChrome } from "./header/header-chrome.client";
import {
  HeaderLeadingBrandFallback,
  HeaderLeadingControl,
} from "./header/header-leading-control.client";
import HeaderProfileSection from "./header/header-profile-section";
import { HeaderTrailing } from "./header/header-trailing.client";

interface HeaderProps {
  className?: string | undefined;
  session: Session;
  adminMenuEnabled: boolean;
}

export default function Header({
  className,
  session,
  adminMenuEnabled,
}: HeaderProps) {
  return (
    <HeaderChrome className={className}>
      <div className="flex size-8 shrink-0 items-center justify-center md:hidden">
        <Suspense fallback={<HeaderLeadingBrandFallback />}>
          <HeaderLeadingControl />
        </Suspense>
      </div>

      <div
        data-app-header-room-slot
        className="flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden md:hidden"
      />

      <div className="hidden min-w-0 flex-1 flex-row gap-2 md:flex">
        <BreadcrumbNavigation className="flex flex-1" />
      </div>

      <HeaderTrailing>
        <HeaderProfileSection
          session={session}
          adminMenuEnabled={adminMenuEnabled}
        />
      </HeaderTrailing>
    </HeaderChrome>
  );
}
