import Link from "next/link";

import { SokosumiLogo, ThemedLogo } from "@/components/masumi-logos";

import AppConnection from "./app-connection";
import Navigation from "./navigation";
import SheetNavigation from "./sheet-navigation";

export default function Header() {
  return (
    <div
      id="header"
      className="bg-background/95 supports-[backdrop-filter]:bg-background/60 sticky top-0 z-50 w-full border-b px-4 py-3 backdrop-blur lg:px-8 lg:py-6"
    >
      <div className="container mx-auto flex items-center justify-between gap-6">
        {/* Left - Logo */}
        <Link href="/">
          <ThemedLogo
            LogoComponent={SokosumiLogo}
            width={200}
            height={26}
            priority
          />
        </Link>

        {/* Middle - Navigation Links */}
        <Navigation />

        {/* Right - Auth Buttons */}
        <div className="ml-auto hidden items-center gap-2 sm:flex">
          <AppConnection />
        </div>

        {/* Sheet Navigation Trigger */}
        <div className="flex lg:hidden">
          <SheetNavigation />
        </div>
      </div>
    </div>
  );
}
