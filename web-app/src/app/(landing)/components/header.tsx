import Link from "next/link";

import { SokosumiLogo, ThemedLogo } from "@/components/masumi-logos";

import AppConnection from "./app-connection";
import Navigation from "./navigation";
import SheetNavigation from "./sheet-navigation";

export default function Header() {
  return (
    <div
      id="header"
      className="border-background/0 bg-background/0 supports-[backdrop-filter]:bg-background/5 fixed top-0 z-50 w-full border-b px-4 py-3 backdrop-blur transition-colors duration-200 lg:px-8"
    >
      {/* <HeaderBlur /> */}
      <div className="container mx-auto flex h-16 items-center justify-between gap-4 px-0 sm:gap-6 sm:px-6 lg:h-20 lg:px-0">
        {/* Left - Logo */}
        <Link href="/">
          <ThemedLogo LogoComponent={SokosumiLogo} priority />
        </Link>

        {/* Middle - Navigation Links */}
        <div className="hidden flex-1 items-center justify-center lg:flex">
          <Navigation />
        </div>

        {/* Right - Auth Buttons */}
        <div className="ml-auto hidden items-center gap-2 lg:flex">
          <AppConnection />
        </div>

        {/* Sheet Navigation Trigger */}
        <div className="flex flex-1 justify-end lg:hidden">
          <SheetNavigation />
        </div>
      </div>
    </div>
  );
}
