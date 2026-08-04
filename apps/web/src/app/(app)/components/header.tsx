import type { Session } from "@sokosumi/utils";
import { BreadcrumbNavigation } from "@/components/breadcrumb-navigation";
import { cn } from "@/lib/utils";

import { HeaderLeadingControl } from "./header/header-leading-control.client";
import HeaderProfileSection from "./header/header-profile-section";

interface HeaderProps {
  className?: string | undefined;
  session: Session;
}

export default function Header({ className, session }: HeaderProps) {
  return (
    <header
      className={cn(
        "border-grid bg-sidebar fixed top-0 z-50 flex w-full items-center justify-between gap-2 border-b md:sticky md:items-center md:pl-6",
        className,
      )}
    >
      <div className="flex size-8 shrink-0 items-center justify-center md:hidden">
        <HeaderLeadingControl />
      </div>

      <div className="hidden min-w-0 flex-1 flex-row gap-2 sm:flex">
        <BreadcrumbNavigation className="flex flex-1" />
      </div>

      <div className="ml-auto flex min-w-0 shrink-0 items-center gap-2">
        <HeaderProfileSection session={session} />
      </div>
    </header>
  );
}
