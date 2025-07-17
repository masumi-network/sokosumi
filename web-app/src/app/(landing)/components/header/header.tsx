import Link from "next/link";

import { SokosumiLogo, ThemedLogo } from "@/components/masumi-logos";
import { cn } from "@/lib/utils";

import AppConnection from "./app-connection";
import FreeCreditsBanner from "./free-credits-banner";
import SheetNavigation from "./sheet-navigation";
import StickyNavigation from "./sticky-navigation";

interface HeaderProps {
  className?: string;
}

export default function Header({ className }: HeaderProps) {
  return (
    <header
      id="header"
      className={cn(
        "border-background/0 bg-background/0 supports-[backdrop-filter]:bg-background/5 fixed top-0 z-50 flex w-full flex-col border-b backdrop-blur transition-colors duration-200",
        className,
      )}
    >
      <FreeCreditsBanner />
      <div className="flex-1 px-4 lg:px-8">
        <div className="container mx-auto flex h-full items-center justify-between gap-4 lg:gap-6">
          {/* Left - Logo */}
          <Link href="/">
            <ThemedLogo LogoComponent={SokosumiLogo} priority />
          </Link>

          {/* Middle - Navigation Links */}
          <div className="flex flex-1 items-center justify-center">
            <StickyNavigation />
            <div className="ml-auto hidden md:block">
              <AppConnection />
            </div>
            <SheetNavigation />
          </div>
        </div>
      </div>
    </header>
  );
}
