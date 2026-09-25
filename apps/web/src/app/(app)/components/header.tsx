import type { Session } from "@sokosumi/utils";
import { Suspense } from "react";
import {
  ScopeSlot,
  ScopeStaleGuard,
} from "@/app/components/project-scope/variants/scope-slot";
import {
  HeaderVariantCrumbs,
  HeaderVariantTrailing,
} from "@/app/components/project-scope/variants/variant-header";
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
    <>
      <HeaderChrome className={className}>
        <div className="flex size-8 shrink-0 items-center justify-center md:hidden">
          <Suspense fallback={<HeaderLeadingBrandFallback />}>
            <HeaderLeadingControl />
          </Suspense>
        </div>

        <HeaderCenter>
          <ScopeSlot place="header-center" />
          <HeaderVariantCrumbs>
            <BreadcrumbNavigation className="flex flex-1" />
          </HeaderVariantCrumbs>
        </HeaderCenter>
        <ScopeSlot place="header-mobile" />
        <ScopeStaleGuard />

        <HeaderTrailing>
          <HeaderVariantTrailing>
            <HeaderProfileSection session={session} />
          </HeaderVariantTrailing>
        </HeaderTrailing>
      </HeaderChrome>
      {/* SOK-1202 variant harness. Outside the header: its backdrop filter
          would make the header the box that `position: fixed` measures. */}
      <Suspense fallback={null}>
        <ScopeVariantPicker />
      </Suspense>
    </>
  );
}
