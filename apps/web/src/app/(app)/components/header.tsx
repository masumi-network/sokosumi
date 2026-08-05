import type { Session } from "@sokosumi/utils";
import { Suspense } from "react";
import { BreadcrumbNavigation } from "@/components/breadcrumb-navigation";

import { HeaderChrome } from "./header/header-chrome.client";
import {
  HeaderLeadingBrandFallback,
  HeaderLeadingControl,
} from "./header/header-leading-control.client";
import HeaderProfileSection from "./header/header-profile-section";

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

      <div className="hidden min-w-0 flex-1 flex-row gap-2 sm:flex">
        <BreadcrumbNavigation className="flex flex-1" />
      </div>

      <div className="ml-auto flex min-w-0 shrink-0 items-center gap-2">
        <HeaderProfileSection session={session} />
      </div>
    </HeaderChrome>
  );
}
