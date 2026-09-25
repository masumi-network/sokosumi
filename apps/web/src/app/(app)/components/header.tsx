import type { Session } from "@sokosumi/utils";
import { Suspense } from "react";
import { ScopeSlot } from "@/app/components/project-scope/variants/scope-slot";
import { ScopeVariantPicker } from "@/app/components/project-scope/variants/variant-picker";
import BreadcrumbNavigation from "@/components/breadcrumb-navigation/breadcrumb-navigation";

import { HeaderCenter } from "./header/header-center.client";
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
        <ScopeSlot place="header-center" />
        <BreadcrumbNavigation className="flex flex-1" />
      </HeaderCenter>
      <ScopeSlot place="header-mobile" />

      {/* SOK-1202 variant harness. */}
      <Suspense fallback={null}>
        <ScopeVariantPicker />
      </Suspense>

      <HeaderTrailing>
        <HeaderProfileSection session={session} />
      </HeaderTrailing>
    </HeaderChrome>
  );
}
