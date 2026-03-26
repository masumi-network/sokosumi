import Link from "next/link";

import { BreadcrumbNavigation } from "@/components/breadcrumb-navigation";
import { SokosumiLogo, ThemedLogo } from "@/components/masumi-logos";
import { cn } from "@/lib/utils";

import ChatRailTrigger from "./chat-rail-trigger";
import CreditCta from "./credit-cta";
import HeaderUserSection from "./header-user-section";
import CustomTrigger from "./sidebar/components/custom-trigger";
import { type UserCreditsData } from "./user-credits";

interface HeaderProps {
  creditsData: UserCreditsData | null;
  className?: string | undefined;
}

export default function Header({ creditsData, className }: HeaderProps) {
  const currentPlan = creditsData
    ? (creditsData.subscription?.plan ?? "free")
    : null;

  return (
    <header
      className={cn(
        "border-grid bg-background/95 fixed top-0 z-50 flex w-full justify-between gap-2 border-b md:sticky md:items-center md:pl-6",
        className,
      )}
    >
      <div className="flex w-full items-center justify-between gap-2 p-2 pl-0 md:hidden md:w-auto">
        <div className="flex items-center gap-2">
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
        <ChatRailTrigger />
      </div>

      <div className="hidden flex-1 flex-row gap-2 sm:flex">
        <BreadcrumbNavigation className="flex flex-1" />
        <HeaderUserSection>
          <div className="flex items-center gap-2">
            <CreditCta currentPlan={currentPlan} />
            <ChatRailTrigger />
          </div>
        </HeaderUserSection>
      </div>
    </header>
  );
}
