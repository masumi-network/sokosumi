import Link from "next/link";

import { BreadcrumbNavigation } from "@/components/breadcrumb-navigation";
import { SokosumiLogo, ThemedLogo } from "@/components/masumi-logos";
import { Session } from "@/lib/auth/auth";
import { cn } from "@/lib/utils";

interface HeaderProps {
  session: Session | null;
  className?: string | undefined;
}

export default function HeaderApiDocs({
  session: _session,
  className,
}: HeaderProps) {
  return (
    <header
      className={cn(
        "border-grid bg-background/95 fixed top-0 z-100 flex w-full justify-between gap-2 border-b md:sticky md:items-center",
        className,
      )}
    >
      <div className="mr-4 flex h-[64px] w-full items-center justify-between gap-2 p-2 md:w-auto">
        <Link href="/">
          <ThemedLogo
            LogoComponent={SokosumiLogo}
            priority
            width={123}
            height={16}
          />
        </Link>
      </div>

      <div className="hidden flex-1 flex-row gap-2 sm:flex">
        <BreadcrumbNavigation className="flex flex-1" />
        {/* <UserCredits session={session} /> */}
      </div>
    </header>
  );
}
