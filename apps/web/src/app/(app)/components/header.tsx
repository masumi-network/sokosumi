import Link from "next/link";

import { BreadcrumbNavigation } from "@/components/breadcrumb-navigation";
import { SokosumiLogo, ThemedLogo } from "@/components/masumi-logos";
import { Session } from "@/lib/auth/auth";
import { cn } from "@/lib/utils";

import CustomTrigger from "./sidebar/components/custom-trigger";
import UserCredits from "./user-credits";

interface HeaderProps {
  session: Session;
  className?: string | undefined;
}

export default function Header({ session, className }: HeaderProps) {
  return (
    <header
      className={cn(
        "border-grid bg-background/95 fixed top-0 z-50 flex w-full justify-between gap-2 border-b md:sticky md:items-center md:pl-6",
        className,
      )}
    >
      <div className="flex w-full items-center gap-2 p-2 pl-0 md:hidden md:w-auto">
        <CustomTrigger when="invisible" />
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
        <UserCredits session={session} />
      </div>
    </header>
  );
}
