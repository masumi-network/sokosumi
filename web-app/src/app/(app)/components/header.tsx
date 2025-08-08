import Link from "next/link";

import { BreadcrumbNavigation } from "@/components/breadcrumb-navigation";
import { SokosumiLogo, ThemedLogo } from "@/components/masumi-logos";
import { cn } from "@/lib/utils";

import CustomTrigger from "./sidebar/components/custom-trigger";
import UserCredits from "./user-credits";

interface HeaderProps {
  className?: string | undefined;
}

export default function Header({ className }: HeaderProps) {
  return (
    <header
      className={cn(
        "border-grid bg-background/95 fixed top-0 z-50 flex w-full justify-between gap-2 border-b md:sticky md:items-center",
        className,
      )}
    >
      <div className="flex w-full items-center justify-between gap-2 p-2 md:w-auto">
        <Link href="/" className="md:hidden">
          <ThemedLogo
            LogoComponent={SokosumiLogo}
            priority
            width={123}
            height={16}
          />
        </Link>
        <CustomTrigger when="invisible" />
      </div>

      <div className="hidden flex-1 flex-row gap-2 sm:flex">
        <BreadcrumbNavigation className="flex flex-1" />
        <UserCredits />
      </div>
    </header>
  );
}
